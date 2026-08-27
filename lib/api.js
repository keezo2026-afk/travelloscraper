export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.detail || JSON.stringify(j);
    } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}
