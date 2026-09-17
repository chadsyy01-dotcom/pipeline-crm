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
    await sequelize.query(`ALTER TABLE "KnowledgeBaseSections" ADD COLUMN IF NOT EXISTS "detectedDates" JSONB`);
    await sequelize.query(`ALTER TABLE "KnowledgeBaseSections" ADD COLUMN IF NOT EXISTS "datesVer" INTEGER`);
    console.log('KB: KnowledgeBaseSections table ready.');
  } catch (err) {
    console.error('KB: table init failed:', err.message);
  }
})();

// ---- Date detection for expiry warnings (added 2026-09-16) ----
// Finds explicit dates in KB text ("February 21, 2026", "Feb 21 2026",
// "June 2026" [treated as end of that month], "2026-09-30") so the
// dashboard can flag sections whose promos/maintenance windows have
// already passed or are about to end. Month-only mentions without a year
// ("last December") are deliberately ignored — too noisy.
const KB_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

// Context classification (added 2026-09-17 after a false positive: a
// Gcashwebpay INTEGRATION date "deposits made before 2025-11-18" was
// flagged as expired). A date only counts toward expiry warnings when its
// surrounding text says it's an END of something — reference dates
// (before/since/as of/integration/...) are ignored.
const REF_NEAR_RE = /\b(before|earlier than|prior to|since|starting|starts?\s+(?:on|from)|started|as of|effective|integration|launch(?:ed)?|created|registered|updated|posted|noong|simula|mula|on or after|after)\b[^.\n]{0,30}$/i;
const EXPIRY_CTX_RE = /\b(until|hanggang|valid(?:ity)?|expir\w*|ends?|ending|end date|deadline|last day|matatapos|katapusan|maintenance|promo(?:tion)?s?\b[^.\n]{0,25}(?:period|runs?|window)|runs? until|available until|claim(?:able)? until|from \d{1,2}:\d{2} to \d{1,2}:\d{2})\b/i;
const TIMEBOUND_TITLE_RE = /(maintenance|promo|bonus|event|schedule|announce)/i;

// A paragraph that declares itself finished ("Status: Completed", "ended",
// "tapos na") is deliberate HISTORY — the doc already says it's over, so
// there is nothing stale to warn about (added 2026-09-17 after a completed
// promo's coverage period got flagged). "Status: Active" with a past end
// date still flags — that IS the stale case.
const COMPLETED_CTX_RE = /\b(status\s*[:=]?\s*(completed|ended|expired|inactive|closed|done|finished|tapos)|concluded|natapos na|tapos na po|already ended|nag-?end na)\b/i;

// Topics whose dates should NEVER be flagged (added 2026-09-17): recurring
// backward-looking promos — e.g. "Weekly Top Fan Winners" whose coverage
// period is always LAST week, so its dates are permanently in the past by
// design even while the promo is active. Add more topics with | inside
// the group, e.g. /\b(top fan|weekly winners|hall of fame)\b/i
const IGNORE_TOPICS_RE = /\b(top fan)\b/i;

// Version marker so Railway deploy logs show exactly which extraction
// logic is live (deployment mix-ups cost us an afternoon on 2026-09-17).
const EXTRACTION_VER = 5;
console.log(`KB: routes loaded — extraction v${EXTRACTION_VER} (topic-skip, completed-status, ranges, reference-dates).`);

// Window bounded by blank lines so one promo's status can't bleed into
// the next block's dates.
function paragraphWindow(text, idx) {
  const prevBreak = text.lastIndexOf('\n\n', idx);
  const s = Math.max(prevBreak === -1 ? 0 : prevBreak, idx - 300);
  const nextBreak = text.indexOf('\n\n', idx);
  const e = Math.min(nextBreak === -1 ? text.length : nextBreak, idx + 200);
  return text.slice(s, e);
}

