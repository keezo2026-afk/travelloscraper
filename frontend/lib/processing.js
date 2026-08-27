import { CATEGORY_KEYWORDS, CITIES, DEFAULT_EXCLUSIONS, DEFAULT_TEMPLATES, KEYWORD_EXPANSIONS, PROVINCES } from "./geo";

const TRACKING = new Set(["ref", "fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "mibextid", "_rdc", "_rdr", "locale", "paipv"]);

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function cleanText(value) {
  if (!value) return "";
  return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function isFacebookUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
    return host.includes("facebook.com") || host.includes("fb.com") || host.includes("fb.me");
  } catch {
    return /facebook\.com|fb\.com/i.test(url);
  }
}

export function normalizeFacebookUrl(url) {
  if (!url) return "";
  let raw = url.trim();
  if (!raw.startsWith("http")) raw = "https://" + raw;
  let u;
  try { u = new URL(raw); } catch { return raw; }
  let host = u.hostname.toLowerCase().replace("m.facebook.com", "www.facebook.com");
  if (host === "facebook.com") host = "www.facebook.com";
  const params = new URLSearchParams();
  if (u.pathname.includes("profile.php")) {
    if (u.searchParams.get("id")) params.set("id", u.searchParams.get("id"));
    return `https://${host}/profile.php${params.toString() ? "?" + params : ""}`;
  }
  u.searchParams.forEach((v, k) => {
    if (!TRACKING.has(k.toLowerCase())) params.append(k, v);
  });
  let path = u.pathname || "/";
  if (!path.endsWith("/")) path += "/";
  const q = params.toString();
  return `https://${host}${path}${q ? "?" + q : ""}`;
}

export function extractWebsite(snippet, resultUrl) {
  if (resultUrl && !isFacebookUrl(resultUrl)) {
    try {
      const host = new URL(resultUrl).hostname.toLowerCase();
      if (host && !host.includes("google.")) return resultUrl.split("?")[0];
    } catch {}
  }
  if (!snippet) return null;
  const matches = snippet.match(/https?:\/\/[^\s]+/g) || [];
  for (const m of matches) {
    if (!isFacebookUrl(m) && !m.includes("google.")) return m.replace(/[.,)]+$/, "");
  }
  const domains = snippet.match(/\b(?:www\.)?[a-z0-9.-]+\.(?:co\.za|com|net|org|travel)\b/gi) || [];
  for (const d of domains) {
    if (!/facebook|google/i.test(d)) return "https://" + d;
  }
  return null;
}

export function classifyCategory(text) {
  const blob = (text || "").toLowerCase();
  let best = "Other";
  let nBest = 0;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    const n = kws.filter((k) => blob.includes(k)).length;
    if (n > nBest) { nBest = n; best = cat; }
  }
  return best;
}

export function inferLocation(text) {
  const blob = (text || "").toLowerCase();
  let province = "";
  for (const [prov, cities] of Object.entries(CITIES)) {
    for (const c of cities) {
      if (blob.includes(c.toLowerCase())) return [c, prov];
    }
    if (blob.includes(prov.toLowerCase()) && !province) province = prov;
  }
  return ["", province];
}

export function opportunityScore(lead) {
  let score = 0;
  if (lead.facebook_url) score += 20;
  score += lead.has_website ? 10 : 30;
  const cat = (lead.category || "").toLowerCase();
  if (cat && cat !== "other") score += 20;
  if (lead.city || lead.province) score += 10;
  const name = lead.business_name || "";
  if (name.length > 2 && !name.toLowerCase().includes("facebook")) score += 10;
  return Math.min(100, score);
}

export function exclusionHit(text, exclusions) {
  const blob = (text || "").toLowerCase();
  return (exclusions || DEFAULT_EXCLUSIONS).some((w) => blob.includes(String(w).toLowerCase()));
}

export function businessNameFromTitle(title) {
  let t = cleanText(title);
  t = t.replace(/\s*[|\-–—]\s*Facebook.*$/i, "");
  t = t.replace(/\s*on Facebook.*$/i, "");
  t = t.replace(/^Facebook\s*[|\-–—]\s*/i, "");
  return t.trim();
}

export function flagsFor(lead) {
  const flags = [];
  if (lead.facebook_url) { flags.push("FACEBOOK RESULT"); flags.push("VERIFIED URL"); }
  flags.push(lead.has_website ? "WEBSITE FOUND" : "NO WEBSITE");
  if (lead.city || lead.province) flags.push("LOCATION FOUND");
  if (lead.category && lead.category !== "Other") flags.push("CATEGORY FOUND");
  return flags;
}

export function generateQueries({ industries = [], provinces = [], cities = [], templates, custom_keywords = [], expand = true, custom_location }) {
  const tmpls = templates?.length ? templates : DEFAULT_TEMPLATES;
  const keywords = [];
  for (const ind of industries) {
    keywords.push(ind);
    if (expand) keywords.push(...(KEYWORD_EXPANSIONS[ind] || []));
  }
  for (const k of custom_keywords) if (k?.trim()) keywords.push(k.trim());
  const uniqKw = [];
  const seenK = new Set();
  for (const k of keywords) {
    const kl = k.toLowerCase();
    if (!seenK.has(kl)) { seenK.add(kl); uniqKw.push(k); }
  }
  const locations = [];
  if (custom_location) locations.push(custom_location);
  if (!provinces.length && !cities.length && !custom_location) {
    locations.push("South Africa", ...PROVINCES);
  } else {
    if (provinces.length && !cities.length) {
      for (const p of provinces) {
        locations.push(p, "South Africa", ...(CITIES[p] || []));
      }
    }
    locations.push(...cities);
    if (provinces.length && cities.length) locations.push(...provinces);
  }
  const uniqLoc = [];
  const seenL = new Set();
  for (const loc of locations) {
    const k = loc.toLowerCase();
    if (!seenL.has(k)) { seenL.add(k); uniqLoc.push(loc); }
  }
  const queries = [];
  const seenQ = new Set();
  for (const kw of uniqKw) {
    for (const loc of uniqLoc) {
      for (const tmpl of tmpls) {
        const q = tmpl.replaceAll("{keyword}", kw).replaceAll("{location}", loc).replace(/\s+/g, " ").trim();
        const ql = q.toLowerCase();
        if (!seenQ.has(ql)) { seenQ.add(ql); queries.push(q); }
      }
    }
  }
  return queries;
}
