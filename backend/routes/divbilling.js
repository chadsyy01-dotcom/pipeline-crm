/**
 * Division Billing proxy — backend/routes/divbilling.js
 * Mount in server: app.use('/api/divbilling', require('./routes/divbilling'));
 *
 * Kinukuha ang data mula sa Division Billing app
 * (https://division-billing-production.up.railway.app) para maipakita natin
 * nang native sa division-billing.html — walang iframe.
 *
 * Upstream endpoints (galing sa DevTools ng billing app):
 *   GET /api/state                → payments + settled per division
 *   GET /api/report?month=YYYY-MM → per-division × service rows (flag: ontime / waiting / overdue / late)
 *   GET /api/banks                → bank balances + payouts
 *   GET /api/billing              → config (fx rate, services, divisions, groups)
 *
 * Railway variables (alinman sa tatlong paraan ng login):
 *   DIVBILL_BASE_URL     default https://division-billing-production.up.railway.app
 *   DIVBILL_API_PREFIX   default /api
 *   (A) DIVBILL_USER + DIVBILL_PASS  — magla-login ang backend mismo
 *       DIVBILL_LOGIN_PATH  default /api/login  (POST JSON {username,password})
 *   (B) DIVBILL_COOKIE   — buong "Cookie" header na kinopya mula sa browser
 *   (C) DIVBILL_TOKEN    — Bearer token kung token-based ang app
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const BASE = (process.env.DIVBILL_BASE_URL || 'https://division-billing-production.up.railway.app').replace(/\/+$/, '');
const PREFIX = process.env.DIVBILL_API_PREFIX || '/api';
const LOGIN_PATH = process.env.DIVBILL_LOGIN_PATH || '/api/login';
const CACHE_MS = 60 * 1000;

// Session na hawak ng backend (galing login o env)
let session = {
  cookie: process.env.DIVBILL_COOKIE || '',
  token: process.env.DIVBILL_TOKEN || '',
};
let loginInFlight = null;

function authHeaders() {
  const h = { Accept: 'application/json' };
  if (session.cookie) h.Cookie = session.cookie;
  if (session.token) h.Authorization = `Bearer ${session.token}`;
  return h;
}

function canLogin() {
  return !!(process.env.DIVBILL_USER && process.env.DIVBILL_PASS);
}

async function login() {
  if (!canLogin()) throw new Error('Walang DIVBILL_USER/DIVBILL_PASS (o DIVBILL_COOKIE) sa Railway variables.');
  if (loginInFlight) return loginInFlight;
  loginInFlight = (async () => {
    // Linisin ang value: tanggalin ang spaces/newline at quotes na baka nadala sa pag-paste sa Railway
    const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '');
    const user = clean(process.env.DIVBILL_USER);
    const pass = clean(process.env.DIVBILL_PASS);
    // Hindi natin alam ang eksaktong field names ng billing app — subukan ang mga karaniwang anyo
    const attempts = [
      { type: 'json', body: { username: user, password: pass } },
      { type: 'form', body: { username: user, password: pass } },
      { type: 'json', body: { user, password: pass } },
      { type: 'json', body: { user, pass } },
      { type: 'json', body: { name: user, password: pass } },
      { type: 'json', body: { login: user, password: pass } },
      { type: 'json', body: { username: user.toLowerCase(), password: pass } },
    ];
    let res = null, lastErr = '';
    for (const a of attempts) {
      res = await fetch(BASE + LOGIN_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': a.type === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Origin: BASE,
          Referer: BASE + '/',
        },
        body: a.type === 'json' ? JSON.stringify(a.body) : new URLSearchParams(a.body).toString(),
        redirect: 'manual',
      });
      if (res.status < 400) { console.log('[divbilling] login ok via', a.type, Object.keys(a.body).join('+')); break; }
      lastErr = await res.text().catch(() => '');
      res = null;
    }
    if (!res) {
      throw new Error(`Login sa billing app failed: ${lastErr.slice(0, 160)} (user length ${user.length}, pass length ${pass.length})`);
    }
    // Cookie-based session
    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    const cookie = setCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');
    // Token-based session (kung JSON ang sagot)
    let token = '';
    try {
      const body = await res.json();
      token = body.token || body.accessToken || body.access_token || body.jwt || '';
    } catch (_) { /* hindi JSON — ok lang */ }
    if (!cookie && !token) throw new Error('Nag-login pero walang cookie o token na ibinalik ang billing app.');
    session = { cookie: cookie || session.cookie, token: token || session.token };
    console.log('[divbilling] login ok', cookie ? '(cookie)' : '', token ? '(token)' : '');
  })();
  try { await loginInFlight; } finally { loginInFlight = null; }
}

async function upstream(path, retried = false) {
  if (!session.cookie && !session.token) await login();
  const res = await fetch(BASE + PREFIX + path, { headers: authHeaders(), redirect: 'manual' });
  // 401/403 o redirect papuntang sign-in = expired na session → login ulit (isang beses)
  if ((res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) && !retried && canLogin()) {
    session = { cookie: '', token: '' };
    await login();
    return upstream(path, true);
  }
  if (!res.ok) throw new Error(`Billing app ${path} → HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error(`Billing app ${path} → hindi JSON ang sagot (baka login page). I-check ang credentials.`);
  return res.json();
}

const cache = new Map(); // month → { at, data }

function thisMonthManila() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 7);
}

router.get('/overview', requireAuth, async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : thisMonthManila();
  const force = req.query.refresh === '1';
  const hit = cache.get(month);
  if (hit && !force && Date.now() - hit.at < CACHE_MS) {
    return res.json({ ...hit.data, cached: true });
  }
  try {
    const [state, report, banks, billing] = await Promise.all([
      upstream('/state'),
      upstream(`/report?month=${month}`),
      upstream('/banks'),
      upstream('/billing'),
    ]);
    const data = {
      month,
      fetchedAt: new Date().toISOString(),
      report: { month: report.month, rows: report.rows || [] },
      // Huwag isama ang proof links — naka-login lang sila sa billing app
      payments: (state.payments || []).map(({ proofs, ...p }) => ({ ...p, proofCount: (proofs || []).length })),
      // NOTE: /api/banks ay naka-CENTAVOS (hal. 487882 = ₱4,878.82) — i-convert sa piso.
      // Na-verify: GoTyme "in" 487882 = kabuuan ng credited GoTyme payments (₱4,878.82).
      banks: (banks.banks || []).map(b => ({
        ...b,
        opening: (Number(b.opening) || 0) / 100,
        in: (Number(b.in) || 0) / 100,
        out: (Number(b.out) || 0) / 100,
        pending: (Number(b.pending) || 0) / 100,
        balance: (Number(b.balance) || 0) / 100,
      })),
      payouts: (banks.payouts || []).map(({ receipts, invoices, ...p }) => ({ ...p, amount: (Number(p.amount) || 0) / 100 })),
      fx: billing.fx || null,
      services: billing.services || {},
      order: billing.order || [],
    };
    cache.set(month, { at: Date.now(), data });
    res.json({ ...data, cached: false });
  } catch (err) {
    console.error('[divbilling] overview error:', err.message);
    if (hit) return res.json({ ...hit.data, cached: true, stale: true, error: err.message });
    res.status(502).json({ error: err.message });
  }
});

router.get('/health', requireAuth, (req, res) => {
  res.json({
    base: BASE,
    hasCookie: !!session.cookie,
    hasToken: !!session.token,
    canLogin: canLogin(),
    cachedMonths: [...cache.keys()],
  });
});

module.exports = router;
