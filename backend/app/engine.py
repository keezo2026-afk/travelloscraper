from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

from dotenv import load_dotenv

from .db import db
from .processing import (
    business_name_from_title,
    classify_category,
    clean_text,
    exclusion_hit,
    extract_website,
    flags_for,
    infer_location,
    is_facebook_url,
    normalize_facebook_url,
    now_iso,
    opportunity_score,
)
from .providers import SearchError, get_provider

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

_lock = threading.Lock()
_runner: threading.Thread | None = None
_stop = threading.Event()
_pause = threading.Event()
_current_campaign: int | None = None
_live: dict = {}


def live_state() -> dict:
    return dict(_live)


def log_event(message: str, level: str = "INFO"):
    if os.getenv("LOGGING_ENABLED", "true").lower() not in ("1", "true", "yes"):
        return
    with db() as conn:
        conn.execute(
            "INSERT INTO app_logs (created_at, level, message) VALUES (?, ?, ?)",
            (now_iso(), level, message),
        )


def _settings_int(key: str, default: int) -> int:
    with db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        if row and str(row["value"]).isdigit():
            return int(row["value"])
    return int(os.getenv(key, default))


def process_result(conn, campaign_id: int, query_id: int, query_text: str, item: dict, exclusions: list[str]):
    title = clean_text(item.get("title"))
    url = (item.get("url") or "").strip()
    snippet = clean_text(item.get("snippet"))
    pos = item.get("position") or 0
    conn.execute(
        """INSERT INTO search_results (campaign_id, query_id, title, url, snippet, search_position, search_query, search_date, is_facebook)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (campaign_id, query_id, title, url, snippet, pos, query_text, now_iso(), 1 if is_facebook_url(url) else 0),
    )
    if not is_facebook_url(url):
        return {"facebook": False, "new": False, "dup": False}

    blob = f"{title} {snippet} {query_text}"
    if exclusion_hit(blob, exclusions):
        # still store facebook but lower later via score; skip hard exclude of facebook pages
        pass

    norm = normalize_facebook_url(url)
    website = extract_website(snippet, "")
    name = business_name_from_title(title)
    category = classify_category(blob)
    city, province = infer_location(blob)
    lead = {
        "business_name": name,
        "facebook_url": norm,
        "website": website,
        "has_website": bool(website),
        "category": category,
        "city": city,
        "province": province,
    }
    score = opportunity_score(lead)
    flags = json.dumps(flags_for(lead))
    existing = conn.execute("SELECT * FROM leads WHERE normalized_url=?", (norm,)).fetchone()
    ts = now_iso()
    if existing:
        conn.execute(
            """UPDATE leads SET last_discovered=?, discovery_count=discovery_count+1,
               website=COALESCE(NULLIF(website,''), ?),
               has_website=CASE WHEN website IS NOT NULL AND website!='' OR ? THEN 1 ELSE has_website END,
               city=CASE WHEN city IS NULL OR city='' THEN ? ELSE city END,
               province=CASE WHEN province IS NULL OR province='' THEN ? ELSE province END,
               category=CASE WHEN category IS NULL OR category='Other' THEN ? ELSE category END
               WHERE id=?""",
            (ts, website or "", 1 if website else 0, city, province, category, existing["id"]),
        )
        lead_id = existing["id"]
        is_new = False
    else:
        cur = conn.execute(
            """INSERT INTO leads (business_name, facebook_url, normalized_url, website, has_website, category, city, province,
               country, opportunity_score, description, source, first_discovered, last_discovered, discovery_count, flags_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                name, norm, norm, website or "", 1 if website else 0, category, city, province,
                "South Africa", score, snippet, "search", ts, ts, 1, flags,
            ),
        )
        lead_id = cur.lastrowid
        conn.execute(
            "INSERT INTO facebook_pages (lead_id, url, normalized_url) VALUES (?,?,?)",
            (lead_id, url, norm),
        )
        if website:
            conn.execute("INSERT INTO websites (lead_id, url, status) VALUES (?,?,?)", (lead_id, website, "UNKNOWN"))
        is_new = True
    conn.execute(
        "INSERT INTO lead_discoveries (lead_id, query_text, campaign_id, discovered_at) VALUES (?,?,?,?)",
        (lead_id, query_text, campaign_id, ts),
    )
    # refresh score
    row = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
    d = dict(row)
    conn.execute("UPDATE leads SET opportunity_score=?, flags_json=? WHERE id=?", (opportunity_score(d), json.dumps(flags_for(d)), lead_id))
    return {"facebook": True, "new": is_new, "dup": not is_new}


