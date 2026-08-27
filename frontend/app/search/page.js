"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useRouter } from "next/navigation";

export default function SearchPage() {
  const router = useRouter();
  const [meta, setMeta] = useState(null);
  const [name, setName] = useState("South Africa Travel Businesses 2026");
  const [industries, setInd] = useState(["Travel Agency", "Tour Operator", "Safari", "Tourism"]);
  const [provinces, setProv] = useState([]);
  const [cities, setCities] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [customKw, setCustomKw] = useState("luxury safari\nhoneymoon travel\ngroup tours");
  const [exclusions, setEx] = useState("jobs\ncareers\nvacancies\nemployment\nreviews");
  const [expand, setExpand] = useState(true);
  const [customLoc, setCustomLoc] = useState("");
  const [preview, setPreview] = useState(null);
  const [live, setLive] = useState({});
  const [cid, setCid] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/api/meta").then((m) => {
      setMeta(m);
      setTemplates(m.templates);
    });
  }, []);
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const liveNow = await api("/api/search/live");
        setLive(liveNow);
        if (liveNow.status === "Running" && liveNow.campaign_id) {
          const next = await api("/api/search/tick", { method: "POST", body: JSON.stringify({ campaign_id: liveNow.campaign_id }) });
          setLive(next);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const applyPreset = (key) => {
    const p = meta.presets[key];
    setInd(p.industries);
    setProv(p.provinces);
    setCities(p.cities || []);
    setTemplates(p.templates);
    setName(key);
  };

  const payload = () => ({
    name,
    industries,
    provinces,
    cities,
    templates,
    custom_keywords: customKw.split("\n").map((s) => s.trim()).filter(Boolean),
    exclusions: exclusions.split("\n").map((s) => s.trim()).filter(Boolean),
    expand,
    custom_location: customLoc || null,
  });

  const doPreview = async () => {
    setErr("");
    const r = await api("/api/queries/preview", { method: "POST", body: JSON.stringify(payload()) });
    setPreview(r);
  };

  const createAndStart = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api("/api/campaigns", { method: "POST", body: JSON.stringify(payload()) });
      setCid(r.id);
      await api(`/api/campaigns/${r.id}/start`, { method: "POST" });
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const cityOptions = provinces.length
    ? provinces.flatMap((p) => (meta?.cities[p] || []).map((c) => [p, c]))
    : Object.entries(meta?.cities || {}).flatMap(([p, cs]) => cs.map((c) => [p, c]));

  const pct = ((live.done || 0) / Math.max(live.total || 1, 1)) * 100;

  return (
    <div>
      <h1>Search</h1>
      <p className="lead">Build a campaign, generate queries, then search public results for Facebook pages.</p>
      {err && <p style={{ color: "#e05a5a" }}>{err}</p>}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="k">PRESETS</div>
        <div className="row" style={{ marginTop: 10 }}>
          {meta && Object.keys(meta.presets).map((k) => (
            <button key={k} className="btn ghost" onClick={() => applyPreset(k)}>{k}</button>
          ))}
        </div>
      </div>
      <div className="grid2">
        <div className="card">
          <label>Campaign name</label>
          <input style={{ width: "100%", margin: "8px 0 14px" }} value={name} onChange={(e) => setName(e.target.value)} />
          <label>Industry</label>
          <div style={{ margin: "8px 0 14px" }}>
            {(meta?.industries || []).map((i) => (
              <label key={i} className="chip"><input type="checkbox" checked={industries.includes(i)} onChange={() => toggle(industries, setInd, i)} />{i}</label>
            ))}
          </div>
          <label>Province</label>
          <div style={{ margin: "8px 0 14px" }}>
            {(meta?.provinces || []).map((i) => (
              <label key={i} className="chip"><input type="checkbox" checked={provinces.includes(i)} onChange={() => toggle(provinces, setProv, i)} />{i}</label>
            ))}
          </div>
          <label>Cities</label>
          <div style={{ maxHeight: 160, overflow: "auto", margin: "8px 0 14px" }}>
            {cityOptions.map(([p, c]) => (
              <label key={p + c} className="chip"><input type="checkbox" checked={cities.includes(c)} onChange={() => toggle(cities, setCities, c)} />{c}</label>
            ))}
          </div>
          <label>Custom location</label>
          <input style={{ width: "100%", margin: "8px 0 14px" }} value={customLoc} onChange={(e) => setCustomLoc(e.target.value)} placeholder="Kruger National Park" />
        </div>
        <div className="card">
          <label>Templates (one per line, use {"{keyword}"} and {"{location}"})</label>
          <textarea rows={6} style={{ width: "100%", margin: "8px 0 14px" }} value={templates.join("\n")} onChange={(e) => setTemplates(e.target.value.split("\n").filter(Boolean))} />
          <label>Custom keywords</label>
          <textarea rows={5} style={{ width: "100%", margin: "8px 0 14px" }} value={customKw} onChange={(e) => setCustomKw(e.target.value)} />
          <label>Exclusions</label>
          <textarea rows={4} style={{ width: "100%", margin: "8px 0 14px" }} value={exclusions} onChange={(e) => setEx(e.target.value)} />
          <label className="chip"><input type="checkbox" checked={expand} onChange={(e) => setExpand(e.target.checked)} /> Smart keyword expansion</label>
        </div>
      </div>
      <div className="row" style={{ margin: "16px 0" }}>
        <button className="btn secondary" onClick={doPreview}>GENERATE QUERIES</button>
        <button className="btn" disabled={busy} onClick={createAndStart}>START SEARCH</button>
        {cid && <>
          <button className="btn ghost" onClick={() => api(`/api/campaigns/${cid}/pause`, { method: "POST" })}>PAUSE</button>
          <button className="btn ghost" onClick={() => api(`/api/campaigns/${cid}/resume`, { method: "POST" })}>RESUME</button>
          <button className="btn danger" onClick={() => api(`/api/campaigns/${cid}/stop`, { method: "POST" })}>STOP</button>
          <button className="btn secondary" onClick={() => router.push(`/campaigns`)}>OPEN CAMPAIGNS</button>
        </>}
      </div>
      {(live.status || cid) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="k">CAMPAIGN {live.status || "Running"}</div>
          <p>Query {live.done || 0} / {live.total || 0}</p>
          <p>Current: {live.current_query || "—"}</p>
          <p>Results {live.results ?? 0} · Facebook {live.facebook ?? 0} · New {live.new_leads ?? 0} · Duplicates {live.duplicates ?? 0}</p>
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      {preview && (
        <div className="card">
          <div className="k">QUEUE · {preview.count} queries</div>
          <ol className="mono">
            {preview.queries.slice(0, 250).map((q, i) => <li key={i}>{q}</li>)}
          </ol>
          {preview.truncated && <p>Showing first 250 of {preview.count}</p>}
        </div>
      )}
    </div>
  );
}
