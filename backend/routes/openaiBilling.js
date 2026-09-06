// backend/routes/openaiBilling.js
//
// OpenAI billing summary proxy — holds the OpenAI Admin API key server-side
// so it never reaches the browser. Calls OpenAI's official Costs API
// (https://platform.openai.com/docs — Usage & Cost APIs) and returns a
// clean summary for the dashboard's Settings page.
//
// IMPORTANT: This requires an ADMIN API key, not a regular project API key.
// Regular keys (sk-proj-...) cannot call the organization Costs API and
// will get a 401. Generate an Admin key at:
//   https://platform.openai.com/settings/organization/admin-keys
//
// SETUP (Railway -> this service -> Variables):
//   OPENAI_ADMIN_KEY   the admin key from the link above

const express = require('express');
const router = express.Router();

const OPENAI_ADMIN_KEY = process.env.OPENAI_ADMIN_KEY;

function rangeToStartTime(range) {
  const now = new Date();
  const start = new Date(now);
  if (range === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    start.setDate(start.getDate() - 7);
  } else { // 'month'
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return Math.floor(start.getTime() / 1000);
}

async function fetchAllPages(url, params) {
  const results = [];
  let pageCursor = null;
  for (let i = 0; i < 20; i++) { // hard safety cap on pagination loops
    const query = new URLSearchParams(params);
    if (pageCursor) query.set('page', pageCursor);
    const res = await fetch(`${url}?${query.toString()}`, {
      headers: { Authorization: `Bearer ${OPENAI_ADMIN_KEY}`, 'Content-Type': 'application/json' }
    });
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

// GET /api/openai-billing/summary?range=today|7d|month
router.get('/summary', require('../middleware/auth').requireAuth, async (req, res) => {
  try {
    if (!OPENAI_ADMIN_KEY) {
      return res.status(500).json({ error: 'OPENAI_ADMIN_KEY is not configured on this server yet.' });
    }
    const range = req.query.range || 'month';
    const startTime = rangeToStartTime(range);

    const buckets = await fetchAllPages('https://api.openai.com/v1/organization/costs', {
      start_time: startTime,
      bucket_width: '1d',
      limit: 31,
      'group_by[]': 'line_item'
    });

    let totalUsd = 0;
    const byLineItem = {};
    const dailyTotals = []; // [{ date: 'YYYY-MM-DD', amount: number }]

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

    res.json({ range, totalUsd, currency: 'usd', dailyTotals, topLineItems });
  } catch (err) {
    console.error('OpenAI billing summary error:', err);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
