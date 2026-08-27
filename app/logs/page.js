"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export default function Logs() {
  const [rows, setRows] = useState([]);
  const load = () => api("/api/logs").then(setRows);
  useEffect(() => { load(); const t = setInterval(load, 2500); return () => clearInterval(t); }, []);
  return (
    <div>
      <h1>Logs</h1>
      <button className="btn danger" onClick={() => api("/api/logs/clear", { method: "POST" }).then(load)}>CLEAR LOG</button>
      <div className="logbox" style={{ marginTop: 12 }}>
        {rows.map((r) => (
          <div key={r.id} className="mono">{r.created_at} [{r.level}] {r.message}</div>
        ))}
      </div>
    </div>
  );
}
