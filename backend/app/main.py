from __future__ import annotations

import json
import os
import shutil
from datetime import datetime
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .db import DB_PATH, db, init_db
from .engine import live_state, log_event, pause_campaign, resume_campaign, start_campaign, stop_campaign
from .geo import CITIES, DEFAULT_TEMPLATES, INDUSTRIES, PROVINCES, SEARCH_PRESETS
from .processing import now_iso, normalize_facebook_url, opportunity_score, flags_for, classify_category
from .providers import provider_status
from .queries import generate_queries

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
init_db()

EXPORT_DIR = Path(os.getenv("EXPORT_DIR", "data/exports"))
BACKUP_DIR = Path(os.getenv("BACKUP_DIR", "data/backups"))
if not EXPORT_DIR.is_absolute():
    EXPORT_DIR = ROOT / EXPORT_DIR
if not BACKUP_DIR.is_absolute():
    BACKUP_DIR = ROOT / BACKUP_DIR
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Travello Lead Finder")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CampaignIn(BaseModel):
    name: str
    industries: list[str] = []
    provinces: list[str] = []
    cities: list[str] = []
    templates: list[str] = DEFAULT_TEMPLATES
    custom_keywords: list[str] = []
    exclusions: list[str] = []
    expand: bool = True
    custom_location: str | None = None


class LeadPatch(BaseModel):
    status: str | None = None
    notes: str | None = None
    priority: str | None = None
    assigned_date: str | None = None
    category: str | None = None
    city: str | None = None
    province: str | None = None
    website: str | None = None


class SettingsIn(BaseModel):
    SEARCH_PROVIDER: str | None = None
    SEARCH_RATE_DELAY_MS: int | None = None
    RESULTS_PER_QUERY: int | None = None
    MAX_CONCURRENT_SEARCHES: int | None = None
    RETRY_COUNT: int | None = None
    EXPORT_DIR: str | None = None
    DATABASE_PATH: str | None = None
    LOGGING_ENABLED: str | None = None
    SEARCH_API_KEY: str | None = None
    GOOGLE_CSE_ID: str | None = None
    BRAVE_API_KEY: str | None = None
    BING_API_KEY: str | None = None


class ExportIn(BaseModel):
    mode: str = "all"
    format: str = "csv"
    filename: str | None = None
    province: str | None = None
    category: str | None = None
    has_website: bool | None = None
    min_score: int | None = None
    city: str | None = None


class PresetIn(BaseModel):
    name: str
    filters: dict


def rowd(r):
    return dict(r) if r else None


@app.get("/api/health")
def health():
    return {"ok": True, "name": "Travello Lead Finder"}


@app.get("/api/meta")
def meta():
    return {
        "provinces": PROVINCES,
        "cities": CITIES,
        "industries": INDUSTRIES,
        "templates": DEFAULT_TEMPLATES,
        "presets": SEARCH_PRESETS,
        "provider": provider_status(),
    }


@app.post("/api/queries/preview")
def preview_queries(body: CampaignIn):
    qs = generate_queries(
        body.industries, body.provinces, body.cities, body.templates,
        body.custom_keywords, body.expand, body.custom_location,
    )
    return {"count": len(qs), "queries": qs[:2000], "truncated": len(qs) > 2000}


@app.post("/api/campaigns")
def create_campaign(body: CampaignIn):
    qs = generate_queries(
        body.industries, body.provinces, body.cities, body.templates,
        body.custom_keywords, body.expand, body.custom_location,
    )
    ts = now_iso()
    with db() as conn:
        cur = conn.execute(
            """INSERT INTO campaigns (name, config_json, status, total_queries, created_at, updated_at)
               VALUES (?,?,?,?,?,?)""",
            (body.name, body.model_dump_json(), "Not Started", len(qs), ts, ts),
        )
        cid = cur.lastrowid
        for i, q in enumerate(qs, start=1):
            conn.execute(
                "INSERT INTO queries (campaign_id, query_text, position, status) VALUES (?,?,?,?)",
                (cid, q, i, "pending"),
            )
    log_event(f"Campaign created: {body.name} ({len(qs)} queries)")
    return {"id": cid, "total_queries": len(qs)}


