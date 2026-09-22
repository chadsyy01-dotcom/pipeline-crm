// backend/routes/openaiBilling.js
//
// OpenAI billing proxy — holds OpenAI Admin API key(s) server-side.
// Supports multiple OpenAI organizations/accounts via the OPENAI_ACCOUNTS
// env var, and exposes the OFFICIAL, documented Costs API
// (https://api.openai.com/v1/organization/costs).
//
// NOTE: OpenAI does not currently offer a public API for "Billing history"
// (invoice list) or live prepaid credit balance — those are only visible in
// the platform.openai.com dashboard UI. An old undocumented endpoint
// (/v1/dashboard/billing/credit_grants) exists but is unsupported and can
// change or disappear without notice, so it's intentionally not used here.
//
// SETUP (Railway -> this service -> Variables):
//   OPENAI_ACCOUNTS   a JSON array of accounts, each with a name and an
//                      Admin API key (from platform.openai.com/settings/
//                      organization/admin-keys). Example:
//                      [{"name":"Main Account","key":"sk-admin-xxxx"},
//                       {"name":"Second Account","key":"sk-admin-yyyy"}]
//                      Optional per account: "org" — any label shared by
//                      accounts that live in the SAME OpenAI organization,
//                      e.g. {"name":"Buenas PH","key":"sk-admin-..","org":"fhbpo"}.
//                      OpenAI's 10-requests-a-minute limit is counted per
//                      organization, not per key, so accounts sharing an org
//                      must share a request queue. Without "org", each key
//                      gets its own queue.
//
// ---------------------------------------------------------------------------
// RATE LIMITS (reworked 2026-09-22)
//
// The Costs API allows 10 requests a minute per organization. The page kept
// hitting that ("HTTP 429 … exceeded the 10 request(s) every 1 minute(s)")
// because every page load by every person asked OpenAI again for all ten
// accounts at once. Four things now keep this well under the limit:
//
//   1. SHARED CACHE — one answer per account + period, served to everyone for
//      CACHE_TTL_MS. Ten people opening the page cost OpenAI nothing extra.
//   2. IN-FLIGHT SHARING — if the same figure is already being fetched, a
//      second request waits for that answer instead of asking again.
//   3. A QUEUE PER ORGANIZATION — calls to one organization go out one at a
//      time, at least MIN_GAP_MS apart (~8 a minute), so a burst can't trip
//      the limit. Different organizations still run side by side.
//   4. STALE FALLBACK — if OpenAI still refuses (someone else using the same
//      key, say), the last good figure is returned, marked `stale`, rather
//      than an error. Billing moves slowly; a figure a few minutes old is far
//      more useful than a red warning.
//
// On top of that, a BACKGROUND WARMER refreshes "This Month" for every
// account every WARM_EVERY_MS, so the page's default view is always served
// straight from the cache.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();

function getAccounts() {
  try {
    return JSON.parse(process.env.OPENAI_ACCOUNTS || '[]');
  } catch (e) {
    console.error('OPENAI_ACCOUNTS is not valid JSON:', e.message);
    return [];
  }
}

const ACCOUNT_HISTORY_START = new Date('2020-01-01T00:00:00Z');

const CACHE_TTL_MS = 10 * 60 * 1000;        // fresh for 10 minutes
const STALE_MAX_MS = 12 * 60 * 60 * 1000;   // fall back to a figure up to 12h old
const MIN_GAP_MS = 7000;                    // ≤ ~8.5 calls/minute per organization
const WARM_EVERY_MS = 10 * 60 * 1000;

