# Travello Lead Finder

**South African Travel Business Research Engine**

Private, local-first research tool for discovering public Facebook Pages of South African travel and tourism businesses. Search → discover → extract → clean → deduplicate → store → filter → export.

This is **not** a SaaS product. There are no accounts, billing, or multi-tenant features.

## What it does

1. Generates large location × industry query campaigns (provinces, cities, templates, expansions).
2. Calls a **search API provider** (SerpAPI, Google Custom Search, Brave, or Bing) — not Google HTML scraping.
3. Detects Facebook Page URLs in public results, normalizes them, and deduplicates.
4. Scores **Website Opportunity** (Facebook present, no website, travel category, SA location).
5. Stores everything in a local SQLite **master lead database**.
6. Exports CSV / XLSX / JSON for outreach.

The application only processes information returned by the chosen search provider. It does not bypass Facebook privacy, CAPTCHAs, authentication, or provider rate limits.

## Quick start (Windows)

1. Copy `.env.example` to `.env` and set `SEARCH_API_KEY` plus `SEARCH_PROVIDER`.
2. Double-click **START.bat**.
3. Open http://localhost:3000

## Quick start (macOS / Linux)

```bash
cp .env.example .env
# edit .env with your search API key
chmod +x start.sh
./start.sh
```

Frontend: http://localhost:3000  
API: http://localhost:8000/docs (optional local Python). The Next.js app also hosts `/api` so Vercel does not need FastAPI.

## Deploy on Vercel

https://travelloscraper.vercel.app currently 404s if Vercel is building **main** (that branch has no app). Production branch must be `arena/01a0430e-travelloscraper`.

In the Vercel project:

1. **Settings → Git → Production Branch** → `arena/01a0430e-travelloscraper`
2. **Settings → General → Root Directory** → leave **empty** (Next.js is at the repo root). If you previously set `frontend`, clear it.
3. **Settings → Environment Variables**: `SEARCH_PROVIDER`, `SEARCH_API_KEY`
4. **Deployments → Redeploy** the latest commit on that branch (Production).

Framework: Next.js. Do not use `NEXT_PUBLIC_` on the API key.

On Vercel, each search query runs as a serverless function (keep the Search or Dashboard tab open while a campaign is **Running** so the UI can tick the queue). Filesystem storage is ephemeral — **export CSV** to keep leads. For durable storage locally, keep using SQLite via `START.bat`.

## Search providers

Configure in `.env` or **Settings → Search Provider**:

| SEARCH_PROVIDER | Keys |
| --- | --- |
| `serpapi` | `SEARCH_API_KEY` |
| `google_cse` | `SEARCH_API_KEY` + `GOOGLE_CSE_ID` |
| `brave` | `BRAVE_API_KEY` or `SEARCH_API_KEY` |
| `bing` | `BING_API_KEY` or `SEARCH_API_KEY` |

API keys stay on the Python server. They are never shipped to frontend JavaScript.

## Architecture

```
SEARCH CONTROLLER → QUERY GENERATOR → SEARCH PROVIDER → RESULTS
  → FACEBOOK DETECTOR → NORMALIZE → DEDUPE → SCORE → SQLite → FILTER → CSV
```

- Frontend: Next.js (port 3000), proxies `/api` to FastAPI  
- Backend: Python FastAPI (port 8000)  
- Database: SQLite (`data/travello.db`)

## Campaigns

Create a campaign with industries, provinces, cities, templates, custom keywords, exclusions, and optional smart expansion. Pause / resume / stop persist query progress. After a crash, **Resume** continues from the last unfinished query.

## Opportunity score (0–100)

Not a sales probability. Factors include Facebook page found, no website (+30), travel category, South African location, and a usable business name.

**Opportunities** screen lists Facebook-only travel leads with no website — Travello’s primary prospect view.

## Export columns

`id, business_name, facebook_url, website, category, city, province, country, opportunity_score, has_website, search_query, first_discovered, last_discovered, discovery_count, description, source`

UTF-8 with BOM for Excel.

## Backup

Settings → **BACKUP DATABASE** writes `travello_leads_backup_*.db`. Restore always copies the current DB first.

## Legal

Use a search API you are licensed for. Respect provider quotas. Do not use this tool to collect private profile data or to circumvent access controls.
