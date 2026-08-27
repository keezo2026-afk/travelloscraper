function env(name) {
  return process.env[name] || "";
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
  return serpapi(query, num);
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
  if (r.status === 429) throw Object.assign(new Error("SerpAPI rate limit"), { retryable: true });
  if (!r.ok) throw Object.assign(new Error(`SerpAPI error ${r.status}`), { retryable: r.status >= 500 });
  const data = await r.json();
  if (data.error) throw Object.assign(new Error(String(data.error)), { retryable: true });
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
  if (r.status === 429) throw Object.assign(new Error("Google CSE rate limit"), { retryable: true });
  if (!r.ok) throw Object.assign(new Error(`Google CSE error ${r.status}`), { retryable: r.status >= 500 });
  const data = await r.json();
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
  if (r.status === 429) throw Object.assign(new Error("Brave rate limit"), { retryable: true });
  if (!r.ok) throw Object.assign(new Error(`Brave error ${r.status}`), { retryable: r.status >= 500 });
  const data = await r.json();
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
  if (r.status === 429) throw Object.assign(new Error("Bing rate limit"), { retryable: true });
  if (!r.ok) throw Object.assign(new Error(`Bing error ${r.status}`), { retryable: r.status >= 500 });
  const data = await r.json();
  return ((data.webPages && data.webPages.value) || []).map((item, i) => ({
    title: item.name || "",
    url: item.url || "",
    snippet: item.snippet || "",
    position: i + 1,
  }));
}
