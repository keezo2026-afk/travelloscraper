"use client";
import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../lib/api";

export default function Analytics() {
  const [a, setA] = useState(null);
  const [c, setC] = useState(null);
  useEffect(() => {
    api("/api/analytics").then(setA);
    api("/api/coverage").then(setC);
  }, []);
  if (!a) return <p>Loading…</p>;
  const max = Math.max(1, ...(c?.provinces || []).map((p) => p.c));
  return (
    <div>
      <h1>Analytics</h1>
      <p className="lead">Coverage, category mix, and which queries produce unique Facebook pages.</p>
      <div className="cards">
        <div className="card"><div className="k">DUPLICATE RATE</div><div className="v">{Math.round(a.duplicate_rate * 100)}%</div></div>
        <div className="card"><div className="k">DISCOVERY RATE</div><div className="v">{Math.round(a.discovery_rate * 100)}%</div></div>
        <div className="card"><div className="k">RESULTS</div><div className="v">{a.total_results}</div></div>
      </div>
      <div className="grid2">
        <div className="card" style={{ height: 320 }}>
          <div className="k">LEADS BY PROVINCE</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={a.by_province}><XAxis dataKey="name" hide /><YAxis /><Tooltip /><Bar dataKey="c" fill="#f5c518" /></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card" style={{ height: 320 }}>
          <div className="k">LEADS BY CATEGORY</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={a.by_category}><XAxis dataKey="name" hide /><YAxis /><Tooltip /><Bar dataKey="c" fill="#2b6cb0" /></BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <h2>Search coverage</h2>
      {(c?.provinces || []).map((p) => (
        <div key={p.province} style={{ marginBottom: 8 }}>
          <div className="row"><b style={{ width: 160 }}>{p.province}</b><div className="progress" style={{ flex: 1 }}><div style={{ width: `${(p.c / max) * 100}%` }} /></div><span>{p.c}</span></div>
        </div>
      ))}
      <h2>Queries producing most leads</h2>
      <table>
        <thead><tr><th>Query</th><th>Unique leads</th></tr></thead>
        <tbody>{a.top_queries.map((q) => <tr key={q.name}><td>{q.name}</td><td>{q.c}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
