"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export default function Settings() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState("");
  const load = () => api("/api/settings").then(setS);
  useEffect(load, []);
  if (!s) return null;
  const set = (k, v) => setS({ ...s, [k]: v });
  const save = async () => {
    await api("/api/settings", { method: "POST", body: JSON.stringify({
      SEARCH_PROVIDER: s.SEARCH_PROVIDER,
      SEARCH_RATE_DELAY_MS: Number(s.SEARCH_RATE_DELAY_MS),
      RESULTS_PER_QUERY: Number(s.RESULTS_PER_QUERY),
      MAX_CONCURRENT_SEARCHES: Number(s.MAX_CONCURRENT_SEARCHES),
      RETRY_COUNT: Number(s.RETRY_COUNT),
      EXPORT_DIR: s.EXPORT_DIR,
      DATABASE_PATH: s.DATABASE_PATH,
      LOGGING_ENABLED: s.LOGGING_ENABLED,
      SEARCH_API_KEY: s.SEARCH_API_KEY || undefined,
    }) });
    setMsg("Saved. API keys stay on the server.");
    load();
  };
  return (
    <div>
      <h1>Settings</h1>
      <p className="lead">Search provider and local engine configuration. Keys are never sent to the browser after save.</p>
      <div className="card">
        <div className="k">SEARCH PROVIDER</div>
        <p>Configured: {s.api_key_configured ? "YES" : "NO"} · Current: {s.provider?.current}</p>
        {s.provider && Object.entries(s.provider.providers).map(([k, v]) => (
          <div key={k}>{k}: {v.configured ? "configured" : "missing key"}</div>
        ))}
        <select value={s.SEARCH_PROVIDER} onChange={(e) => set("SEARCH_PROVIDER", e.target.value)}>
          <option value="serpapi">SerpAPI</option>
          <option value="google_cse">Google Custom Search</option>
          <option value="brave">Brave Search</option>
          <option value="bing">Bing Web Search</option>
        </select>
        <p>Paste API key to update .env (leave blank to keep existing)</p>
        <input type="password" placeholder="SEARCH_API_KEY" onChange={(e) => set("SEARCH_API_KEY", e.target.value)} />
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        {["SEARCH_RATE_DELAY_MS", "RESULTS_PER_QUERY", "MAX_CONCURRENT_SEARCHES", "RETRY_COUNT", "EXPORT_DIR", "DATABASE_PATH", "LOGGING_ENABLED"].map((k) => (
          <label key={k}>{k}<br /><input style={{ width: "100%" }} value={s[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></label>
        ))}
      </div>
      <button className="btn" style={{ marginTop: 16 }} onClick={save}>Save settings</button>
      <p>{msg}</p>
      <h2>Database backup / restore</h2>
      <button className="btn ghost" onClick={async () => { const r = await api("/api/backup", { method: "POST" }); setMsg("Backup " + r.filename); }}>BACKUP DATABASE</button>
      <BackupRestore onMsg={setMsg} />
    </div>
  );
}

function BackupRestore({ onMsg }) {
  const [files, setFiles] = useState([]);
  useEffect(() => { api("/api/backups").then(setFiles); }, []);
  return (
    <ul>
      {files.map((f) => (
        <li key={f.filename}>
          {f.filename} ({Math.round(f.size / 1024)} KB)
          <a href={`/api/backups/download/${f.filename}`}> download</a>
          <button className="btn danger" style={{ marginLeft: 8 }} onClick={async () => {
            if (!confirm("Restore this backup? A safety copy of the current DB will be created.")) return;
            await api("/api/restore", { method: "POST", body: JSON.stringify({ filename: f.filename, confirm: true }) });
            onMsg("Restored " + f.filename);
          }}>RESTORE</button>
        </li>
      ))}
    </ul>
  );
}
