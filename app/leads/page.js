"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export default function Leads({ opportunityMode = false }) {
  const [data, setData] = useState({ items: [], total: 0, page: 1 });
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({
    has_website: opportunityMode ? "no" : "",
    min_score: opportunityMode ? "80" : "",
    province: "",
    category: "",
    city: "",
  });
  const [sel, setSel] = useState(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("opportunity_score");
  const [order, setOrder] = useState("desc");
  const [meta, setMeta] = useState(null);

  const load = () => {
    const p = new URLSearchParams({ page, page_size: 40, sort, order, q });
    if (filters.province) p.set("province", filters.province);
    if (filters.city) p.set("city", filters.city);
    if (filters.category) p.set("category", filters.category);
    if (filters.has_website === "no") p.set("has_website", "false");
    if (filters.has_website === "yes") p.set("has_website", "true");
    if (filters.min_score === "80") p.set("min_score", "80");
    if (filters.min_score === "50") { p.set("min_score", "50"); p.set("max_score", "79"); }
    if (filters.min_score === "0") { p.set("min_score", "0"); p.set("max_score", "49"); }
    if (opportunityMode) p.set("no_website_only", "true");
    api(`/api/leads?${p}`).then(setData);
  };
  useEffect(() => { api("/api/meta").then(setMeta); }, []);
  useEffect(load, [page, sort, order, q, filters, opportunityMode]);

  const copy = (t) => navigator.clipboard.writeText(t || "");

  return (
    <div>
      <h1>{opportunityMode ? "Best Travel Website Opportunities" : "Master Lead Database"}</h1>
      <p className="lead">{opportunityMode ? "Facebook pages for South African travel businesses with no website discovered." : "Search, filter, and manage discovered Facebook pages."}</p>
      <div className="row" style={{ marginBottom: 14 }}>
        <input placeholder="Global search" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} style={{ minWidth: 240 }} />
        <select value={filters.has_website} onChange={(e) => setFilters({ ...filters, has_website: e.target.value })}>
          <option value="">Website: any</option>
          <option value="no">No website</option>
          <option value="yes">Has website</option>
        </select>
        <select value={filters.min_score} onChange={(e) => setFilters({ ...filters, min_score: e.target.value })}>
          <option value="">All scores</option>
          <option value="80">HIGH 80–100</option>
          <option value="50">MEDIUM 50–79</option>
          <option value="0">LOW 0–49</option>
        </select>
        <select value={filters.province} onChange={(e) => setFilters({ ...filters, province: e.target.value })}>
          <option value="">Province</option>
          {(meta?.provinces || []).map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
          <option value="">Category</option>
          {(meta?.industries || []).map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <table>
        <thead>
          <tr>
            {[["business_name", "Business"], ["facebook_url", "Facebook"], ["website", "Website"], ["category", "Category"], ["city", "City"], ["province", "Province"], ["opportunity_score", "Score"], ["first_discovered", "Found"]].map(([k, l]) => (
              <th key={k} onClick={() => { setSort(k === "facebook_url" ? "business_name" : k); setOrder(order === "asc" ? "desc" : "asc"); }}>{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.items.map((r) => (
            <tr key={r.id} onClick={() => api(`/api/leads/${r.id}`).then(setSel)} style={{ cursor: "pointer" }}>
              <td>{r.business_name}</td>
              <td><a href={r.facebook_url} target="_blank" rel="noreferrer">Open</a></td>
              <td>{r.website ? <a href={r.website} target="_blank" rel="noreferrer">Site</a> : "NO"}</td>
              <td>{r.category}</td>
              <td>{r.city}</td>
              <td>{r.province}</td>
              <td><span className={`badge ${r.opportunity_score >= 80 ? "high" : "med"}`}>{r.opportunity_score} / 100</span></td>
              <td>{(r.first_discovered || "").slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
        <span>Page {data.page} · {data.total} leads</span>
        <button className="btn secondary" onClick={() => setPage(page + 1)}>Next</button>
      </div>
      {sel && (
        <div className="panel">
          <button className="btn secondary" onClick={() => setSel(null)}>Close</button>
          <h2>{sel.business_name}</h2>
          <p><a href={sel.facebook_url} target="_blank" rel="noreferrer">{sel.facebook_url}</a></p>
          <p>Website: {sel.website || "None"}</p>
          <p>Category: {sel.category} · {sel.city} {sel.province}</p>
          <p><b>{sel.opportunity_score} / 100 — {sel.opportunity_score >= 80 ? "HIGH OPPORTUNITY" : sel.opportunity_score >= 50 ? "MEDIUM" : "LOW"}</b></p>
          <p>Website Opportunity Score (not a sales probability).</p>
          <p>First {sel.first_discovered}<br />Last {sel.last_discovered}<br />Discovered {sel.discovery_count} times</p>
          <p>{sel.description}</p>
          <div className="row">
            {(sel.flags || []).map((f) => <span key={f} className="badge">{f}</span>)}
          </div>
          <h3>Searches found from</h3>
          <ul>{(sel.discoveries || []).map((d) => <li key={d.id}>{d.query_text}</li>)}</ul>
          <div className="row">
            <a href={sel.facebook_url} target="_blank" rel="noreferrer"><button className="btn">OPEN FACEBOOK</button></a>
            {sel.website && <a href={sel.website} target="_blank" rel="noreferrer"><button className="btn secondary">OPEN WEBSITE</button></a>}
            <button className="btn ghost" onClick={() => copy(sel.facebook_url)}>COPY FACEBOOK URL</button>
            <button className="btn ghost" onClick={() => copy(JSON.stringify(sel, null, 2))}>COPY BUSINESS DATA</button>
          </div>
          <h3>Personal tracker</h3>
          <select value={sel.status} onChange={(e) => api(`/api/leads/${sel.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) }).then(() => setSel({ ...sel, status: e.target.value }))}>
            {["New", "Researching", "Contact Later", "Contacted", "Interested", "Proposal Sent", "Won", "Not Interested"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={sel.priority} onChange={(e) => api(`/api/leads/${sel.id}`, { method: "PATCH", body: JSON.stringify({ priority: e.target.value }) }).then(() => setSel({ ...sel, priority: e.target.value }))}>
            {["Low", "Medium", "High"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <textarea rows={4} style={{ width: "100%", marginTop: 8 }} value={sel.notes || ""} onChange={(e) => setSel({ ...sel, notes: e.target.value })} onBlur={() => api(`/api/leads/${sel.id}`, { method: "PATCH", body: JSON.stringify({ notes: sel.notes }) })} />
          {sel.website && <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => api(`/api/website-check/${sel.id}`, { method: "POST" }).then((r) => setSel({ ...sel, website_status: r.status }))}>Check website ({sel.website_status})</button>}
        </div>
      )}
    </div>
  );
}
