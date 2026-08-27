"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export default function Campaigns() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  const load = () => api("/api/campaigns").then(setRows);
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, []);
  const inspect = async (id) => setOpen(await api(`/api/campaigns/${id}`));
  return (
    <div>
      <h1>Campaigns</h1>
      <p className="lead">History, progress, and queue inspection. Resume continues from the last successful query.</p>
      <table>
        <thead><tr><th>Name</th><th>Status</th><th>Progress</th><th>New leads</th><th>Updated</th><th></th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td><span className="badge">{c.status}</span></td>
              <td>{c.completed_queries} / {c.total_queries}</td>
              <td>{c.new_leads}</td>
              <td>{c.updated_at}</td>
              <td className="row">
                <button className="btn ghost" onClick={() => inspect(c.id)}>Queue</button>
                {["Not Started", "Paused", "Failed"].includes(c.status) && (
                  <button className="btn" onClick={() => api(`/api/campaigns/${c.id}/resume`, { method: "POST" }).then(load)}>Resume</button>
                )}
                {c.status === "Running" && (
                  <button className="btn secondary" onClick={() => api(`/api/campaigns/${c.id}/pause`, { method: "POST" }).then(load)}>Pause</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="k">QUEUE — {open.campaign.name}</div>
          <ol>
            {open.queries.map((q) => (
              <li key={q.id}>{q.position}. {q.query_text} — <b>{q.status}</b> {q.error_message ? `(${q.error_message})` : ""}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
