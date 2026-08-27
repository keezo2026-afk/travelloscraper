import fs from "fs";
import path from "path";
import os from "os";

function dataFile() {
  const dir = process.env.VERCEL ? os.tmpdir() : path.join(process.cwd(), "data");
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return path.join(dir, "travello-store.json");
}

function empty() {
  return {
    nextId: 1,
    campaigns: [],
    queries: [],
    search_results: [],
    leads: [],
    lead_discoveries: [],
    exports: [],
    export_presets: [
      { id: 1, name: "Travello — No Website Leads", filters_json: JSON.stringify({ has_website: false, country: "South Africa" }) },
      { id: 2, name: "Travello — Durban Travel Leads", filters_json: JSON.stringify({ city: "Durban" }) },
      { id: 3, name: "Travello — High Opportunity", filters_json: JSON.stringify({ min_score: 80 }) },
    ],
    logs: [],
    settings: {},
    live: {},
  };
}

const g = globalThis;
if (!g.__travello) g.__travello = null;

export function loadStore() {
  if (g.__travello) return g.__travello;
  try {
    const raw = fs.readFileSync(dataFile(), "utf8");
    g.__travello = JSON.parse(raw);
  } catch {
    g.__travello = empty();
  }
  return g.__travello;
}

export function saveStore() {
  const s = loadStore();
  try { fs.writeFileSync(dataFile(), JSON.stringify(s)); } catch {}
  return s;
}

export function nid() {
  const s = loadStore();
  s.nextId += 1;
  return s.nextId;
}

export function logEvent(message, level = "INFO") {
  const s = loadStore();
  s.logs.unshift({ id: nid(), created_at: new Date().toISOString(), level, message });
  s.logs = s.logs.slice(0, 2000);
  saveStore();
}
