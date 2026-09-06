// backend/routes/chatwoot.js
//
// Chatwoot analytics proxy — holds the Chatwoot API token server-side so it
// never reaches the browser. The Live Chat dashboard page calls this route
// (authenticated the same way as everything else in this API), and this
// route in turn calls Chatwoot on its behalf.
//
// SETUP (Railway → this service → Variables):
//   CHATWOOT_URL          e.g. https://support.buenas.ph   (no trailing slash)
//   CHATWOOT_ACCOUNT_ID   e.g. 1
//   CHATWOOT_API_TOKEN    from Chatwoot: Profile Settings -> Access Token

const express = require('express');
const router = express.Router();

const CHATWOOT_URL = process.env.CHATWOOT_URL;
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const API_TOKEN = process.env.CHATWOOT_API_TOKEN;

function chatwootHeaders() {
  return { api_access_token: API_TOKEN, 'Content-Type': 'application/json' };
}

// Fetches a URL and safely parses JSON, throwing a descriptive error (with
// status code + a snippet of the raw body) if the response isn't OK or isn't
// actually JSON — e.g. Chatwoot returning an HTML 404/login page instead of API JSON.
async function fetchChatwootJson(label, url) {
  const res = await fetch(url, { headers: chatwootHeaders() });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`[${label}] HTTP ${res.status} from ${url} — body starts with: ${bodyText.slice(0, 200)}`);
  }
  try {
    return JSON.parse(bodyText);
  } catch (e) {
    throw new Error(`[${label}] Non-JSON response from ${url} (status ${res.status}) — body starts with: ${bodyText.slice(0, 200)}`);
  }
}

// Chatwoot's reports API takes Unix timestamps (seconds).
function rangeToUnix(range) {
  const now = new Date();
  const until = Math.floor(now.getTime() / 1000);
  const since = new Date(now);
  if (range === 'today') {
    since.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    since.setDate(since.getDate() - 7);
  } else { // 'month'
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
  }
  return { since: Math.floor(since.getTime() / 1000), until };
}

// GET /api/livechat/test-connection
// Diagnostic-only route: confirms CHATWOOT_URL / ACCOUNT_ID / API_TOKEN actually
// work against a simple, well-established v1 endpoint (listing agents), decoupled
// from whatever auth quirks the /reports endpoints might have.
router.get('/test-connection', require('../middleware/auth').requireAuth, async (req, res) => {
  try {
    if (!CHATWOOT_URL || !ACCOUNT_ID || !API_TOKEN) {
      return res.status(500).json({ error: 'Missing CHATWOOT_URL / CHATWOOT_ACCOUNT_ID / CHATWOOT_API_TOKEN' });
    }
    const tokenShape = {
      length: API_TOKEN.length,
      hasLeadingOrTrailingSpace: API_TOKEN !== API_TOKEN.trim(),
      hasQuotes: API_TOKEN.startsWith('"') || API_TOKEN.startsWith("'"),
      first4: API_TOKEN.slice(0, 4),
      last4: API_TOKEN.slice(-4)
    };
    const url = `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/agents`;
    const agents = await fetchChatwootJson('agents list (test)', url);
    res.json({ ok: true, tokenShape, agentCount: Array.isArray(agents) ? agents.length : null, sample: agents });
  } catch (err) {
    const tokenShape = {
      length: API_TOKEN ? API_TOKEN.length : 0,
      hasLeadingOrTrailingSpace: API_TOKEN ? API_TOKEN !== API_TOKEN.trim() : null,
      hasQuotes: API_TOKEN ? (API_TOKEN.startsWith('"') || API_TOKEN.startsWith("'")) : null,
      first4: API_TOKEN ? API_TOKEN.slice(0, 4) : null,
      last4: API_TOKEN ? API_TOKEN.slice(-4) : null
    };
    res.status(502).json({ ok: false, error: err.message, tokenShape, urlUsed: CHATWOOT_URL, accountIdUsed: ACCOUNT_ID });
  }
});

// GET /api/livechat/overview?range=today|7d|month
// Returns: messages received, CSAT/DSAT rate, top DSAT concerns, chats by agent/bot.
router.get('/overview', require('../middleware/auth').requireAuth, async (req, res) => {
  try {
    if (!CHATWOOT_URL || !ACCOUNT_ID || !API_TOKEN) {
      return res.status(500).json({ error: 'Chatwoot is not configured on this server yet (missing CHATWOOT_URL / CHATWOOT_ACCOUNT_ID / CHATWOOT_API_TOKEN).' });
    }

    const range = req.query.range || 'today';
    const { since, until } = rangeToUnix(range);
    const base = `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}`;
    const baseV2 = `${CHATWOOT_URL}/api/v2/accounts/${ACCOUNT_ID}`;

    // 1) Messages received in range (conversations report, incoming message count)
    //    NOTE: newer Chatwoot versions moved /reports/conversations to the v2 API.
    const convReport = await fetchChatwootJson(
      'conversations report',
      `${baseV2}/reports/conversations?metric=incoming_messages_count&type=account&since=${since}&until=${until}`
    );
    const messagesReceived = Array.isArray(convReport)
      ? convReport.reduce((sum, point) => sum + (point.value || 0), 0)
      : 0;

    // 2) CSAT survey responses in range
    const csatJson = await fetchChatwootJson('csat responses', `${base}/csat_survey_responses?page=1`);
    const allResponses = (csatJson.payload || []).filter(r => {
      const t = new Date(r.created_at).getTime() / 1000;
      return t >= since && t <= until;
    });
    const total = allResponses.length;
    const satisfied = allResponses.filter(r => r.rating >= 4).length;
    const dissatisfied = allResponses.filter(r => r.rating <= 2).length;
    const csatRate = total > 0 ? Math.round((satisfied / total) * 100) : null;
    const dsatRate = total > 0 ? Math.round((dissatisfied / total) * 100) : null;

    // 3) Top concerns behind DSAT — simple keyword frequency over feedback text.
    //    Swap this for a real Chatwoot conversation label if you tag DSAT reasons directly.
    const dsatFeedback = allResponses
      .filter(r => r.rating <= 2 && r.feedback_message)
      .map(r => r.feedback_message.toLowerCase());
    const wordCounts = {};
    dsatFeedback.forEach(text => {
      text.split(/\W+/).filter(w => w.length > 3).forEach(w => {
        wordCounts[w] = (wordCounts[w] || 0) + 1;
      });
    });
    const topConcerns = Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word, count]) => ({ word, count }));

    // 4) Chats handled by agent (and bot, if it appears as an agent record)
    //    NOTE: also on the v2 reports API in newer Chatwoot versions.
    const agentReport = await fetchChatwootJson(
      'agents report',
      `${baseV2}/reports/agents?metric=conversations_count&since=${since}&until=${until}`
    );
    const byAgent = (agentReport || []).map(a => ({
      name: a.name || a.email || `Agent ${a.id}`,
      isBot: /bot/i.test(a.name || ''),
      count: a.metric || a.value || 0
    }));

    res.json({ range, messagesReceived, csatRate, dsatRate, csatResponseCount: total, topDsatConcerns: topConcerns, byAgent });
  } catch (err) {
    console.error('Chatwoot overview error:', err);
    res.status(502).json({ error: 'Could not reach Chatwoot' });
  }
});

module.exports = router;
