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

// Resolves a request's range into { startTime, endTime } (unix seconds).
// endTime is null unless the range needs an explicit upper bound (previous
// month, or a custom range) — the Costs API defaults to "now" when omitted.
function resolveRange(req) {
  const range = req.query.range || 'month';
  const now = new Date();

  if (range === 'custom') {
    const start = req.query.start ? new Date(req.query.start) : null;
    const end = req.query.end ? new Date(req.query.end) : null;
    if (!start || isNaN(start.getTime())) throw new Error('A valid "start" date is required for a custom range.');
    // End is inclusive of that whole day.
    const endTime = end && !isNaN(end.getTime())
      ? Math.floor(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime() / 1000)
      : Math.floor(now.getTime() / 1000);
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
  if (range === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    start.setDate(start.getDate() - 7);
  } else { // 'month'
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
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

async function fetchAllPages(url, params, adminKey) {
  const results = [];
  let pageCursor = null;
  for (let i = 0; i < 100; i++) { // hard safety cap on pagination loops (raised to cover multi-year "all time" ranges)
    const query = new URLSearchParams(params);
    if (pageCursor) query.set('page', pageCursor);

    // OpenAI's Costs API allows only 10 requests/minute. Space requests out
    // (6.5s apart) so multi-page "All Time" pulls don't trip that limit —
    // skipped before the very first request, since most ranges only need one.
    if (i > 0) await sleep(6500);

    let res = await fetch(`${url}?${query.toString()}`, {
      headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' }
    });
    // If we still get rate-limited (e.g. another process is also calling the
    // API), back off once and retry rather than failing the whole request.
    if (res.status === 429) {
      await sleep(15000);
      res = await fetch(`${url}?${query.toString()}`, {
        headers: { Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' }
      });
    }
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url} — body starts with: ${bodyText.slice(0, 200)}`);
    }
    const json = JSON.parse(bodyText);
    results.push(...(json.data || []));
    pageCursor = json.next_page;
    if (!pageCursor) break;
  }
  return results;
}

// Fetches total cost (and daily breakdown + line items) for one resolved
// { startTime, endTime } window, for a given account key.
async function fetchCostSummary({ startTime, endTime }, adminKey) {
  const params = { start_time: startTime, bucket_width: '1d', limit: 180, 'group_by[]': 'line_item' };
  if (endTime) params.end_time = endTime;
  const buckets = await fetchAllPages('https://api.openai.com/v1/organization/costs', params, adminKey);

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

// GET /api/openai-billing/accounts
// Lists configured account names only — never exposes the keys.
router.get('/accounts', require('../middleware/auth').requireAuth, (req, res) => {
  const accounts = getAccounts();
  res.json({ accounts: accounts.map((a, i) => ({ name: a.name || `Account ${i + 1}`, index: i })) });
});

// GET /api/openai-billing/summary?account=<index>|all&range=today|7d|month|prev_month|all|custom
//   &start=YYYY-MM-DD&end=YYYY-MM-DD (custom range only)
//   &compare=true (also fetches the immediately preceding period of equal length)
router.get('/summary', require('../middleware/auth').requireAuth, async (req, res) => {
  try {
    const accounts = getAccounts();
    if (accounts.length === 0) {
      return res.status(500).json({ error: 'OPENAI_ACCOUNTS is not configured on this server yet.' });
    }

    const resolved = resolveRange(req);
    const isAllAccounts = req.query.account === 'all';

    let current, byAccount = null;
    if (isAllAccounts) {
      // Different accounts use different API keys, so each has its own
      // independent OpenAI rate-limit budget — safe to fetch in parallel.
      const perAccount = await Promise.all(accounts.map(a => fetchCostSummary(resolved, a.key)));
      const aggregated = aggregateAccounts(perAccount, accounts);
      current = aggregated;
      byAccount = aggregated.byAccount;
    } else {
      const accountIndex = Number(req.query.account) || 0;
      const account = accounts[accountIndex];
      if (!account || !account.key) {
        return res.status(400).json({ error: 'Unknown account.' });
      }
      current = await fetchCostSummary(resolved, account.key);
    }

    let comparison = null;
    if (req.query.compare === 'true' && req.query.range !== 'all') {
      const prior = priorPeriod(resolved);
      if (isAllAccounts) {
        const perAccountPrior = await Promise.all(accounts.map(a => fetchCostSummary(prior, a.key)));
        comparison = { totalUsd: aggregateAccounts(perAccountPrior, accounts).totalUsd };
      } else {
        const accountIndex = Number(req.query.account) || 0;
        const priorSummary = await fetchCostSummary(prior, accounts[accountIndex].key);
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
      comparison
    });
  } catch (err) {
    console.error('OpenAI billing summary error:', err);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
