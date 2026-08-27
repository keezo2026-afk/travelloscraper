import { NextResponse } from "next/server";
import { loadStore, saveStore, nid, logEvent } from "../../../lib/store";
import { classifyCategory, flagsFor, normalizeFacebookUrl, nowIso, opportunityScore } from "../../../lib/processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { cols.push(cur); cur = ""; }
      else cur += ch;
    }
    cols.push(cur);
    const rec = {};
    headers.forEach((h, i) => { rec[h] = cols[i]; });
    return rec;
  });
}

export async function POST(req) {
  const form = await req.formData();
  const file = form.get("file");
  if (!file) return NextResponse.json({ detail: "file required" }, { status: 400 });
  const text = await file.text();
  const rows = parseCsv(text);
  const s = loadStore();
  let inserted = 0;
  let skipped = 0;
  for (const rec of rows) {
    const fb = String(rec.facebook_url || "").trim();
    if (!fb || fb === "nan") { skipped++; continue; }
    const norm = normalizeFacebookUrl(fb);
    if (s.leads.some((l) => l.normalized_url === norm)) { skipped++; continue; }
    const website = String(rec.website || "").replace(/^nan$/, "");
    const lead = {
      id: nid(),
      business_name: rec.business_name || "",
      facebook_url: norm,
      normalized_url: norm,
      website,
      has_website: website ? 1 : 0,
      category: rec.category || classifyCategory(rec.business_name || ""),
      city: rec.city || "",
      province: rec.province || "",
      country: rec.country || "South Africa",
      opportunity_score: Number(rec.opportunity_score) || 0,
      description: rec.description || "",
      source: "import",
      first_discovered: nowIso(),
      last_discovered: nowIso(),
      discovery_count: 1,
      status: rec.status || "New",
      notes: "",
      priority: rec.priority || "Medium",
      assigned_date: "",
      website_status: "UNKNOWN",
      flags_json: "[]",
    };
    if (!lead.opportunity_score) lead.opportunity_score = opportunityScore(lead);
    lead.flags_json = JSON.stringify(flagsFor(lead));
    s.leads.push(lead);
    inserted++;
  }
  logEvent(`Imported CSV: ${inserted} inserted, ${skipped} skipped`);
  saveStore();
  return NextResponse.json({ inserted, skipped });
}
