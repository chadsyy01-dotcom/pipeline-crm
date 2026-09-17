// backend/routes/kb.js  (v2 — sections)
//
// Knowledge Base storage (v2, 2026-09-16). Each brand's KB is a set of
// SECTIONS — separate titled documents (like Google Docs document tabs:
// "LLM Instruction", "00 admin persona", "01 about", "02 deposits", ...)
// instead of one long text blob. Each section holds its own content and,
// optionally, its own published Google Doc link (a /pub or /pub?tab=t.xxx
// per-tab link) for one-click sync.
//
// Egress-friendly: list endpoints return metadata only; full content is
// fetched one section at a time. No polling anywhere.
//
// WIRING (one line, backend/server.js — already added for v1, unchanged):
//   app.use('/api/kb', require('./routes/kb'));

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

const TABLE_READY = (async () => {
  try {
    // v1 table kept (read-only) so any already-saved brand blob can be
    // auto-migrated into a section the first time the brand is opened.
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "KnowledgeBase" (
        "brand" TEXT PRIMARY KEY,
        "content" TEXT NOT NULL DEFAULT '',
        "sourceUrl" TEXT,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedBy" TEXT
      )
    `);
    await sequelize.query(`ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT`);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "KnowledgeBaseSections" (
        "id" SERIAL PRIMARY KEY,
        "brand" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "content" TEXT NOT NULL DEFAULT '',
        "sourceUrl" TEXT,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedBy" TEXT
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS "kbs_brand_idx" ON "KnowledgeBaseSections" ("brand")`);
    console.log('KB: KnowledgeBaseSections table ready.');
  } catch (err) {
    console.error('KB: table init failed:', err.message);
  }
})();

const BRAND_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_CONTENT = 1_000_000; // ~1 MB per section — far above any real KB
const MAX_TITLE = 120;

// Published Google Doc link — base /pub or a per-tab /pub?tab=t.xxx link.
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
       .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|blockquote)>/gi, '\n')
       .replace(/<(br|hr)\s*\/?>(?!\n)/gi, '\n')
       .replace(/<li[^>]*>/gi, '\u2022 ')
       .replace(/<[^>]+>/g, '')
       .replace(/&nbsp;/g, ' ')
       .replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"')
       .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
       .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  s = s.split('\n').map(l => l.replace(/\s+$/g, '').replace(/^\s+/g, '')).join('\n')
       .replace(/\n{3,}/g, '\n\n')
       .trim();
  return s;
}