@app.get("/api/campaigns")
def list_campaigns():
    with db() as conn:
        rows = conn.execute("SELECT * FROM campaigns ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


@app.get("/api/campaigns/{cid}")
def get_campaign(cid: int):
    with db() as conn:
        c = conn.execute("SELECT * FROM campaigns WHERE id=?", (cid,)).fetchone()
        if not c:
            raise HTTPException(404)
        qs = conn.execute("SELECT * FROM queries WHERE campaign_id=? ORDER BY position", (cid,)).fetchall()
    return {"campaign": dict(c), "queries": [dict(q) for q in qs]}


@app.post("/api/campaigns/{cid}/start")
def camp_start(cid: int):
    with db() as conn:
        c = conn.execute("SELECT * FROM campaigns WHERE id=?", (cid,)).fetchone()
        if not c:
            raise HTTPException(404)
    start_campaign(cid)
    return {"ok": True}


@app.post("/api/campaigns/{cid}/pause")
def camp_pause(cid: int):
    pause_campaign()
    return {"ok": True}


@app.post("/api/campaigns/{cid}/resume")
def camp_resume(cid: int):
    live = live_state()
    if live.get("campaign_id") == cid:
        resume_campaign()
    else:
        start_campaign(cid)
    return {"ok": True}


@app.post("/api/campaigns/{cid}/stop")
def camp_stop(cid: int):
    stop_campaign()
    return {"ok": True}


@app.get("/api/search/live")
def search_live():
    return live_state()


LEAD_COLS = "id, business_name, facebook_url, website, has_website, category, city, province, country, opportunity_score, description, source, first_discovered, last_discovered, discovery_count, status, notes, priority, assigned_date, website_status, flags_json, email, phone"


def lead_filters(q, city, province, category, has_website, min_score, max_score, status, no_website_only):
    where = ["1=1"]
    args = []
    if q:
        where.append("(business_name LIKE ? OR facebook_url LIKE ? OR website LIKE ? OR city LIKE ? OR province LIKE ? OR category LIKE ? OR description LIKE ?)")
        like = f"%{q}%"
        args.extend([like] * 7)
    if city:
        where.append("city=?")
        args.append(city)
    if province:
        where.append("province=?")
        args.append(province)
    if category:
        where.append("category=?")
        args.append(category)
    if has_website is not None:
        where.append("has_website=?")
        args.append(1 if has_website else 0)
    if no_website_only:
        where.append("has_website=0")
        where.append("facebook_url IS NOT NULL AND facebook_url!=''")
    if min_score is not None:
        where.append("opportunity_score>=?")
        args.append(min_score)
    if max_score is not None:
        where.append("opportunity_score<=?")
        args.append(max_score)
    if status:
        where.append("status=?")
        args.append(status)
    return " AND ".join(where), args


@app.get("/api/leads")
def list_leads(
    q: str | None = None,
    city: str | None = None,
    province: str | None = None,
    category: str | None = None,
    has_website: bool | None = None,
    min_score: int | None = None,
    max_score: int | None = None,
    status: str | None = None,
    no_website_only: bool = False,
    sort: str = "opportunity_score",
    order: str = "desc",
    page: int = 1,
    page_size: int = 50,
):
    allowed = {"opportunity_score", "business_name", "city", "province", "category", "first_discovered", "discovery_count", "id"}
    if sort not in allowed:
        sort = "opportunity_score"
    order_sql = "DESC" if order.lower() != "asc" else "ASC"
    where, args = lead_filters(q, city, province, category, has_website, min_score, max_score, status, no_website_only)
    offset = (page - 1) * page_size
    with db() as conn:
        total = conn.execute(f"SELECT COUNT(*) c FROM leads WHERE {where}", args).fetchone()["c"]
        rows = conn.execute(
            f"SELECT {LEAD_COLS} FROM leads WHERE {where} ORDER BY {sort} {order_sql} LIMIT ? OFFSET ?",
            args + [page_size, offset],
        ).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        try:
            d["flags"] = json.loads(d.get("flags_json") or "[]")
        except Exception:
            d["flags"] = []
        items.append(d)
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@app.get("/api/leads/{lid}")
def lead_detail(lid: int):
    with db() as conn:
        r = conn.execute("SELECT * FROM leads WHERE id=?", (lid,)).fetchone()
        if not r:
            raise HTTPException(404)
        disc = conn.execute("SELECT * FROM lead_discoveries WHERE lead_id=? ORDER BY id DESC", (lid,)).fetchall()
    d = dict(r)
    try:
        d["flags"] = json.loads(d.get("flags_json") or "[]")
    except Exception:
        d["flags"] = []
    d["discoveries"] = [dict(x) for x in disc]
    return d


@app.patch("/api/leads/{lid}")
def patch_lead(lid: int, body: LeadPatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        return {"ok": True}
    sets = ", ".join(f"{k}=?" for k in fields)
    with db() as conn:
        conn.execute(f"UPDATE leads SET {sets} WHERE id=?", list(fields.values()) + [lid])
        if "website" in fields:
            conn.execute("UPDATE leads SET has_website=? WHERE id=?", (1 if fields["website"] else 0, lid))
    return {"ok": True}


@app.get("/api/dashboard")
def dashboard():
    with db() as conn:
        total = conn.execute("SELECT COUNT(*) c FROM leads").fetchone()["c"]
        fb = conn.execute("SELECT COUNT(*) c FROM leads WHERE facebook_url IS NOT NULL AND facebook_url!=''").fetchone()["c"]
        no_web = conn.execute("SELECT COUNT(*) c FROM leads WHERE has_website=0").fetchone()["c"]
        high = conn.execute("SELECT COUNT(*) c FROM leads WHERE opportunity_score>=80").fetchone()["c"]
        searches = conn.execute("SELECT COUNT(*) c FROM queries WHERE status='completed'").fetchone()["c"]
        med = conn.execute("SELECT COUNT(*) c FROM leads WHERE opportunity_score>=50 AND opportunity_score<80").fetchone()["c"]
        low = conn.execute("SELECT COUNT(*) c FROM leads WHERE opportunity_score<50").fetchone()["c"]
        with_web = conn.execute("SELECT COUNT(*) c FROM leads WHERE has_website=1").fetchone()["c"]
    return {
        "total_leads": total,
        "facebook_pages": fb,
        "no_website": no_web,
        "high_opportunity": high,
        "medium_opportunity": med,
        "low_opportunity": low,
        "with_website": with_web,
        "searches_completed": searches,
        "live": live_state(),
    }


@app.get("/api/analytics")
def analytics():
    with db() as conn:
        by_prov = [dict(r) for r in conn.execute("SELECT COALESCE(NULLIF(province,''),'Unknown') name, COUNT(*) c FROM leads GROUP BY name ORDER BY c DESC").fetchall()]
        by_city = [dict(r) for r in conn.execute("SELECT COALESCE(NULLIF(city,''),'Unknown') name, COUNT(*) c FROM leads GROUP BY name ORDER BY c DESC LIMIT 30").fetchall()]
        by_cat = [dict(r) for r in conn.execute("SELECT COALESCE(NULLIF(category,''),'Other') name, COUNT(*) c FROM leads GROUP BY name ORDER BY c DESC").fetchall()]
        top_q = [dict(r) for r in conn.execute(
            """SELECT query_text name, COUNT(DISTINCT lead_id) c FROM lead_discoveries GROUP BY query_text ORDER BY c DESC LIMIT 25"""
        ).fetchall()]
        templates = [dict(r) for r in conn.execute(
            """SELECT query_text, results_count, new_leads, facebook_count FROM queries WHERE status='completed'"""
        ).fetchall()]
        total_res = conn.execute("SELECT COUNT(*) c FROM search_results").fetchone()["c"]
        total_leads = conn.execute("SELECT COUNT(*) c FROM leads").fetchone()["c"]
        dups = conn.execute("SELECT COALESCE(SUM(discovery_count-1),0) c FROM leads").fetchone()["c"]
    # pattern performance: group by first two quoted tokens roughly
    return {
        "by_province": by_prov,
        "by_city": by_city,
        "by_category": by_cat,
        "top_queries": top_q,
        "query_rows": templates[:200],
        "duplicate_rate": (dups / max(total_leads + dups, 1)),
        "discovery_rate": (total_leads / max(total_res, 1)),
        "total_results": total_res,
        "total_leads": total_leads,
    }


@app.get("/api/coverage")
def coverage():
    with db() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT COALESCE(NULLIF(province,''),'Unknown') province, COUNT(*) c FROM leads GROUP BY province ORDER BY c DESC"
        ).fetchall()]
        cities = [dict(r) for r in conn.execute(
            "SELECT province, COALESCE(NULLIF(city,''),'Unknown') city, COUNT(*) c FROM leads GROUP BY province, city ORDER BY c DESC"
        ).fetchall()]
    return {"provinces": rows, "cities": cities}


