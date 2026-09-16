// backend/routes/kb.js
//
// Knowledge Base storage (added 2026-09-16). One KB document per brand —
// the same KB text the team maintains for Chatwoot bots across all brands —
// editable from the dashboard's Knowledge Base page so it lives in ONE
// shared place instead of scattered .txt files.
//
// Storage: own tiny table, one row per brand, created on demand (raw SQL,
// no Sequelize model — same pattern as billing.js / BillingConfig).
//
// Egress-friendly by design: the list endpoint returns metadata only
// (name, size, updated info) — full content is fetched one brand at a
// time, only when its tab is opened. No polling anywhere.
//
// WIRING (one line, backend/server.js, next to the other route mounts):
//   app.use('/api/kb', require('./routes/kb'));

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

const TABLE_READY = (async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "KnowledgeBase" (
        "brand" TEXT PRIMARY KEY,
        "content" TEXT NOT NULL DEFAULT '',
        "sourceUrl" TEXT,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedBy" TEXT
      )
    `);
    // In case the table was created by an earlier version without the column.
    await sequelize.query(`ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT`);
    console.log('KB: KnowledgeBase table ready.');
  } catch (err) {
    console.error('KB: table init failed:', err.message);
  }
})();

// Brand keys are short slugs chosen by the frontend (e.g. 'general',
// 'buenasph', 'tmtcash'). Validated loosely so new brands need no backend
// change — but tight enough to reject junk/injection attempts.
const BRAND_RE = /^[A-Za-z0-9_-]{1,40}$/;

// Content cap: KB text files are tens of KB; 1 MB is far above any real
// KB and still tiny for Postgres — this only guards against accidents
// (e.g. someone pasting a binary file).
const MAX_CONTENT = 1_000_000;

// GET /api/kb/doc-proxy?url=<published Google Doc /pub link>
// Published Docs don't send CORS headers, so the browser can't fetch them
// directly — this proxies the fetch server-side and converts the published
// HTML into clean plain text (headings/paragraphs become line breaks).
// Registered BEFORE '/:brand' so that route doesn't swallow the path.
const DOC_URL_RE = /^https:\/\/docs\.google\.com\/document\/d\/e\/[A-Za-z0-9_-]+\/pub(\?.*)?$/;

function docHtmlToText(html) {
  let s = html;
  // cut everything before the published contents container, and the Google
  // footer after it — index cuts instead of regex, so nested divs inside
  // the contents can't confuse the extraction
  const ci = s.indexOf('<div id="contents"');
  if (ci >= 0) s = s.slice(ci);
  const fi = s.indexOf('<div id="footer"');
  if (fi >= 0) s = s.slice(0, fi);
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
       .replace(/<script[\s\S]*?<\/script>/gi, '')
       // block-level closers become line breaks so structure survives
       .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|blockquote)>/gi, '\n')
       .replace(/<(br|hr)\s*\/?>(?!\n)/gi, '\n')
       .replace(/<li[^>]*>/gi, '\u2022 ')
       .replace(/<[^>]+>/g, '')
       // entities (the common ones published docs emit)
       .replace(/&nbsp;/g, ' ')
       .replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"')
       .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
       .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  // tidy whitespace: no trailing spaces, max one blank line in a row
  s = s.split('\n').map(l => l.replace(/\s+$/g, '').replace(/^\s+/g, '')).join('\n')
       .replace(/\n{3,}/g, '\n\n')
       .trim();
  return s;
}

router.get('/doc-proxy', requireAuth, async (req, res) => {
  try {
    const url = req.query.url || '';
    if (!DOC_URL_RE.test(url)) {
      return res.status(400).json({ error: 'URL must be a published Google Doc link (docs.google.com/document/d/e/…/pub).' });
    }
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return res.status(502).json({ error: `Google returned HTTP ${r.status} — is the doc still published to web?` });
    const html = await r.text();
    const text = docHtmlToText(html);
    if (!text) return res.status(502).json({ error: 'The published page had no readable content.' });
    res.json({ text, chars: text.length, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('KB doc-proxy error:', err);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/kb -> { brands: [{ brand, chars, updatedAt, updatedBy }] }
// Metadata only — no content — so the page opens light.
router.get('/', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const rows = await sequelize.query(`
      SELECT "brand", LENGTH("content") AS "chars", "updatedAt", "updatedBy"
      FROM "KnowledgeBase" ORDER BY "brand"
    `, { type: QueryTypes.SELECT });
    res.json({ brands: rows });
  } catch (err) {
    console.error('KB list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kb/:brand -> { brand, content, updatedAt, updatedBy } | { content: null }
router.get('/:brand', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const brand = req.params.brand;
    if (!BRAND_RE.test(brand)) return res.status(400).json({ error: 'Invalid brand key.' });
    const rows = await sequelize.query(`
      SELECT "brand", "content", "sourceUrl", "updatedAt", "updatedBy"
      FROM "KnowledgeBase" WHERE "brand" = :brand
    `, { replacements: { brand }, type: QueryTypes.SELECT });
    if (!rows.length) return res.json({ brand, content: null });
    res.json(rows[0]);
  } catch (err) {
    console.error('KB get error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/kb/:brand  body: { content: "..." }
router.put('/:brand', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const brand = req.params.brand;
    if (!BRAND_RE.test(brand)) return res.status(400).json({ error: 'Invalid brand key.' });
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content (string) is required.' });
    if (content.length > MAX_CONTENT) return res.status(400).json({ error: 'Content too large (max 1 MB).' });
    let sourceUrl = req.body?.sourceUrl;
    if (sourceUrl != null && sourceUrl !== '' && !DOC_URL_RE.test(sourceUrl)) {
      return res.status(400).json({ error: 'sourceUrl must be a published Google Doc /pub link (or empty).' });
    }
    if (sourceUrl === '') sourceUrl = null;
    const updatedBy = req.user?.name || req.user?.email || null;
    await sequelize.query(`
      INSERT INTO "KnowledgeBase" ("brand", "content", "sourceUrl", "updatedAt", "updatedBy")
      VALUES (:brand, :content, :sourceUrl, NOW(), :updatedBy)
      ON CONFLICT ("brand") DO UPDATE
        SET "content" = EXCLUDED."content", "sourceUrl" = EXCLUDED."sourceUrl", "updatedAt" = NOW(), "updatedBy" = EXCLUDED."updatedBy"
    `, { replacements: { brand, content, sourceUrl: sourceUrl ?? null, updatedBy } });
    console.log(`KB: '${brand}' saved by ${updatedBy || 'unknown'} — ${content.length} chars.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('KB save error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