// Resolves a request's range into { startTime, endTime } (unix seconds).
// endTime is null unless the range needs an explicit upper bound (previous
// month, or a custom range) — the Costs API defaults to "now" when omitted.
//
// Every start is snapped to a calendar day (2026-09-22): the Costs API works
// in daily buckets anyway, and a start that moved with the clock ("7 days ago
// to the second") gave every request a different cache key.
function resolveRange(req) {
  const range = req.query.range || 'month';
  const now = new Date();

  if (range === 'custom') {
    const start = req.query.start ? new Date(req.query.start) : null;
    const end = req.query.end ? new Date(req.query.end) : null;
    if (!start || isNaN(start.getTime())) throw new Error('A valid "start" date is required for a custom range.');
    // End is inclusive of that whole day. With no end, the range is open and
    // the Costs API runs it up to now.
    const endTime = end && !isNaN(end.getTime())
      ? Math.floor(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime() / 1000)
      : null;
    return { startTime: Math.floor(start.getTime() / 1000), endTime, label: 'Custom range' };
  }

  if (range === 'prev_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1); // exclusive upper bound = first of this month
    return { startTime: Math.floor(start.getTime() / 1000), endTime: Math.floor(end.getTime() / 1000), label: 'Previous month' };
  }

  if (range === 'all') {
    return { startTime: Math.floor(ACCOUNT_HISTORY_START.getTime() / 1000), endTime: null, label: 'All time' };
  }

  const start = new Date(now);
  if (range === '7d') {
    start.setDate(start.getDate() - 7);
  } else if (range !== 'today') { // 'month'
    start.setDate(1);
  }
  start.setHours(0, 0, 0, 0);
  return { startTime: Math.floor(start.getTime() / 1000), endTime: null, label: null };
}

// Given a resolved { startTime, endTime }, returns the immediately preceding
// period of the same length — used for "compare to previous period".
function priorPeriod({ startTime, endTime }) {
  const end = endTime || Math.floor(Date.now() / 1000);
  const durationSec = end - startTime;
  return { startTime: startTime - durationSec, endTime: startTime };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- per-organization request queue ----
// Each organization gets a promise chain; a call waits for the previous one
// on the same chain plus MIN_GAP_MS. Keyed by the account's "org" label when
// given, otherwise by the key itself.
const queues = new Map();   // queueKey -> { tail: Promise, lastAt: number }
function queueKeyFor(account) {
  return account.org ? `org:${String(account.org).toLowerCase()}` : `key:${String(account.key).slice(-12)}`;
}
function throttled(queueKey, fn) {
  const q = queues.get(queueKey) || { tail: Promise.resolve(), lastAt: 0 };
  const run = q.tail.then(async () => {
    const wait = q.lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    q.lastAt = Date.now();
    return fn();
  });
  // The chain continues whether this call succeeded or not.
  q.tail = run.catch(() => {});
  queues.set(queueKey, q);
  return run;
}

async function fetchAllPages(url, params, account) {
  const results = [];
  const qKey = queueKeyFor(account);
  let pageCursor = null;
  for (let i = 0; i < 100; i++) { // hard safety cap on pagination loops (covers multi-year "all time" ranges)
    const query = new URLSearchParams(params);
    if (pageCursor) query.set('page', pageCursor);

    const doFetch = () => fetch(`${url}?${query.toString()}`, {
      headers: { Authorization: `Bearer ${account.key}`, 'Content-Type': 'application/json' }
    });

    // Every call — first page or tenth, first try or retry — goes through
    // this organization's queue, so the spacing holds across all requests.
    let res = await throttled(qKey, doFetch);
    // Still rate-limited (e.g. something outside this app is using the same
    // organization): wait out most of the minute once, then try again.
    if (res.status === 429) {
      await sleep(20000);
      res = await throttled(qKey, doFetch);
    }
    const bodyText = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} from ${url} — body starts with: ${bodyText.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const json = JSON.parse(bodyText);
    results.push(...(json.data || []));
    pageCursor = json.next_page;
    if (!pageCursor) break;
  }
  return results;
}

// Fetches total cost (and daily breakdown + line items) for one resolved
// { startTime, endTime } window, for a given account.
async function fetchCostSummary({ startTime, endTime }, account) {
  const params = { start_time: startTime, bucket_width: '1d', limit: 180, 'group_by[]': 'line_item' };
  if (endTime) params.end_time = endTime;
  const buckets = await fetchAllPages('https://api.openai.com/v1/organization/costs', params, account);

  let totalUsd = 0;
  const byLineItem = {};
  const dailyTotals = [];
  buckets.forEach(bucket => {
    const dateLabel = new Date(bucket.start_time * 1000).toISOString().slice(0, 10);
    let dayTotal = 0;
    (bucket.results || []).forEach(r => {
      const amt = (r.amount && r.amount.value) || 0;
      totalUsd += amt;
      dayTotal += amt;
      const label = r.line_item || 'Other';
      byLineItem[label] = (byLineItem[label] || 0) + amt;
    });
    dailyTotals.push({ date: dateLabel, amount: dayTotal });
  });
  const topLineItems = Object.entries(byLineItem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, amount]) => ({ label, amount }));

  return { totalUsd, dailyTotals, topLineItems };
}

