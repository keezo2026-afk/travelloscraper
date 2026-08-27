"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export default function Exports() {
  const [rows, setRows] = useState([]);
  const [presets, setPresets] = useState([]);
  const [filename, setFilename] = useState("travello_leads");
  const [format, setFormat] = useState("csv");
  const [mode, setMode] = useState("all");
  const [msg, setMsg] = useState("");

  const load = () => {
    api("/api/exports").then(setRows);
    api("/api/export-presets").then(setPresets);
  };
  useEffect(load, []);

  const run = async (extra = {}) => {
    setMsg("");
    const r = await api("/api/export", { method: "POST", body: JSON.stringify({ mode, format, filename, ...extra }) });
    setMsg(`Exported ${r.rows} rows → ${r.filename}`);
    load();
  };

  return (
    <div>
      <h1>Exports</h1>
      <p className="lead">CSV (Excel-compatible UTF-8), XLSX, and JSON. Primary format is CSV.</p>
      <div className="card">
        <div className="row">
          <input value={filename} onChange={(e) => setFilename(e.target.value)} />
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
            <option value="json">JSON</option>
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="all">EXPORT ALL</option>
            <option value="high">EXPORT HIGH OPPORTUNITY</option>
            <option value="no_website">EXPORT NO WEBSITE</option>
          </select>
          <button className="btn" onClick={() => run()}>Export</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          {presets.map((p) => (
            <button key={p.id} className="btn ghost" onClick={() => run(JSON.parse(p.filters_json || "{}"))}>{p.name}</button>
          ))}
        </div>
        {msg && <p>{msg}</p>}
      </div>
      <h2>History</h2>
      <table>
        <thead><tr><th>File</th><th>Format</th><th>Rows</th><th>When</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.filename}</td><td>{r.format}</td><td>{r.row_count}</td><td>{r.created_at}</td>
              <td><a href={`/api/exports/download/${r.filename}`}>Download</a></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Import previous CSV</h2>
      <input type="file" accept=".csv" onChange={async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch("/api/import", { method: "POST", body: fd }).then((x) => x.json());
        setMsg(`Imported ${r.inserted}, skipped ${r.skipped}`);
      }} />
    </div>
  );
}