def run_one_query(campaign_id: int, qrow, exclusions: list[str], num: int, retries: int, delay_ms: int) -> bool:
    query_text = qrow["query_text"]
    query_id = qrow["id"]
    last_err = None
    last_retryable = True
    attempts = 0
    for attempt in range(1, max(1, retries) + 1):
        attempts = attempt
        try:
            provider = get_provider()
            log_event(f"Query {query_text} (attempt {attempt})")
            results = provider.search(query_text, num=num)
            fb = new = dup = 0
            with db() as conn:
                for item in results:
                    info = process_result(conn, campaign_id, query_id, query_text, item, exclusions)
                    if info["facebook"]:
                        fb += 1
                        if info["new"]:
                            new += 1
                        if info["dup"]:
                            dup += 1
                conn.execute(
                    """UPDATE queries SET status='completed', attempts=?, results_count=?, facebook_count=?, new_leads=?, duplicates=?, last_run_at=?, error_message=NULL WHERE id=?""",
                    (attempt, len(results), fb, new, dup, now_iso(), query_id),
                )
            with db() as conn:
                pos = conn.execute("SELECT position FROM queries WHERE id=?", (query_id,)).fetchone()["position"]
                conn.execute(
                    """UPDATE campaigns SET completed_queries=(SELECT COUNT(*) FROM queries WHERE campaign_id=? AND status='completed'),
                       last_query_index=?, results_found=results_found+?, facebook_found=facebook_found+?,
                       new_leads=new_leads+?, duplicates=duplicates+?, updated_at=?, error_message=NULL WHERE id=?""",
                    (campaign_id, pos, len(results), fb, new, dup, now_iso(), campaign_id),
                )
            _live.update({
                "current_query": query_text,
                "results": len(results),
                "facebook": fb,
                "new_leads": new,
                "duplicates": dup,
                "error": None,
            })
            log_event(f"{len(results)} results, {fb} Facebook URLs, {new} new leads, {dup} duplicates")
            time.sleep(delay_ms / 1000.0)
            return True
        except SearchError as e:
            last_err = str(e)
            last_retryable = e.retryable
            log_event(last_err, "ERROR")
            if not e.retryable:
                break
            time.sleep((delay_ms / 1000.0) * attempt)
        except Exception as e:
            last_err = str(e)
            last_retryable = True
            log_event(last_err, "ERROR")
            time.sleep((delay_ms / 1000.0) * attempt)
    message = last_err or "Search failed"
    with db() as conn:
        conn.execute(
            "UPDATE queries SET status='failed', attempts=?, error_message=?, last_run_at=? WHERE id=?",
            (attempts, message, now_iso(), query_id),
        )
        conn.execute(
            "UPDATE campaigns SET status='Failed', error_message=?, updated_at=? WHERE id=?",
            (message, now_iso(), campaign_id),
        )
    _live.update({
        "status": "Failed",
        "current_query": query_text,
        "error": message,
        "retryable": last_retryable,
    })
    return False