// ---- shared cache ----
// Keyed by account + period. Never holds the API key itself — only its last
// characters, to tell accounts apart.
const cache = new Map();      // cacheKey -> { at, value }
const inflight = new Map();   // cacheKey -> Promise

function cacheKeyFor({ startTime, endTime }, account) {
  return `${String(account.key).slice(-12)}|${startTime}|${endTime || 'open'}`;
}

// Returns { ...summary, fetchedAt, stale }. `force` skips a fresh cache hit
// (used by the warmer) but still shares an in-flight request.
async function cachedCostSummary(resolved, account, { force = false } = {}) {
  const key = cacheKeyFor(resolved, account);
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, fetchedAt: hit.at, stale: false };
  }
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await fetchCostSummary(resolved, account);
      const at = Date.now();
      cache.set(key, { at, value });
      return { ...value, fetchedAt: at, stale: false };
    } catch (err) {
      // Serve the last good figure rather than an error, if it isn't too old.
      if (hit && Date.now() - hit.at < STALE_MAX_MS) {
        console.warn(`OpenAI billing: ${account.name || 'account'} — serving cached figure from ${new Date(hit.at).toISOString()} (${err.message.slice(0, 80)})`);
        return { ...hit.value, fetchedAt: hit.at, stale: true };
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// Merges multiple accounts' cost summaries into one aggregate view, and
// keeps a per-account breakdown so the caller can see each one's share.
function aggregateAccounts(perAccountResults, accounts) {
  let totalUsd = 0;
  const dailyMap = {};
  const byLineItem = {};
  const byAccount = [];

  perAccountResults.forEach((result, i) => {
    totalUsd += result.totalUsd;
    byAccount.push({ name: accounts[i].name || `Account ${i + 1}`, totalUsd: result.totalUsd });
    result.dailyTotals.forEach(d => { dailyMap[d.date] = (dailyMap[d.date] || 0) + d.amount; });
    result.topLineItems.forEach(li => { byLineItem[li.label] = (byLineItem[li.label] || 0) + li.amount; });
  });

  const dailyTotals = Object.entries(dailyMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, amount]) => ({ date, amount }));
  const topLineItems = Object.entries(byLineItem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, amount]) => ({ label, amount }));
  byAccount.sort((a, b) => b.totalUsd - a.totalUsd);

  return { totalUsd, dailyTotals, topLineItems, byAccount };
}

// The oldest fetch time among several results, and whether any is stale —
// so the response can say how current the figure it shows actually is.
function freshness(results) {
  const times = results.map(r => r.fetchedAt).filter(Boolean);
  return {
    asOf: times.length ? new Date(Math.min(...times)).toISOString() : null,
    stale: results.some(r => r.stale),
  };
}

