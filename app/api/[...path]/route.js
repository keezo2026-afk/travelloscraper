import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { CITIES, DEFAULT_TEMPLATES, INDUSTRIES, PROVINCES, SEARCH_PRESETS } from "../../../lib/geo";
import { generateQueries, nowIso, normalizeFacebookUrl, opportunityScore, flagsFor, classifyCategory } from "../../../lib/processing";
import { loadStore, saveStore, nid, logEvent } from "../../../lib/store";
import { providerStatus } from "../../../lib/providers";
import { tickCampaign } from "../../../lib/engine";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function parts(req, ctx) {
  return ctx.params.path || [];
}

function leadFilter(leads, sp) {
  const q = sp.get("q");
  const city = sp.get("city");
  const province = sp.get("province");
  const category = sp.get("category");
  const has_website = sp.get("has_website");
  const min_score = sp.get("min_score");
  const max_score = sp.get("max_score");
  const status = sp.get("status");
  const no_website_only = sp.get("no_website_only") === "true";
  return leads.filter((l) => {
    if (q) {
      const blob = `${l.business_name} ${l.facebook_url} ${l.website} ${l.city} ${l.province} ${l.category} ${l.description}`.toLowerCase();
      if (!blob.includes(q.toLowerCase())) return false;
    }
    if (city && l.city !== city) return false;
    if (province && l.province !== province) return false;
    if (category && l.category !== category) return false;
    if (has_website === "false" && l.has_website) return false;
    if (has_website === "true" && !l.has_website) return false;
    if (no_website_only && (l.has_website || !l.facebook_url)) return false;
    if (min_score != null && Number(l.opportunity_score) < Number(min_score)) return false;
    if (max_score != null && Number(l.opportunity_score) > Number(max_score)) return false;
    if (status && l.status !== status) return false;
    return true;
  });
}

function withFlags(l) {
  let flags = [];
  try { flags = JSON.parse(l.flags_json || "[]"); } catch {}
  return { ...l, flags };
}

async function bodyOf(req) {
  try { return await req.json(); } catch { return {}; }
}