// Like paragraphWindow but reaches ONE paragraph further up, so a promo's
// TITLE line ("Promotion 22: Weekly Top Fan Winners"), which sits in its
// own paragraph above the details, is included for topic checks.
function topicWindow(text, idx) {
  const p1 = text.lastIndexOf('\n\n', idx);
  const p2 = p1 > 0 ? text.lastIndexOf('\n\n', p1 - 1) : -1;
  const s = Math.max(p2 === -1 ? 0 : p2, idx - 400);
  const nextBreak = text.indexOf('\n\n', idx);
  const e = Math.min(nextBreak === -1 ? text.length : nextBreak, idx + 200);
  return text.slice(s, e);
}

function classifyDateAt(text, matchStart, matchEnd, title) {
  if (IGNORE_TOPICS_RE.test(topicWindow(text, matchStart))) return false; // ignored topic (e.g. Top Fan) — never flag
  const para = paragraphWindow(text, matchStart);
  if (COMPLETED_CTX_RE.test(para)) return false; // declared finished — history, not stale
  const beforeNear = text.slice(Math.max(0, matchStart - 32), matchStart);
  if (REF_NEAR_RE.test(beforeNear)) return false;          // reference date — ignore
  const ctx = text.slice(Math.max(0, matchStart - 90), Math.min(text.length, matchEnd + 60));
  if (EXPIRY_CTX_RE.test(ctx)) return true;                // clearly an end date
  return TIMEBOUND_TITLE_RE.test(title || '');             // bare date: only in time-bound sections
}

function extractDates(content, title) {
  const text = String(content || '');
  // Pass 1: tokenize every date in the text as { iso, start, end }
  const tokens = [];
  const spans = [];
  const overlaps = (s, e) => spans.some(sp => s < sp[1] && e > sp[0]);
  const addTok = (d, s, e) => {
    if (isNaN(d) || overlaps(s, e)) return;
    tokens.push({ iso: d.toISOString().slice(0, 10), start: s, end: e });
    spans.push([s, e]);
  };
  let m;
  const reFull = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  while ((m = reFull.exec(text)) !== null) {
    const mo = KB_MONTHS[m[1].slice(0, 4).toLowerCase()] ?? KB_MONTHS[m[1].slice(0, 3).toLowerCase()];
    addTok(new Date(Date.UTC(Number(m[3]), mo, Number(m[2]))), m.index, m.index + m[0].length);
  }
  const reIso = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((m = reIso.exec(text)) !== null) {
    if (Number(m[2]) >= 1 && Number(m[2]) <= 12) {
      addTok(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))), m.index, m.index + m[0].length);
    }
  }
  const reMonthYear = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{4})\b/gi;
  while ((m = reMonthYear.exec(text)) !== null) {
    const mo = KB_MONTHS[m[1].slice(0, 4).toLowerCase()] ?? KB_MONTHS[m[1].slice(0, 3).toLowerCase()];
    addTok(new Date(Date.UTC(Number(m[2]), mo + 1, 0)), m.index, m.index + m[0].length);
  }
  tokens.sort((a, b) => a.start - b.start);

  // Pass 2: pair consecutive tokens into RANGES ("Sept 15, 2026 - Oct 15,
  // 2026", "Sept 1 to Sept 19"): a range is a DURATION — its START date
  // never expires anything, only its END date counts (added 2026-09-17
  // after a promo's start date got flagged as expired).
  const out = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const A = tokens[i];
    const B = tokens[i + 1];
    const between = B ? text.slice(A.end, B.start) : '';
    const isRange = B && B.start - A.end <= 15 && /^\s*(?:[-\u2013\u2014]|to|hanggang|until)\s*$/i.test(between);
    if (isRange) {
      // ref words before the whole range (e.g. "integration window X - Y") still veto it
      const beforeRange = text.slice(Math.max(0, A.start - 32), A.start);
      const rangePara = paragraphWindow(text, A.start);
      const vetoed = COMPLETED_CTX_RE.test(rangePara) || IGNORE_TOPICS_RE.test(topicWindow(text, A.start));
      if (!REF_NEAR_RE.test(beforeRange) && !vetoed) out.add(B.iso); // duration => its end matters
      i++; // consume both tokens
    } else if (classifyDateAt(text, A.start, A.end, title)) {
      out.add(A.iso);
    }
  }
  return [...out].sort().slice(0, 30);
}