// GET /api/openai-billing/accounts
// Lists configured account names only — never exposes the keys.
router.get('/accounts', require('../middleware/auth').requireAuth, (req, res) => {
  const accounts = getAccounts();
  res.json({ accounts: accounts.map((a, i) => ({ name: a.name || `Account ${i + 1}`, index: i })) });
});

// GET /api/openai-billing/summary?account=<index>|all&range=today|7d|month|prev_month|all|custom
//   &start=YYYY-MM-DD&end=YYYY-MM-DD (custom range only)
//   &compare=true (also fetches the immediately preceding period of equal length)
// Response also carries `asOf` (when the figures were fetched from OpenAI)
// and `stale` (true when OpenAI refused and a cached figure was served).
router.get('/summary', require('../middleware/auth').requireAuth, async (req, res) => {
  try {
    const accounts = getAccounts();
    if (accounts.length === 0) {
      return res.status(500).json({ error: 'OPENAI_ACCOUNTS is not configured on this server yet.' });
    }

    const resolved = resolveRange(req);
    const isAllAccounts = req.query.account === 'all';
    const used = [];

    let current, byAccount = null;
    if (isAllAccounts) {
      // Accounts start together, but each call still waits its turn in its
      // organization's queue — accounts sharing an org are spaced out, and
      // separate orgs run in parallel.
      const perAccount = await Promise.all(accounts.map(a => cachedCostSummary(resolved, a)));
      used.push(...perAccount);
      const aggregated = aggregateAccounts(perAccount, accounts);
      current = aggregated;
      byAccount = aggregated.byAccount;
    } else {
      const accountIndex = Number(req.query.account) || 0;
      const account = accounts[accountIndex];
      if (!account || !account.key) {
        return res.status(400).json({ error: 'Unknown account.' });
      }
      current = await cachedCostSummary(resolved, account);
      used.push(current);
    }

    let comparison = null;
    if (req.query.compare === 'true' && req.query.range !== 'all') {
      const prior = priorPeriod(resolved);
      if (isAllAccounts) {
        const perAccountPrior = await Promise.all(accounts.map(a => cachedCostSummary(prior, a)));
        used.push(...perAccountPrior);
        comparison = { totalUsd: aggregateAccounts(perAccountPrior, accounts).totalUsd };
      } else {
        const accountIndex = Number(req.query.account) || 0;
        const priorSummary = await cachedCostSummary(prior, accounts[accountIndex]);
        used.push(priorSummary);
        comparison = { totalUsd: priorSummary.totalUsd };
      }
    }

    res.json({
      range: req.query.range || 'month',
      rangeLabel: resolved.label,
      account: isAllAccounts ? `All Accounts (${accounts.length})` : (accounts[Number(req.query.account) || 0].name || 'Account'),
      totalUsd: current.totalUsd,
      currency: 'usd',
      dailyTotals: current.dailyTotals,
      topLineItems: current.topLineItems,
      byAccount,
      comparison,
      ...freshness(used),
    });
  } catch (err) {
    console.error('OpenAI billing summary error:', err);
    res.status(502).json({ error: err.message });
  }
});

// ---- background warmer ----
// Keeps "This Month" for every account in the cache, so the page's default
// view — and the Consolidated Billing block's live Open AI column — never has
// to wait on OpenAI. Runs 30s after boot, then every WARM_EVERY_MS. Each
// account's call goes through its organization's queue, so the warm-up
// itself stays under the limit.
async function warmThisMonth() {
  const accounts = getAccounts();
  if (!accounts.length) return;
  const resolved = resolveRange({ query: { range: 'month' } });
  const results = await Promise.allSettled(accounts.map(a => cachedCostSummary(resolved, a, { force: true })));
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed) console.warn(`OpenAI billing warm-up: ${failed} of ${accounts.length} account(s) could not be refreshed this round.`);
}
setTimeout(() => { warmThisMonth().catch(() => {}); }, 30 * 1000);
setInterval(() => { warmThisMonth().catch(() => {}); }, WARM_EVERY_MS);

module.exports = router;
