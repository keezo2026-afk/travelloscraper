"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api";

export default function Dashboard() {
  const [d, setD] = useState(null);
  useEffect(() => {
    const load = async () => {
      try {
        const dash = await api("/api/dashboard");
        setD(dash);
        if (dash.live?.status === "Running" && dash.live.campaign_id) {
          await api("/api/search/tick", { method: "POST", body: JSON.stringify({ campaign_id: dash.live.campaign_id }) });
          setD(await api("/api/dashboard"));
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  const c = d || {};
  return (
    <div>
      <h1>Travello Lead Finder</h1>
      <p className="lead">Discover South African travel businesses that could become your next web design client.</p>
      <div className="row">
        <Link href="/search"><button className="btn">NEW SEARCH</button></Link>
        <Link href="/leads"><button className="btn secondary">VIEW LEADS</button></Link>
        <Link href="/opportunities"><button className="btn ghost">BEST OPPORTUNITIES</button></Link>
      </div>
      <div className="cards">
        <div className="card"><div className="k">TOTAL LEADS</div><div className="v y">{c.total_leads ?? "—"}</div></div>
        <div className="card"><div className="k">FACEBOOK PAGES</div><div className="v">{c.facebook_pages ?? "—"}</div></div>
        <div className="card"><div className="k">NO WEBSITE</div><div className="v y">{c.no_website ?? "—"}</div></div>
        <div className="card"><div className="k">HIGH OPPORTUNITY</div><div className="v">{c.high_opportunity ?? "—"}</div></div>
        <div className="card"><div className="k">SEARCHES COMPLETED</div><div className="v">{c.searches_completed ?? "—"}</div></div>
      </div>
      {c.live?.status && (
        <div className="card">
          <div className="k">LIVE CAMPAIGN</div>
          <p>Status: <b>{c.live.status}</b> — Query {c.live.done || 0} / {c.live.total || 0}</p>
          <p>{c.live.current_query}</p>
          {c.live.error && <p style={{ color: "#e05a5a" }}><b>{c.live.status === "Failed" ? "Search stopped:" : "Search error:"}</b> {c.live.error}</p>}
          <div className="progress"><div style={{ width: `${((c.live.done || 0) / Math.max(c.live.total || 1, 1)) * 100}%` }} /></div>
        </div>
      )}
    </div>
  );
}