const SOON_DAYS = 7;
function computeAlert(dates) {
  if (!Array.isArray(dates) || !dates.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const soonCut = new Date(Date.now() + SOON_DAYS * 86400000).toISOString().slice(0, 10);
  const expired = dates.filter(d => d < today);
  const soon = dates.filter(d => d >= today && d <= soonCut);
  if (expired.length) return { level: 'expired', expired, soon };
  if (soon.length) return { level: 'soon', expired, soon };
  return null;
}

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

// GET/PUT /api/kb/:brand/source — ONE published Google Doc link per brand.
// The published page always renders the WHOLE doc (Google ignores ?tab=
// on /pub — verified 2026-09-16), so the dashboard stores a single base
// link per brand and splits the fetched text into sections client-side
// using the section titles as delimiters. Stored in the v1 KnowledgeBase
// table (brand PK, sourceUrl column) which now serves as brand settings.
router.get('/:brand/source', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const brand = req.params.brand;
    if (!BRAND_RE.test(brand)) return res.status(400).json({ error: 'Invalid brand key.' });
    const rows = await sequelize.query(`
      SELECT "sourceUrl" FROM "KnowledgeBase" WHERE "brand" = :brand
    `, { replacements: { brand }, type: QueryTypes.SELECT });
    res.json({ brand, sourceUrl: rows.length ? rows[0].sourceUrl : null });
  } catch (err) {
    console.error('KB source get error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:brand/source', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const brand = req.params.brand;
    if (!BRAND_RE.test(brand)) return res.status(400).json({ error: 'Invalid brand key.' });
    const updatedBy = req.user?.name || req.user?.email || null;
    // Mode A: docHash-only update (auto-sync bookkeeping; no URL change)
    if (req.body?.sourceUrl === undefined && typeof req.body?.docHash === 'string') {
      const docHash = req.body.docHash.slice(0, 64);
      await sequelize.query(`
        UPDATE "KnowledgeBase" SET "content" = :docHash, "updatedAt" = NOW() WHERE "brand" = :brand
      `, { replacements: { brand, docHash } });
      return res.json({ ok: true });
    }
    // Mode B: set/replace the doc link (resets the hash so next open resyncs)
    let sourceUrl = req.body?.sourceUrl || null;
    if (sourceUrl && !DOC_URL_RE.test(sourceUrl)) {
      return res.status(400).json({ error: 'sourceUrl must be a published Google Doc /pub link (or empty).' });
    }
    await sequelize.query(`
      INSERT INTO "KnowledgeBase" ("brand", "content", "sourceUrl", "updatedAt", "updatedBy")
      VALUES (:brand, '', :sourceUrl, NOW(), :updatedBy)
      ON CONFLICT ("brand") DO UPDATE
        SET "sourceUrl" = EXCLUDED."sourceUrl", "content" = '', "updatedAt" = NOW(), "updatedBy" = EXCLUDED."updatedBy"
    `, { replacements: { brand, sourceUrl, updatedBy } });
    console.log(`KB: brand doc link for '${brand}' set by ${updatedBy || 'unknown'}.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('KB source save error:', err);
    res.status(500).json({ error: err.message });
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
    // worst date-alert per brand, from the tiny detectedDates arrays only
    const dateRows = await sequelize.query(`
      SELECT "brand", "detectedDates" FROM "KnowledgeBaseSections" WHERE "detectedDates" IS NOT NULL
    `, { type: QueryTypes.SELECT });
    const worst = {};
    for (const r of dateRows) {
      const a = computeAlert(r.detectedDates);
      if (!a) continue;
      if (a.level === 'expired') worst[r.brand] = 'expired';
      else if (a.level === 'soon' && worst[r.brand] !== 'expired') worst[r.brand] = 'soon';
    }
    rows.forEach(r => { r.alert = worst[r.brand] || null; });
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
  // Consume the v1 blob so this migration can only ever run ONCE per brand.
  // Without this, deleting the imported section left the v1 row intact and
  // the next sections-load "helpfully" re-imported it — an undeletable
  // zombie section (found 2026-09-16).
  await sequelize.query(`
    UPDATE "KnowledgeBase" SET "content" = '' WHERE "brand" = :brand
  `, { replacements: { brand } });
  console.log(`KB: migrated v1 blob for '${brand}' into a section (v1 row consumed).`);
}

// GET /api/kb/:brand/sections -> section list (metadata only, no content)
router.get('/:brand/sections', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const brand = req.params.brand;
    if (!BRAND_RE.test(brand)) return res.status(400).json({ error: 'Invalid brand key.' });
    await migrateV1IfNeeded(brand);
    // one-time lazy backfill: sections saved before date-detection existed
    const nullDateRows = await sequelize.query(`
      SELECT "id", "title", "content" FROM "KnowledgeBaseSections"
      WHERE "brand" = :brand AND "datesVer" IS DISTINCT FROM 5 AND LENGTH("content") > 0
    `, { replacements: { brand }, type: QueryTypes.SELECT });
    for (const r of nullDateRows) {
      await sequelize.query(`
        UPDATE "KnowledgeBaseSections" SET "detectedDates" = :dates::jsonb, "datesVer" = 5 WHERE "id" = :id
      `, { replacements: { id: r.id, dates: JSON.stringify(extractDates(r.content, r.title)) } });
    }
    const rows = await sequelize.query(`
      SELECT "id", "title", LENGTH("content") AS "chars",
             ("sourceUrl" IS NOT NULL) AS "linked", "detectedDates", "updatedAt", "updatedBy"
      FROM "KnowledgeBaseSections" WHERE "brand" = :brand
      ORDER BY "title" ASC, "id" ASC
    `, { replacements: { brand }, type: QueryTypes.SELECT });
    rows.forEach(r => { r.alert = computeAlert(r.detectedDates); delete r.detectedDates; });
    const srcRow = await sequelize.query(`
      SELECT "sourceUrl", "content" FROM "KnowledgeBase" WHERE "brand" = :brand
    `, { replacements: { brand }, type: QueryTypes.SELECT });
    // v1 row's content column doubles as the last-synced doc fingerprint,
    // letting auto-sync skip all writes when the doc hasn't changed.
    res.json({
      brand, sections: rows,
      brandSourceUrl: srcRow.length ? srcRow[0].sourceUrl : null,
      brandDocHash: srcRow.length && srcRow[0].content ? srcRow[0].content : null,
    });
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
      INSERT INTO "KnowledgeBaseSections" ("brand", "title", "content", "sourceUrl", "detectedDates", "datesVer", "updatedAt", "updatedBy")
      VALUES (:brand, :title, :content, :sourceUrl, :detectedDates::jsonb, 5, NOW(), :updatedBy)
      RETURNING "id"
    `, { replacements: { brand, title, content, sourceUrl, detectedDates: JSON.stringify(extractDates(content, title)), updatedBy }, type: QueryTypes.SELECT });
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
      SELECT "id", "brand", "title", "content", "sourceUrl", "detectedDates", "updatedAt", "updatedBy"
      FROM "KnowledgeBaseSections" WHERE "id" = :id
    `, { replacements: { id }, type: QueryTypes.SELECT });
    if (!rows.length) return res.status(404).json({ error: 'Section not found.' });
    const row = rows[0];
    row.alert = computeAlert(row.detectedDates);
    delete row.detectedDates;
    res.json(row);
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
      // classification reads the title; use the incoming one or the stored one
      let titleForDates = req.body?.title !== undefined ? String(req.body.title) : null;
      if (titleForDates === null) {
        const tRow = await sequelize.query(`
          SELECT "title" FROM "KnowledgeBaseSections" WHERE "id" = :id
        `, { replacements: { id }, type: QueryTypes.SELECT });
        titleForDates = tRow.length ? tRow[0].title : '';
      }
      sets.push('"detectedDates" = :detectedDates::jsonb'); repl.detectedDates = JSON.stringify(extractDates(req.body.content, titleForDates));
      sets.push('"datesVer" = 5');
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