// GET /api/kb/doc-proxy?url=...  (registered before parameterized routes)
router.get('/doc-proxy', requireAuth, async (req, res) => {
  try {
    const url = req.query.url || '';
    if (!DOC_URL_RE.test(url)) {
      return res.status(400).json({ error: 'URL must be a published Google Doc link (docs.google.com/document/d/e/…/pub, optionally with ?tab=…).' });
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

// GET /api/kb  ->  { brands: [{ brand, sections, chars, updatedAt }] }
// Metadata only, aggregated per brand — powers the green dots on the tabs.
router.get('/', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const rows = await sequelize.query(`
      SELECT "brand",
             COUNT(*)::int AS "sections",
             SUM(LENGTH("content"))::bigint AS "chars",
             MAX("updatedAt") AS "updatedAt"
      FROM "KnowledgeBaseSections"
      GROUP BY "brand" ORDER BY "brand"
    `, { type: QueryTypes.SELECT });
    res.json({ brands: rows });
  } catch (err) {
    console.error('KB list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// One-time migration: if a brand has no sections yet but the v1 table has a
// saved blob for it, move that blob into a starter section.
async function migrateV1IfNeeded(brand) {
  const existing = await sequelize.query(`
    SELECT 1 FROM "KnowledgeBaseSections" WHERE "brand" = :brand LIMIT 1
  `, { replacements: { brand }, type: QueryTypes.SELECT });
  if (existing.length) return;
  const v1 = await sequelize.query(`
    SELECT "content", "sourceUrl", "updatedBy" FROM "KnowledgeBase" WHERE "brand" = :brand AND LENGTH("content") > 0
  `, { replacements: { brand }, type: QueryTypes.SELECT });
  if (!v1.length) return;
  await sequelize.query(`
    INSERT INTO "KnowledgeBaseSections" ("brand", "title", "content", "sourceUrl", "updatedAt", "updatedBy")
    VALUES (:brand, '(imported from v1)', :content, :sourceUrl, NOW(), :updatedBy)
  `, { replacements: { brand, content: v1[0].content, sourceUrl: v1[0].sourceUrl || null, updatedBy: v1[0].updatedBy || null } });
  console.log(`KB: migrated v1 blob for '${brand}' into a section.`);
}

// GET /api/kb/:brand/sections -> section list (metadata only, no content)
router.get('/:brand/sections', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const brand = req.params.brand;
    if (!BRAND_RE.test(brand)) return res.status(400).json({ error: 'Invalid brand key.' });
    await migrateV1IfNeeded(brand);
    const rows = await sequelize.query(`
      SELECT "id", "title", LENGTH("content") AS "chars",
             ("sourceUrl" IS NOT NULL) AS "linked", "updatedAt", "updatedBy"
      FROM "KnowledgeBaseSections" WHERE "brand" = :brand
      ORDER BY "title" ASC, "id" ASC
    `, { replacements: { brand }, type: QueryTypes.SELECT });
    res.json({ brand, sections: rows });
  } catch (err) {
    console.error('KB sections list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kb/:brand/sections  body: { title, content?, sourceUrl? }
router.post('/:brand/sections', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const brand = req.params.brand;
    if (!BRAND_RE.test(brand)) return res.status(400).json({ error: 'Invalid brand key.' });
    const title = (req.body?.title || '').trim();
    if (!title || title.length > MAX_TITLE) return res.status(400).json({ error: 'A title (max 120 chars) is required.' });
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (content.length > MAX_CONTENT) return res.status(400).json({ error: 'Content too large (max 1 MB).' });
    let sourceUrl = req.body?.sourceUrl || null;
    if (sourceUrl && !DOC_URL_RE.test(sourceUrl)) return res.status(400).json({ error: 'sourceUrl must be a published Google Doc link (or empty).' });
    const updatedBy = req.user?.name || req.user?.email || null;
    const rows = await sequelize.query(`
      INSERT INTO "KnowledgeBaseSections" ("brand", "title", "content", "sourceUrl", "updatedAt", "updatedBy")
      VALUES (:brand, :title, :content, :sourceUrl, NOW(), :updatedBy)
      RETURNING "id"
    `, { replacements: { brand, title, content, sourceUrl, updatedBy }, type: QueryTypes.SELECT });
    console.log(`KB: section '${title}' created for '${brand}' by ${updatedBy || 'unknown'}.`);
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error('KB section create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kb/section/:id -> full section
router.get('/section/:id', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid section id.' });
    const rows = await sequelize.query(`
      SELECT "id", "brand", "title", "content", "sourceUrl", "updatedAt", "updatedBy"
      FROM "KnowledgeBaseSections" WHERE "id" = :id
    `, { replacements: { id }, type: QueryTypes.SELECT });
    if (!rows.length) return res.status(404).json({ error: 'Section not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('KB section get error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/kb/section/:id  body: { title?, content?, sourceUrl? }
router.put('/section/:id', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid section id.' });
    const sets = [];
    const repl = { id, updatedBy: req.user?.name || req.user?.email || null };
    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title || title.length > MAX_TITLE) return res.status(400).json({ error: 'Title must be 1-120 chars.' });
      sets.push('"title" = :title'); repl.title = title;
    }
    if (req.body?.content !== undefined) {
      if (typeof req.body.content !== 'string') return res.status(400).json({ error: 'content must be a string.' });
      if (req.body.content.length > MAX_CONTENT) return res.status(400).json({ error: 'Content too large (max 1 MB).' });
      sets.push('"content" = :content'); repl.content = req.body.content;
    }
    if (req.body?.sourceUrl !== undefined) {
      let sourceUrl = req.body.sourceUrl || null;
      if (sourceUrl && !DOC_URL_RE.test(sourceUrl)) return res.status(400).json({ error: 'sourceUrl must be a published Google Doc link (or empty).' });
      sets.push('"sourceUrl" = :sourceUrl'); repl.sourceUrl = sourceUrl;
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    const result = await sequelize.query(`
      UPDATE "KnowledgeBaseSections"
      SET ${sets.join(', ')}, "updatedAt" = NOW(), "updatedBy" = :updatedBy
      WHERE "id" = :id
      RETURNING "id"
    `, { replacements: repl, type: QueryTypes.SELECT });
    if (!result.length) return res.status(404).json({ error: 'Section not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('KB section update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/kb/section/:id
router.delete('/section/:id', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid section id.' });
    const rows = await sequelize.query(`
      DELETE FROM "KnowledgeBaseSections" WHERE "id" = :id RETURNING "brand", "title"
    `, { replacements: { id }, type: QueryTypes.SELECT });
    if (!rows.length) return res.status(404).json({ error: 'Section not found.' });
    console.log(`KB: section '${rows[0].title}' (${rows[0].brand}) deleted by ${req.user?.name || req.user?.email || 'unknown'}.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('KB section delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