def fetch_export_rows(body: ExportIn):
    where = ["1=1"]
    args = []
    if body.mode == "no_website" or body.has_website is False:
        where.append("has_website=0")
    if body.mode == "high" or (body.min_score and body.min_score >= 80):
        where.append("opportunity_score>=80")
    if body.min_score is not None and body.mode != "high":
        where.append("opportunity_score>=?")
        args.append(body.min_score)
    if body.province:
        where.append("province=?")
        args.append(body.province)
    if body.city:
        where.append("city=?")
        args.append(body.city)
    if body.category:
        where.append("category=?")
        args.append(body.category)
    if body.has_website is True:
        where.append("has_website=1")
    sql = f"SELECT * FROM leads WHERE {' AND '.join(where)} ORDER BY opportunity_score DESC"
    with db() as conn:
        return [dict(r) for r in conn.execute(sql, args).fetchall()]


CSV_COLS = [
    "id", "business_name", "facebook_url", "website", "category", "city", "province", "country",
    "opportunity_score", "has_website", "first_discovered", "last_discovered", "discovery_count",
    "description", "source", "status", "priority",
]


@app.post("/api/export")
def export_leads(body: ExportIn):
    rows = fetch_export_rows(body)
    df = pd.DataFrame(rows)
    for c in CSV_COLS:
        if c not in df.columns:
            df[c] = ""
    if "has_website" in df.columns:
        df["has_website"] = df["has_website"].map(lambda x: "YES" if x else "NO")
    # attach one search query
    with db() as conn:
        qmap = {}
        for r in conn.execute("SELECT lead_id, query_text FROM lead_discoveries ORDER BY id").fetchall():
            qmap.setdefault(r["lead_id"], r["query_text"])
    if not df.empty:
        df["search_query"] = df["id"].map(lambda i: qmap.get(i, ""))
    cols = CSV_COLS + ["search_query"]
    df = df[cols] if not df.empty else pd.DataFrame(columns=cols)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = body.filename or f"travello_leads_{ts}"
    name = Path(name).stem
    fmt = body.format.lower()
    if fmt == "xlsx":
        path = EXPORT_DIR / f"{name}.xlsx"
        df.to_excel(path, index=False)
    elif fmt == "json":
        path = EXPORT_DIR / f"{name}.json"
        df.to_json(path, orient="records", force_ascii=False, indent=2)
    else:
        path = EXPORT_DIR / f"{name}.csv"
        df.to_csv(path, index=False, encoding="utf-8-sig")
    with db() as conn:
        conn.execute(
            "INSERT INTO exports (filename, format, preset, row_count, created_at, filters_json) VALUES (?,?,?,?,?,?)",
            (path.name, fmt, body.mode, len(df), now_iso(), body.model_dump_json()),
        )
    return {"filename": path.name, "rows": len(df), "path": str(path)}


