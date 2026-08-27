"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  ["/", "Dashboard"],
  ["/search", "Search"],
  ["/campaigns", "Campaigns"],
  ["/leads", "Leads"],
  ["/opportunities", "Opportunities"],
  ["/analytics", "Analytics"],
  ["/exports", "Exports"],
  ["/settings", "Settings"],
  ["/logs", "Logs"],
];

export default function Sidebar() {
  const path = usePathname();
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return (
    <aside className="sidebar">
      <div className="brand">TRAVELLO <span>LEAD FINDER</span></div>
      <div className="sub">SA Travel Research Engine</div>
      <nav className="nav">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={path === href ? "active" : ""}>
            {label}
          </Link>
        ))}
      </nav>
      <div style={{ marginTop: 28 }}>
        <button className="btn secondary" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </div>
    </aside>
  );
}
