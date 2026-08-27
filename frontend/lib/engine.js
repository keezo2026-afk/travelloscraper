import { loadStore, saveStore, nid, logEvent } from "./store";
import { runSearch } from "./providers";
import {
  businessNameFromTitle, classifyCategory, cleanText, extractWebsite, flagsFor,
  inferLocation, isFacebookUrl, normalizeFacebookUrl, nowIso, opportunityScore,
} from "./processing";

export function processResult(campaignId, queryId, queryText, item) {
  const s = loadStore();
  const title = cleanText(item.title);
  const url = (item.url || "").trim();
  const snippet = cleanText(item.snippet);
  const pos = item.position || 0;
  s.search_results.push({
    id: nid(), campaign_id: campaignId, query_id: queryId, title, url, snippet,
    search_position: pos, search_query: queryText, search_date: nowIso(),
    is_facebook: isFacebookUrl(url) ? 1 : 0,
  });
  if (!isFacebookUrl(url)) return { facebook: false, new: false, dup: false };
  const norm = normalizeFacebookUrl(url);
  const website = extractWebsite(snippet, "") || "";
  const name = businessNameFromTitle(title);
  const blob = `${title} ${snippet} ${queryText}`;
  const category = classifyCategory(blob);
  const [city, province] = inferLocation(blob);
  const existing = s.leads.find((l) => l.normalized_url === norm);
  const ts = nowIso();
  let leadId;
  let isNew = false;
  if (existing) {
    existing.last_discovered = ts;
    existing.discovery_count += 1;
    if (!existing.website && website) { existing.website = website; existing.has_website = 1; }
    if (!existing.city && city) existing.city = city;
    if (!existing.province && province) existing.province = province;
    if (!existing.category || existing.category === "Other") existing.category = category;
    leadId = existing.id;
    existing.opportunity_score = opportunityScore(existing);
    existing.flags_json = JSON.stringify(flagsFor(existing));
  } else {
    const lead = {
      id: nid(),
      business_name: name,
      facebook_url: norm,
      normalized_url: norm,
      website,
      has_website: website ? 1 : 0,
      category, city, province,
      country: "South Africa",
      opportunity_score: 0,
      description: snippet,
      source: "search",
      first_discovered: ts,
      last_discovered: ts,
      discovery_count: 1,
      email: "", phone: "",
      status: "New", notes: "", priority: "Medium",
      assigned_date: "", website_status: "UNKNOWN",
      flags_json: "[]",
    };
    lead.opportunity_score = opportunityScore(lead);
    lead.flags_json = JSON.stringify(flagsFor(lead));
    s.leads.push(lead);
    leadId = lead.id;
    isNew = true;
  }
  s.lead_discoveries.push({ id: nid(), lead_id: leadId, query_text: queryText, campaign_id: campaignId, discovered_at: ts });
  return { facebook: true, new: isNew, dup: !isNew };
}

export async function tickCampaign(campaignId) {
  const s = loadStore();
  const camp = s.campaigns.find((c) => c.id === campaignId);
  if (!camp) throw new Error("Campaign not found");
  if (camp.status === "Paused" || camp.status === "Completed" || camp.status === "Failed") {
    s.live = {
      campaign_id: campaignId,
      status: camp.status,
      done: camp.completed_queries,
      total: camp.total_queries,
      ...(camp.error_message ? { error: camp.error_message } : {}),
    };
    saveStore();
    return s.live;
  }
  const q = s.queries.filter((x) => x.campaign_id === campaignId && (x.status === "pending" || x.status === "retry"))
    .sort((a, b) => a.position - b.position)[0];
  const done = s.queries.filter((x) => x.campaign_id === campaignId && x.status === "completed").length;
  if (!q) {
    const failed = s.queries.find((x) => x.campaign_id === campaignId && x.status === "failed");
    camp.status = failed ? "Failed" : "Completed";
    camp.completed_at = failed ? null : nowIso();
    camp.error_message = failed?.error_message || null;
    camp.updated_at = nowIso();
    s.live = {
      campaign_id: campaignId,
      status: camp.status,
      done,
      total: camp.total_queries,
      ...(camp.error_message ? { error: camp.error_message } : {}),
    };
    logEvent(failed ? `Campaign stopped: ${camp.error_message}` : "Campaign completed", failed ? "ERROR" : "INFO");
    saveStore();
    return s.live;
  }
  const numValue = Number(s.settings.RESULTS_PER_QUERY || process.env.RESULTS_PER_QUERY || 10);
  const num = Number.isFinite(numValue) ? Math.max(1, numValue) : 10;
  const retryValue = Number(s.settings.RETRY_COUNT || process.env.RETRY_COUNT || 3);
  const retryLimit = Number.isFinite(retryValue) ? Math.max(1, retryValue) : 3;
  logEvent(`Query ${q.query_text}`);
  try {
    const results = await runSearch(q.query_text, num);
    let fb = 0, neu = 0, dup = 0;
    for (const item of results) {
      const info = processResult(campaignId, q.id, q.query_text, item);
      if (info.facebook) {
        fb += 1;
        if (info.new) neu += 1;
        if (info.dup) dup += 1;
      }
    }
    q.status = "completed";
    q.attempts = (q.attempts || 0) + 1;
    q.results_count = results.length;
    q.facebook_count = fb;
    q.new_leads = neu;
    q.duplicates = dup;
    q.last_run_at = nowIso();
    q.error_message = null;
    camp.completed_queries = done + 1;
    camp.last_query_index = q.position;
    camp.results_found += results.length;
    camp.facebook_found += fb;
    camp.new_leads += neu;
    camp.duplicates += dup;
    camp.updated_at = nowIso();
    camp.status = "Running";
    camp.error_message = null;
    s.live = {
      campaign_id: campaignId, status: "Running",
      done: camp.completed_queries, total: camp.total_queries,
      current_query: q.query_text, results: results.length, facebook: fb, new_leads: neu, duplicates: dup,
    };
    logEvent(`${results.length} results, ${fb} Facebook URLs, ${neu} new leads, ${dup} duplicates`);
  } catch (e) {
    q.attempts = (q.attempts || 0) + 1;
    q.error_message = e.message;
    q.last_run_at = nowIso();
    const canRetry = e.retryable !== false && q.attempts < retryLimit;
    q.status = canRetry ? "retry" : "failed";
    camp.updated_at = nowIso();
    if (canRetry) {
      camp.status = "Running";
      s.live = { campaign_id: campaignId, status: "Running", done, total: camp.total_queries, current_query: q.query_text, error: e.message, retrying: true };
      logEvent(`${e.message} (retry ${q.attempts}/${retryLimit})`, "ERROR");
    } else {
      camp.status = "Failed";
      camp.error_message = e.message;
      s.live = {
        campaign_id: campaignId,
        status: "Failed",
        done,
        total: camp.total_queries,
        current_query: q.query_text,
        error: e.message,
        retryable: e.retryable !== false,
      };
      logEvent(`${e.message}${e.retryable === false ? " (check search provider configuration)" : " (retry limit reached)"}`, "ERROR");
    }
  }
  saveStore();
  return s.live;
}