@app.get("/api/exports")
def list_exports():
    with db() as conn:
        rows = conn.execute("SELECT * FROM exports ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


@app.get("/api/exports/download/{filename}")
def download_export(filename: str):
    path = EXPORT_DIR / Path(filename).name
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, filename=path.name)


@app.get("/api/export-presets")
def list_presets():
    with db() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM export_presets").fetchall()]


@app.post("/api/export-presets")
def add_preset(body: PresetIn):
    with db() as conn:
        cur = conn.execute("INSERT INTO export_presets (name, filters_json) VALUES (?,?)", (body.name, json.dumps(body.filters)))
        return {"id": cur.lastrowid}


@app.post("/api/import")
async def import_csv(file: UploadFile = File(...)):
    raw = await file.read()
    from io import BytesIO
    df = pd.read_csv(BytesIO(raw))
    inserted = 0
    skipped = 0
    with db() as conn:
        for rec in df.to_dict(orient="records"):
            fb = str(rec.get("facebook_url") or "").strip()
            if not fb or fb == "nan":
                skipped += 1
                continue
            norm = normalize_facebook_url(fb)
            exists = conn.execute("SELECT id FROM leads WHERE normalized_url=?", (norm,)).fetchone()
            if exists:
                skipped += 1
                continue
            ts = now_iso()
            website = str(rec.get("website") or "")
            if website == "nan":
                website = ""
            lead = {
                "business_name": rec.get("business_name") or "",
                "facebook_url": norm,
                "has_website": bool(website),
                "category": rec.get("category") or classify_category(str(rec.get("business_name") or "")),
                "city": rec.get("city") or "",
                "province": rec.get("province") or "",
            }
            score = rec.get("opportunity_score")
            try:
                score = int(score)
            except Exception:
                score = opportunity_score(lead)
            conn.execute(
                """INSERT INTO leads (business_name, facebook_url, normalized_url, website, has_website, category, city, province, country,
                   opportunity_score, description, source, first_discovered, last_discovered, discovery_count, flags_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    lead["business_name"], norm, norm, website, 1 if website else 0, lead["category"], lead["city"], lead["province"],
                    rec.get("country") or "South Africa", score, rec.get("description") or "", "import", ts, ts, 1,
                    json.dumps(flags_for(lead)),
                ),
            )
            inserted += 1
    log_event(f"Imported CSV: {inserted} inserted, {skipped} skipped")
    return {"inserted": inserted, "skipped": skipped}


@app.post("/api/backup")
def backup_db():
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = BACKUP_DIR / f"travello_leads_backup_{ts}.db"
    shutil.copy2(DB_PATH, dest)
    latest = BACKUP_DIR / "travello_leads_backup.db"
    shutil.copy2(DB_PATH, latest)
    log_event(f"Backup created: {dest.name}")
    return {"filename": dest.name}


@app.get("/api/backups")
def list_backups():
    files = sorted(BACKUP_DIR.glob("*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [{"filename": f.name, "size": f.stat().st_size} for f in files]


@app.get("/api/backups/download/{filename}")
def download_backup(filename: str):
    path = BACKUP_DIR / Path(filename).name
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, filename=path.name)


class RestoreIn(BaseModel):
    filename: str
    confirm: bool = False


@app.post("/api/restore")
def restore_db(body: RestoreIn):
    if not body.confirm:
        raise HTTPException(400, "Confirmation required")
    src = BACKUP_DIR / Path(body.filename).name
    if not src.exists():
        raise HTTPException(404)
    shutil.copy2(DB_PATH, BACKUP_DIR / f"pre_restore_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db")
    shutil.copy2(src, DB_PATH)
    log_event(f"Database restored from {body.filename}")
    return {"ok": True}


@app.get("/api/logs")
def get_logs(limit: int = 500):
    with db() as conn:
        rows = conn.execute("SELECT * FROM app_logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/logs/clear")
def clear_logs():
    with db() as conn:
        conn.execute("DELETE FROM app_logs")
    return {"ok": True}


@app.get("/api/settings")
def get_settings():
    env_keys = [
        "SEARCH_PROVIDER", "SEARCH_RATE_DELAY_MS", "RESULTS_PER_QUERY", "MAX_CONCURRENT_SEARCHES",
        "RETRY_COUNT", "EXPORT_DIR", "DATABASE_PATH", "LOGGING_ENABLED",
    ]
    with db() as conn:
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT * FROM settings").fetchall()}
    out = {}
    for k in env_keys:
        out[k] = rows.get(k, os.getenv(k, ""))
    out["provider"] = provider_status()
    out["api_key_configured"] = bool(os.getenv("SEARCH_API_KEY") or os.getenv("BRAVE_API_KEY") or os.getenv("BING_API_KEY"))
    out["google_cse_id_configured"] = bool(os.getenv("GOOGLE_CSE_ID"))
    return out


def write_env_updates(updates: dict):
    env_path = ROOT / ".env"
    existing = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                existing[k.strip()] = v
    for k, v in updates.items():
        if v is None:
            continue
        existing[k] = str(v)
        os.environ[k] = str(v)
    text = "\n".join(f"{k}={v}" for k, v in existing.items()) + "\n"
    env_path.write_text(text)


@app.post("/api/settings")
def save_settings(body: SettingsIn):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    with db() as conn:
        for k, v in data.items():
            conn.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, str(v)))
    write_env_updates(data)
    return {"ok": True}


@app.post("/api/website-check/{lid}")
def website_check(lid: int):
    import httpx
    with db() as conn:
        r = conn.execute("SELECT website FROM leads WHERE id=?", (lid,)).fetchone()
        if not r or not r["website"]:
            raise HTTPException(400, "No website")
        url = r["website"]
    status = "UNKNOWN"
    try:
        with httpx.Client(timeout=8, follow_redirects=True) as client:
            resp = client.head(url)
            status = "ONLINE" if resp.status_code < 400 else "UNREACHABLE"
    except Exception:
        try:
            with httpx.Client(timeout=8, follow_redirects=True) as client:
                resp = client.get(url)
                status = "ONLINE" if resp.status_code < 400 else "UNREACHABLE"
        except Exception:
            status = "UNREACHABLE"
    with db() as conn:
        conn.execute("UPDATE leads SET website_status=? WHERE id=?", (status, lid))
    return {"status": status}


@app.get("/api/opportunities")
def opportunities(page: int = 1, page_size: int = 50):
    return list_leads(no_website_only=True, sort="opportunity_score", order="desc", page=page, page_size=page_size)