export async function GET(req, ctx) {
  const p = parts(req, ctx);
  const key = p.join("/");
  const s = loadStore();
  const url = new URL(req.url);
  const sp = url.searchParams;

  if (key === "health") return json({ ok: true, name: "Travello Lead Finder" });
  if (key === "meta") {
    return json({ provinces: PROVINCES, cities: CITIES, industries: INDUSTRIES, templates: DEFAULT_TEMPLATES, presets: SEARCH_PRESETS, provider: providerStatus() });
  }
  if (key === "campaigns") return json(s.campaigns.slice().reverse());
  if (p[0] === "campaigns" && p[1] && !p[2]) {
    const id = Number(p[1]);
    const campaign = s.campaigns.find((c) => c.id === id);
    if (!campaign) return json({ detail: "Not found" }, 404);
    return json({ campaign, queries: s.queries.filter((q) => q.campaign_id === id).sort((a, b) => a.position - b.position) });
  }
  if (key === "search/live") return json(s.live || {});
  if (key === "dashboard") {
    const leads = s.leads;
    return json({
      total_leads: leads.length,
      facebook_pages: leads.filter((l) => l.facebook_url).length,
      no_website: leads.filter((l) => !l.has_website).length,
      high_opportunity: leads.filter((l) => l.opportunity_score >= 80).length,
      medium_opportunity: leads.filter((l) => l.opportunity_score >= 50 && l.opportunity_score < 80).length,
      low_opportunity: leads.filter((l) => l.opportunity_score < 50).length,
      with_website: leads.filter((l) => l.has_website).length,
      searches_completed: s.queries.filter((q) => q.status === "completed").length,
      live: s.live || {},
    });
  }
  if (key === "leads" || key === "opportunities") {
    const noWeb = key === "opportunities";
    if (noWeb) sp.set("no_website_only", "true");
    const page = Number(sp.get("page") || 1);
    const page_size = Number(sp.get("page_size") || 50);
    const sort = sp.get("sort") || "opportunity_score";
    const order = (sp.get("order") || "desc").toLowerCase();
    let rows = leadFilter(s.leads, sp);
    rows.sort((a, b) => {
      const av = a[sort] ?? 0; const bv = b[sort] ?? 0;
      if (av < bv) return order === "asc" ? -1 : 1;
      if (av > bv) return order === "asc" ? 1 : -1;
      return 0;
    });
    const total = rows.length;
    const items = rows.slice((page - 1) * page_size, page * page_size).map(withFlags);
    return json({ total, page, page_size, items });
  }
  if (p[0] === "leads" && p[1]) {
    const id = Number(p[1]);
    const l = s.leads.find((x) => x.id === id);
    if (!l) return json({ detail: "Not found" }, 404);
    return json({ ...withFlags(l), discoveries: s.lead_discoveries.filter((d) => d.lead_id === id).reverse() });
  }
  if (key === "analytics") {
    const countBy = (arr, fn) => {
      const m = {};
      for (const x of arr) { const k = fn(x) || "Unknown"; m[k] = (m[k] || 0) + 1; }
      return Object.entries(m).map(([name, c]) => ({ name, c })).sort((a, b) => b.c - a.c);
    };
    const qmap = {};
    for (const d of s.lead_discoveries) qmap[d.query_text] = (qmap[d.query_text] || 0) + 1;
    const top_queries = Object.entries(qmap).map(([name, c]) => ({ name, c })).sort((a, b) => b.c - a.c).slice(0, 25);
    const dups = s.leads.reduce((n, l) => n + Math.max(0, (l.discovery_count || 1) - 1), 0);
    return json({
      by_province: countBy(s.leads, (l) => l.province),
      by_city: countBy(s.leads, (l) => l.city).slice(0, 30),
      by_category: countBy(s.leads, (l) => l.category),
      top_queries,
      query_rows: s.queries.filter((q) => q.status === "completed").slice(0, 200),
      duplicate_rate: dups / Math.max(s.leads.length + dups, 1),
      discovery_rate: s.leads.length / Math.max(s.search_results.length, 1),
      total_results: s.search_results.length,
      total_leads: s.leads.length,
    });
  }
  if (key === "coverage") {
    const provinces = {};
    const cities = [];
    const cm = {};
    for (const l of s.leads) {
      const p = l.province || "Unknown";
      provinces[p] = (provinces[p] || 0) + 1;
      const k = `${p}|${l.city || "Unknown"}`;
      cm[k] = (cm[k] || 0) + 1;
    }
    return json({
      provinces: Object.entries(provinces).map(([province, c]) => ({ province, c })).sort((a, b) => b.c - a.c),
      cities: Object.entries(cm).map(([k, c]) => { const [province, city] = k.split("|"); return { province, city, c }; }).sort((a, b) => b.c - a.c),
    });
  }
  if (key === "exports") return json(s.exports.slice().reverse());
  if (p[0] === "exports" && p[1] === "download" && p[2]) {
    const file = path.join(os.tmpdir(), path.basename(p[2]));
    if (!fs.existsSync(file)) return json({ detail: "Not found" }, 404);
    const buf = fs.readFileSync(file);
    return new NextResponse(buf, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${path.basename(file)}"` } });
  }
  if (key === "export-presets") return json(s.export_presets);
  if (key === "logs") return json(s.logs.slice(0, Number(sp.get("limit") || 500)));
  if (key === "settings") {
    return json({
      SEARCH_PROVIDER: s.settings.SEARCH_PROVIDER || process.env.SEARCH_PROVIDER || "serpapi",
      SEARCH_RATE_DELAY_MS: s.settings.SEARCH_RATE_DELAY_MS || process.env.SEARCH_RATE_DELAY_MS || "1500",
      RESULTS_PER_QUERY: s.settings.RESULTS_PER_QUERY || process.env.RESULTS_PER_QUERY || "10",
      MAX_CONCURRENT_SEARCHES: s.settings.MAX_CONCURRENT_SEARCHES || "1",
      RETRY_COUNT: s.settings.RETRY_COUNT || process.env.RETRY_COUNT || "3",
      EXPORT_DIR: s.settings.EXPORT_DIR || "data/exports",
      DATABASE_PATH: s.settings.DATABASE_PATH || "data/travello.db",
      LOGGING_ENABLED: s.settings.LOGGING_ENABLED || "true",
      provider: providerStatus(),
      api_key_configured: Boolean(process.env.SEARCH_API_KEY || process.env.BRAVE_API_KEY || process.env.BING_API_KEY),
    });
  }
  if (key === "backups") return json([]);
  return json({ detail: "Not found" }, 404);
}

export async function POST(req, ctx) {
  const p = parts(req, ctx);
  const key = p.join("/");
  const s = loadStore();
  const body = await bodyOf(req);

  if (key === "queries/preview") {
    const qs = generateQueries(body);
    return json({ count: qs.length, queries: qs.slice(0, 2000), truncated: qs.length > 2000 });
  }
  if (key === "campaigns") {
    const qs = generateQueries(body);
    const id = nid();
    const ts = nowIso();
    s.campaigns.push({
      id, name: body.name, config_json: JSON.stringify(body), status: "Not Started",
      total_queries: qs.length, completed_queries: 0, last_query_index: 0,
      results_found: 0, facebook_found: 0, new_leads: 0, duplicates: 0,
      error_message: null, created_at: ts, updated_at: ts, started_at: null, completed_at: null,
    });
    qs.forEach((q, i) => s.queries.push({
      id: nid(), campaign_id: id, query_text: q, position: i + 1, status: "pending",
      attempts: 0, results_count: 0, facebook_count: 0, new_leads: 0, duplicates: 0,
    }));
    logEvent(`Campaign created: ${body.name} (${qs.length} queries)`);
    saveStore();
    return json({ id, total_queries: qs.length });
  }
  if (p[0] === "campaigns" && p[2] === "start") {
    const id = Number(p[1]);
    const camp = s.campaigns.find((c) => c.id === id);
    if (!camp) return json({ detail: "Not found" }, 404);
    camp.status = "Running";
    camp.started_at = camp.started_at || nowIso();
    camp.updated_at = nowIso();
    s.live = { campaign_id: id, status: "Running", done: camp.completed_queries, total: camp.total_queries };
    saveStore();
    const live = await tickCampaign(id);
    return json({ ok: true, live });
  }
  if (p[0] === "campaigns" && p[2] === "pause") {
    const id = Number(p[1]);
    const camp = s.campaigns.find((c) => c.id === id);
    if (camp) { camp.status = "Paused"; camp.updated_at = nowIso(); }
    s.live = { ...(s.live || {}), status: "Paused", campaign_id: id };
    saveStore();
    return json({ ok: true });
  }
  if (p[0] === "campaigns" && p[2] === "resume") {
    const id = Number(p[1]);
    const camp = s.campaigns.find((c) => c.id === id);
    if (camp) { camp.status = "Running"; camp.updated_at = nowIso(); }
    s.live = { campaign_id: id, status: "Running" };
    saveStore();
    const live = await tickCampaign(id);
    return json({ ok: true, live });
  }
  if (p[0] === "campaigns" && p[2] === "stop") {
    const id = Number(p[1]);
    const camp = s.campaigns.find((c) => c.id === id);
    if (camp) { camp.status = "Paused"; camp.updated_at = nowIso(); }
    s.live = { ...(s.live || {}), status: "Paused" };
    saveStore();
    return json({ ok: true });
  }
  if (key === "search/tick") {
    const id = Number(body.campaign_id || s.live?.campaign_id);
    if (!id) return json({ ok: false });
    const camp = s.campaigns.find((c) => c.id === id);
    if (!camp || camp.status !== "Running") return json(s.live || {});
    const live = await tickCampaign(id);
    return json(live);
  }
  if (key === "export") {
    let rows = s.leads.slice();
    if (body.mode === "no_website" || body.has_website === false) rows = rows.filter((l) => !l.has_website);
    if (body.mode === "high" || (body.min_score && body.min_score >= 80)) rows = rows.filter((l) => l.opportunity_score >= 80);
    if (body.province) rows = rows.filter((l) => l.province === body.province);
    if (body.city) rows = rows.filter((l) => l.city === body.city);
    if (body.category) rows = rows.filter((l) => l.category === body.category);
    if (body.has_website === true) rows = rows.filter((l) => l.has_website);
    const qmap = {};
    for (const d of s.lead_discoveries) if (!qmap[d.lead_id]) qmap[d.lead_id] = d.query_text;
    const cols = ["id", "business_name", "facebook_url", "website", "category", "city", "province", "country", "opportunity_score", "has_website", "first_discovered", "last_discovered", "discovery_count", "description", "source", "status", "priority", "search_query"];
    const lines = [cols.join(",")];
    for (const r of rows) {
      const rec = { ...r, has_website: r.has_website ? "YES" : "NO", search_query: qmap[r.id] || "" };
      lines.push(cols.map((c) => `"${String(rec[c] ?? "").replace(/"/g, '""')}"`).join(","));
    }
    const name = (body.filename || `travello_leads_${Date.now()}`).replace(/\.[^.]+$/, "");
    const fmt = (body.format || "csv").toLowerCase();
    const filename = `${name}.${fmt === "json" ? "json" : fmt === "xlsx" ? "csv" : "csv"}`;
    const file = path.join(os.tmpdir(), filename);
    const content = fmt === "json" ? JSON.stringify(rows, null, 2) : "\uFEFF" + lines.join("\n");
    fs.writeFileSync(file, content);
    s.exports.push({ id: nid(), filename, format: fmt === "xlsx" ? "csv" : fmt, preset: body.mode, row_count: rows.length, created_at: nowIso(), filters_json: JSON.stringify(body) });
    saveStore();
    return json({ filename, rows: rows.length, path: file });
  }
  if (key === "export-presets") {
    const id = nid();
    s.export_presets.push({ id, name: body.name, filters_json: JSON.stringify(body.filters || {}) });
    saveStore();
    return json({ id });
  }
  if (key === "logs/clear") { s.logs = []; saveStore(); return json({ ok: true }); }
  if (key === "settings") {
    Object.assign(s.settings, body);
    if (body.SEARCH_PROVIDER) process.env.SEARCH_PROVIDER = String(body.SEARCH_PROVIDER);
    if (body.SEARCH_API_KEY) process.env.SEARCH_API_KEY = String(body.SEARCH_API_KEY);
    saveStore();
    return json({ ok: true });
  }
  if (key === "backup") return json({ filename: "use-export-csv-on-vercel", note: "Serverless storage is ephemeral. Export CSV for a durable copy. For persistence add Turso later." });
  if (key === "restore") return json({ detail: "Restore is for local SQLite. On Vercel export/import CSV instead." }, 400);
  if (p[0] === "website-check" && p[1]) {
    const id = Number(p[1]);
    const l = s.leads.find((x) => x.id === id);
    if (!l?.website) return json({ detail: "No website" }, 400);
    let status = "UNKNOWN";
    try {
      const r = await fetch(l.website, { method: "HEAD", redirect: "follow" });
      status = r.ok ? "ONLINE" : "UNREACHABLE";
    } catch {
      try {
        const r = await fetch(l.website, { redirect: "follow" });
        status = r.ok ? "ONLINE" : "UNREACHABLE";
      } catch { status = "UNREACHABLE"; }
    }
    l.website_status = status;
    saveStore();
    return json({ status });
  }
  if (key === "import") {
    return json({ detail: "POST multipart to /api/import-csv" }, 400);
  }
  return json({ detail: "Not found" }, 404);
}

export async function PATCH(req, ctx) {
  const p = parts(req, ctx);
  const s = loadStore();
  if (p[0] === "leads" && p[1]) {
    const id = Number(p[1]);
    const l = s.leads.find((x) => x.id === id);
    if (!l) return json({ detail: "Not found" }, 404);
    const body = await bodyOf(req);
    Object.assign(l, body);
    if (body.website !== undefined) l.has_website = body.website ? 1 : 0;
    saveStore();
    return json({ ok: true });
  }
  return json({ detail: "Not found" }, 404);
}
