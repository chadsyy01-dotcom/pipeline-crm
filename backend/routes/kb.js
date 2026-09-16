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
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedBy" TEXT
      )
    `);
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
      SELECT "brand", "content", "updatedAt", "updatedBy"
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
    const updatedBy = req.user?.name || req.user?.email || null;
    await sequelize.query(`
      INSERT INTO "KnowledgeBase" ("brand", "content", "updatedAt", "updatedBy")
      VALUES (:brand, :content, NOW(), :updatedBy)
      ON CONFLICT ("brand") DO UPDATE
        SET "content" = EXCLUDED."content", "updatedAt" = NOW(), "updatedBy" = EXCLUDED."updatedBy"
    `, { replacements: { brand, content, updatedBy } });
    console.log(`KB: '${brand}' saved by ${updatedBy || 'unknown'} — ${content.length} chars.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('KB save error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