def _loop(campaign_id: int):
    global _current_campaign
    _current_campaign = campaign_id
    with db() as conn:
        camp = conn.execute("SELECT * FROM campaigns WHERE id=?", (campaign_id,)).fetchone()
        config = json.loads(camp["config_json"] or "{}")
    exclusions = config.get("exclusions") or []
    num = _settings_int("RESULTS_PER_QUERY", int(os.getenv("RESULTS_PER_QUERY", "10")))
    retries = _settings_int("RETRY_COUNT", int(os.getenv("RETRY_COUNT", "3")))
    delay_ms = _settings_int("SEARCH_RATE_DELAY_MS", int(os.getenv("SEARCH_RATE_DELAY_MS", "1500")))
    log_event(f"Campaign started: {camp['name']}")
    with db() as conn:
        conn.execute("UPDATE campaigns SET status='Running', started_at=COALESCE(started_at,?), updated_at=? WHERE id=?", (now_iso(), now_iso(), campaign_id))
    try:
        while not _stop.is_set():
            if _pause.is_set():
                with db() as conn:
                    conn.execute("UPDATE campaigns SET status='Paused', updated_at=? WHERE id=?", (now_iso(), campaign_id))
                _live["status"] = "Paused"
                time.sleep(0.4)
                continue
            with db() as conn:
                q = conn.execute(
                    """SELECT * FROM queries WHERE campaign_id=? AND status IN ('pending','retry') ORDER BY position LIMIT 1""",
                    (campaign_id,),
                ).fetchone()
                total = conn.execute("SELECT COUNT(*) c FROM queries WHERE campaign_id=?", (campaign_id,)).fetchone()["c"]
                done = conn.execute("SELECT COUNT(*) c FROM queries WHERE campaign_id=? AND status='completed'", (campaign_id,)).fetchone()["c"]
            _live.update({"campaign_id": campaign_id, "status": "Running", "done": done, "total": total})
            if not q:
                failed = None
                with db() as conn:
                    failed = conn.execute(
                        "SELECT error_message FROM queries WHERE campaign_id=? AND status='failed' ORDER BY position LIMIT 1",
                        (campaign_id,),
                    ).fetchone()
                    if failed:
                        conn.execute(
                            "UPDATE campaigns SET status='Failed', error_message=?, updated_at=? WHERE id=?",
                            (failed["error_message"], now_iso(), campaign_id),
                        )
                    else:
                        conn.execute("UPDATE campaigns SET status='Completed', completed_at=?, updated_at=? WHERE id=?", (now_iso(), now_iso(), campaign_id))
                if failed:
                    _live.update({"status": "Failed", "error": failed["error_message"]})
                    log_event(f"Campaign stopped: {failed['error_message']}", "ERROR")
                else:
                    log_event("Campaign completed")
                    _live["status"] = "Completed"
                break
            if not run_one_query(campaign_id, q, exclusions, num, retries, delay_ms):
                break
    except Exception as e:
        with db() as conn:
            conn.execute("UPDATE campaigns SET status='Failed', error_message=?, updated_at=? WHERE id=?", (str(e), now_iso(), campaign_id))
        log_event(str(e), "ERROR")
        _live["status"] = "Failed"
    finally:
        _current_campaign = None


def start_campaign(campaign_id: int):
    global _runner
    with _lock:
        if _runner and _runner.is_alive():
            raise RuntimeError("A campaign is already running")
        # A failed campaign can be resumed after its provider configuration is fixed.
        with db() as conn:
            conn.execute(
                "UPDATE queries SET status='retry', attempts=0, error_message=NULL WHERE campaign_id=? AND status='failed'",
                (campaign_id,),
            )
        _stop.clear()
        _pause.clear()
        _runner = threading.Thread(target=_loop, args=(campaign_id,), daemon=True)
        _runner.start()


def pause_campaign():
    _pause.set()
    with db() as conn:
        if _current_campaign:
            conn.execute("UPDATE campaigns SET status='Paused', updated_at=? WHERE id=?", (now_iso(), _current_campaign))


def resume_campaign():
    _pause.clear()
    if not (_runner and _runner.is_alive()) and _live.get("campaign_id"):
        start_campaign(int(_live["campaign_id"]))
    else:
        with db() as conn:
            if _current_campaign:
                conn.execute("UPDATE campaigns SET status='Running', updated_at=? WHERE id=?", (now_iso(), _current_campaign))


def stop_campaign():
    _stop.set()
    _pause.clear()
    with db() as conn:
        if _current_campaign:
            conn.execute("UPDATE campaigns SET status='Paused', updated_at=? WHERE id=?", (now_iso(), _current_campaign))
