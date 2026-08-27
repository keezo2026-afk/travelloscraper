import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.getenv("DATABASE_PATH", "data/travello.db"))
if not DB_PATH.is_absolute():
    DB_PATH = ROOT / DB_PATH
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'Not Started',
    total_queries INTEGER NOT NULL DEFAULT 0,
    completed_queries INTEGER NOT NULL DEFAULT 0,
    last_query_index INTEGER NOT NULL DEFAULT 0,
    results_found INTEGER NOT NULL DEFAULT 0,
    facebook_found INTEGER NOT NULL DEFAULT 0,
    new_leads INTEGER NOT NULL DEFAULT 0,
    duplicates INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    query_text TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    results_count INTEGER NOT NULL DEFAULT 0,
    facebook_count INTEGER NOT NULL DEFAULT 0,
    new_leads INTEGER NOT NULL DEFAULT 0,
    duplicates INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    last_run_at TEXT,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS search_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    query_id INTEGER,
    title TEXT,
    url TEXT,
    snippet TEXT,
    search_position INTEGER,
    search_query TEXT,
    search_date TEXT,
    is_facebook INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
    FOREIGN KEY (query_id) REFERENCES queries(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_name TEXT,
    facebook_url TEXT,
    normalized_url TEXT UNIQUE,
    website TEXT,
    has_website INTEGER NOT NULL DEFAULT 0,
    category TEXT,
    city TEXT,
    province TEXT,
    country TEXT DEFAULT 'South Africa',
    opportunity_score INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    source TEXT,
    first_discovered TEXT,
    last_discovered TEXT,
    discovery_count INTEGER NOT NULL DEFAULT 1,
    email TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'New',
    notes TEXT,
    priority TEXT NOT NULL DEFAULT 'Medium',
    assigned_date TEXT,
    website_status TEXT DEFAULT 'UNKNOWN',
    flags_json TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS lead_discoveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    query_text TEXT,
    campaign_id INTEGER,
    discovered_at TEXT,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS facebook_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    url TEXT,
    normalized_url TEXT,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS websites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    url TEXT,
    status TEXT,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    province TEXT,
    city TEXT
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    format TEXT,
    preset TEXT,
    row_count INTEGER,
    created_at TEXT,
    filters_json TEXT
);

CREATE TABLE IF NOT EXISTS export_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filters_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_fb ON leads(facebook_url);
CREATE INDEX IF NOT EXISTS idx_leads_norm ON leads(normalized_url);
CREATE INDEX IF NOT EXISTS idx_leads_name ON leads(business_name);
CREATE INDEX IF NOT EXISTS idx_leads_prov ON leads(province);
CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);
CREATE INDEX IF NOT EXISTS idx_leads_cat ON leads(category);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(opportunity_score);
CREATE INDEX IF NOT EXISTS idx_queries_camp ON queries(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_results_url ON search_results(url);
"""


def init_db():
    from .geo import CITIES, INDUSTRIES

    with db() as conn:
        conn.executescript(SCHEMA)
        if conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0] == 0:
            for prov, cities in CITIES.items():
                for city in cities:
                    conn.execute(
                        "INSERT INTO locations (province, city) VALUES (?, ?)",
                        (prov, city),
                    )
        if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
            for name in INDUSTRIES + [
                "Accommodation", "Hotel", "Lodge", "Other",
            ]:
                conn.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (name,))
        if conn.execute("SELECT COUNT(*) FROM export_presets").fetchone()[0] == 0:
            presets = [
                ("Travello — No Website Leads", '{"has_website":false,"country":"South Africa"}'),
                ("Travello — Durban Travel Leads", '{"city":"Durban"}'),
                ("Travello — High Opportunity", '{"min_score":80}'),
            ]
            for n, f in presets:
                conn.execute("INSERT INTO export_presets (name, filters_json) VALUES (?, ?)", (n, f))
