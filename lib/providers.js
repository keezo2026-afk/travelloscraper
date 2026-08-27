function env(name) {
  return process.env[name] || "";
}

const RETRYABLE_STATUSES = new Set([408, 429]);

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function errorDetails(payload, raw) {
  const error = payload && payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const reasons = Array.isArray(error.errors)
      ? error.errors.map((item) => item && item.reason).filter(Boolean)
      : [];
    const status = error.status;
    const message = error.message;
    return [...new Set([...reasons, status, message].map(compact).filter(Boolean))].join(" — ");
  }
  return compact(payload?.message || raw);
}

function providerError(name, status, payload, raw = "") {
  const detail = errorDetails(payload, raw);
  const message = `${name} error ${status}${detail ? `: ${detail}` : ""}`;
  return Object.assign(new Error(message), {
    provider: name,
    status,
    reason: detail,
    retryable: RETRYABLE_STATUSES.has(status) || status >= 500,
  });
}

async function responseError(name, response) {
  let raw = "";
  try { raw = await response.text(); } catch {}
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch {}
  return providerError(name, response.status, payload, raw);
}

async function responseJson(name, response) {
  if (!response.ok) throw await responseError(name, response);
  try {
    return await response.json();
  } catch {
    throw Object.assign(new Error(`${name} returned an invalid JSON response`), {
      provider: name,
      retryable: true,
    });
  }
}

export function providerStatus() {
  const current = (env("SEARCH_PROVIDER") || "serpapi").toLowerCase();
  return {
    current,
    providers: {
      serpapi: { configured: Boolean(env("SEARCH_API_KEY")) },
      google_cse: { configured: Boolean(env("SEARCH_API_KEY") && env("GOOGLE_CSE_ID")) },
      brave: { configured: Boolean(env("BRAVE_API_KEY") || env("SEARCH_API_KEY")) },
      bing: { configured: Boolean(env("BING_API_KEY") || env("SEARCH_API_KEY")) },
    },
  };
}

export async function runSearch(query, num = 10) {
  const name = (env("SEARCH_PROVIDER") || "serpapi").toLowerCase();
  if (name === "google_cse") return googleCse(query, num);
  if (name === "brave") return brave(query, num);
  if (name === "bing") return bing(query, num);
  if (name === "serpapi") return serpapi(query, num);
  throw Object.assign(new Error(`Unknown search provider "${name}"`), { retryable: false });
}

async function serpapi(query, num) {
  const key = env("SEARCH_API_KEY");
  if (!key) throw Object.assign(new Error("SEARCH_API_KEY is not set for SerpAPI"), { retryable: false });
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google");
  u.searchParams.set("q", query);
  u.searchParams.set("api_key", key);
  u.searchParams.set("num", String(Math.min(num, 20)));
  u.searchParams.set("gl", "za");
  u.searchParams.set("hl", "en");
  const r = await fetch(u);
  const data = await responseJson("SerpAPI", r);
  if (data.error) throw providerError("SerpAPI", 400, data);
  return (data.organic_results || []).map((item, i) => ({
    title: item.title || "",
    url: item.link || "",
    snippet: item.snippet || "",
    position: item.position || i + 1,
  }));
}

async function googleCse(query, num) {
  const key = env("SEARCH_API_KEY");
  const cx = env("GOOGLE_CSE_ID");
  if (!key || !cx) throw Object.assign(new Error("SEARCH_API_KEY and GOOGLE_CSE_ID required"), { retryable: false });
  const u = new URL("https://www.googleapis.com/customsearch/v1");
  u.searchParams.set("key", key);
  u.searchParams.set("cx", cx);
  u.searchParams.set("q", query);
  u.searchParams.set("num", String(Math.min(num, 10)));
  u.searchParams.set("gl", "za");
  const r = await fetch(u);
  const data = await responseJson("Google CSE", r);
  return (data.items || []).map((item, i) => ({
    title: item.title || "",
    url: item.link || "",
    snippet: item.snippet || "",
    position: i + 1,
  }));
}

async function brave(query, num) {
  const key = env("BRAVE_API_KEY") || env("SEARCH_API_KEY");
  if (!key) throw Object.assign(new Error("BRAVE_API_KEY is not set"), { retryable: false });
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", query);
  u.searchParams.set("count", String(Math.min(num, 20)));
  u.searchParams.set("country", "ZA");
  const r = await fetch(u, { headers: { Accept: "application/json", "X-Subscription-Token": key } });
  const data = await responseJson("Brave", r);
  return ((data.web && data.web.results) || []).map((item, i) => ({
    title: item.title || "",
    url: item.url || "",
    snippet: item.description || "",
    position: i + 1,
  }));
}

async function bing(query, num) {
  const key = env("BING_API_KEY") || env("SEARCH_API_KEY");
  if (!key) throw Object.assign(new Error("BING_API_KEY is not set"), { retryable: false });
  const u = new URL("https://api.bing.microsoft.com/v7.0/search");
  u.searchParams.set("q", query);
  u.searchParams.set("count", String(Math.min(num, 50)));
  u.searchParams.set("mkt", "en-ZA");
  const r = await fetch(u, { headers: { "Ocp-Apim-Subscription-Key": key } });
  const data = await responseJson("Bing", r);
  return ((data.webPages && data.webPages.value) || []).map((item, i) => ({
    title: item.name || "",
    url: item.url || "",
    snippet: item.snippet || "",
    position: i + 1,
  }));
}
