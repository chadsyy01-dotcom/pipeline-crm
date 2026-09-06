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

function rangeToStartTime(range) {
  const now = new Date();
  const start = new Date(now);
  if (range === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    start.setDate(start.getDate() - 7);
  } else if (range === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else { // 'all' — since OpenAI accounts didn't exist before this, this
    // safely covers any account's full lifetime.
    return Math.floor(new Date('2020-01-01T00:00:00Z').getTime() / 1000);
  }
  return Math.floor(start.getTime() / 1000);
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

// GET /api/openai-billing/accounts
// Lists configured account names only — never exposes the keys.
router.get('/accounts', require('../middleware/auth').requireAuth, (req, res) => {
  const accounts = getAccounts();
  res.json({ accounts: accounts.map((a, i) => ({ name: a.name || `Account ${i + 1}`, index: i })) });
});

// GET /api/openai-billing/summary?account=<index>&range=today|7d|month
router.get('/summary', require('../middleware/auth').requireAuth, async (req, res) => {
  try {
    const accounts = getAccounts();
    if (accounts.length === 0) {
      return res.status(500).json({ error: 'OPENAI_ACCOUNTS is not configured on this server yet.' });
    }
    const accountIndex = Number(req.query.account) || 0;
    const account = accounts[accountIndex];
    if (!account || !account.key) {
      return res.status(400).json({ error: 'Unknown account.' });
    }

    const range = req.query.range || 'month';
    const startTime = rangeToStartTime(range);

    // --- Costs API ---
    const costBuckets = await fetchAllPages(
      'https://api.openai.com/v1/organization/costs',
      { start_time: startTime, bucket_width: '1d', limit: 180, 'group_by[]': 'line_item' },
      account.key
    );
    let totalUsd = 0;
    const byLineItem = {};
    const dailyTotals = [];
    costBuckets.forEach(bucket => {
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

    res.json({
      range,
      account: account.name || `Account ${accountIndex + 1}`,
      totalUsd,
      currency: 'usd',
      dailyTotals,
      topLineItems
    });
  } catch (err) {
    console.error('OpenAI billing summary error:', err);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
