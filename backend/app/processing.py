import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from .geo import CATEGORY_KEYWORDS, CITIES, DEFAULT_EXCLUSIONS

TRACKING_PARAMS = {
    "ref", "fbclid", "utm_source", "utm_medium", "utm_campaign", "utm_term",
    "utm_content", "mibextid", "_rdc", "_rdr", "locale", "paipv",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", " ", value)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_facebook_url(url: str | None) -> bool:
    if not url:
        return False
    host = urlparse(url).netloc.lower()
    return "facebook.com" in host or "fb.com" in host or "fb.me" in host


def normalize_facebook_url(url: str) -> str:
    if not url:
        return ""
    url = url.strip()
    if not url.startswith("http"):
        url = "https://" + url
    parsed = urlparse(url)
    scheme = "https"
    netloc = parsed.netloc.lower().replace("m.facebook.com", "www.facebook.com")
    if netloc.startswith("facebook.com"):
        netloc = "www." + netloc
    path = parsed.path or "/"
    path = re.sub(r"/+$", "/", path)
    if not path.endswith("/"):
        path += "/"
    # drop tracking query
    q = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k.lower() not in TRACKING_PARAMS]
    query = urlencode(q)
    # profile.php keep id
    if "profile.php" in path:
        qid = [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() == "id"]
        query = urlencode(qid)
        path = "/profile.php"
        if not path.endswith("/"):
            pass
    normalized = urlunparse((scheme, netloc, path.rstrip("/") or "/", "", query, ""))
    if "profile.php" in normalized:
        return normalized
    return normalized.rstrip("/") + "/"


def extract_website(snippet: str, result_url: str) -> str | None:
    if result_url and not is_facebook_url(result_url):
        host = urlparse(result_url).netloc.lower()
        if host and "google." not in host:
            return result_url.split("?")[0]
    if not snippet:
        return None
    matches = re.findall(r"https?://[^\s]+", snippet)
    for m in matches:
        if not is_facebook_url(m) and "google." not in m:
            return m.rstrip(".,)")
    domains = re.findall(r"\b(?:www\.)?[a-z0-9.-]+\.(?:co\.za|com|net|org|travel)\b", snippet, re.I)
    for d in domains:
        if "facebook" not in d.lower() and "google" not in d.lower():
            return "https://" + d.lstrip()
    return None


def classify_category(text: str) -> str:
    blob = (text or "").lower()
    best = "Other"
    best_n = 0
    for cat, kws in CATEGORY_KEYWORDS.items():
        n = sum(1 for k in kws if k in blob)
        if n > best_n:
            best_n = n
            best = cat
    return best


def infer_location(text: str, fallback_city: str | None = None, fallback_province: str | None = None):
    blob = (text or "").lower()
    city = fallback_city or ""
    province = fallback_province or ""
    for prov, cities in CITIES.items():
        for c in cities:
            if c.lower() in blob:
                return c, prov
        if prov.lower() in blob and not province:
            province = prov
    return city, province


def opportunity_score(lead: dict) -> int:
    score = 0
    if lead.get("facebook_url"):
        score += 20
    if lead.get("has_website"):
        score += 10
    else:
        score += 30
    cat = (lead.get("category") or "").lower()
    if cat and cat != "other":
        score += 20
    if lead.get("city") or lead.get("province"):
        score += 10
    name = lead.get("business_name") or ""
    if name and len(name) > 2 and "facebook" not in name.lower():
        score += 10
    return min(100, score)


def exclusion_hit(text: str, exclusions: list[str] | None = None) -> bool:
    blob = (text or "").lower()
    for w in exclusions or DEFAULT_EXCLUSIONS:
        if w.lower() in blob:
            return True
    return False


def business_name_from_title(title: str) -> str:
    t = clean_text(title)
    t = re.sub(r"\s*[|\-–—]\s*Facebook.*$", "", t, flags=re.I)
    t = re.sub(r"\s*on Facebook.*$", "", t, flags=re.I)
    t = re.sub(r"^Facebook\s*[|\-–—]\s*", "", t, flags=re.I)
    return t.strip() or t


def flags_for(lead: dict) -> list[str]:
    flags = []
    if lead.get("facebook_url"):
        flags.append("FACEBOOK RESULT")
        flags.append("VERIFIED URL")
    if lead.get("has_website"):
        flags.append("WEBSITE FOUND")
    else:
        flags.append("NO WEBSITE")
    if lead.get("city") or lead.get("province"):
        flags.append("LOCATION FOUND")
    if lead.get("category") and lead.get("category") != "Other":
        flags.append("CATEGORY FOUND")
    return flags
