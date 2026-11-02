const express = require('express');
const { User, sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

// OPISINA PRESENCE (2026-11-02): kung saan nakatayo ang bawat naka-login sa
// mapa ng Opisina (frontend/public/office.html). Nasa memory lang — walang
// bagong table. Ang galaw ay laging para sa SARILING account (galing sa token),
// kaya walang makakagalaw sa karakter ng iba.
const router = express.Router();
router.use(requireAuth);

const TTL_MS = 3 * 60 * 1000;          // nawawala kapag 3 min nang walang update
const presence = new Map();            // userId -> { id, email, name, x, y, away, at }
const names = new Map();               // userId -> name (cache)

async function nameOf(req) {
  if (names.has(req.user.id)) return names.get(req.user.id);
  const u = await User.findOne({ where: { id: req.user.id }, attributes: ['name'] });
  const n = u ? u.name : (req.user.email || 'User');
  names.set(req.user.id, n);
  return n;
}

// HULING POSISYON (2026-11-02): naka-save sa DB para manatili ang karakter
// kung saan iniwan, kahit umalis o nag-refresh — at pareho ang nakikita ng lahat.
const positions = new Map();           // userId -> { id, email, name, x, y, away, savedAt }
const posReady = sequelize.query(`
  CREATE TABLE IF NOT EXISTS "OfficePositions" (
    "userId" INTEGER PRIMARY KEY,
    "x" REAL NOT NULL, "y" REAL NOT NULL, "away" BOOLEAN NOT NULL DEFAULT FALSE,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  .then(() => sequelize.query(`
    SELECT p."userId" AS id, p."x", p."y", p."away", u."name", u."email"
    FROM "OfficePositions" p JOIN "Users" u ON u."id" = p."userId"`, { type: QueryTypes.SELECT }))
  .then(rows => rows.forEach(r => positions.set(r.id, { id: r.id, email: r.email, name: r.name, x: r.x, y: r.y, away: r.away })))
  .catch(err => console.error('OfficePositions table error:', err.message));
const saveTimers = new Map();          // isang DB write bawat ~2s bawat tao habang naglalakad
function persist(id) {
  if (saveTimers.has(id)) return;
  saveTimers.set(id, setTimeout(async () => {
    saveTimers.delete(id);
    const p = positions.get(id); if (!p) return;
    try {
      await posReady;
      await sequelize.query(`
        INSERT INTO "OfficePositions" ("userId", "x", "y", "away", "updatedAt") VALUES (:id, :x, :y, :away, NOW())
        ON CONFLICT ("userId") DO UPDATE SET "x" = EXCLUDED."x", "y" = EXCLUDED."y", "away" = EXCLUDED."away", "updatedAt" = NOW()`,
        { replacements: { id, x: p.x, y: p.y, away: p.away } });
    } catch (err) { console.error('Office position save error:', err.message); }
  }, 2000));
}

// GET /api/office/presence — lahat ng may naka-save na posisyon; online = nasa page ngayon
router.get('/presence', async (req, res) => {
  await posReady;
  const now = Date.now();
  for (const [id, p] of presence) if (now - p.at > TTL_MS) presence.delete(id);
  const ids = new Set([...positions.keys(), ...presence.keys()]);
  const people = [...ids].map(id => {
    const live = presence.get(id), pos = positions.get(id) || {};
    return { ...pos, ...(live || {}), online: !!live };
  });
  res.json({ me: { id: req.user.id, email: req.user.email }, people });
});

// PUT /api/office/presence  body: { x, y, away }
router.put('/presence', async (req, res) => {
  try {
    const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
    const prev = presence.get(req.user.id) || {};
    const entry = {
      ...prev,
      id: req.user.id,
      email: req.user.email || null,
      name: await nameOf(req),
      x: num(req.body?.x, 0, 60),
      y: num(req.body?.y, 0, 50),
      away: !!req.body?.away,
      at: Date.now(),
    };
    presence.set(req.user.id, entry);
    const old = positions.get(req.user.id);
    positions.set(req.user.id, { id: entry.id, email: entry.email, name: entry.name, x: entry.x, y: entry.y, away: entry.away });
    if (!old || old.x !== entry.x || old.y !== entry.y || old.away !== entry.away) persist(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Office presence error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- WARDROBE (2026-11-02) ----------
// Itsura ng karakter ng bawat account: mukha, buhok, at listahan ng mga outfit.
// Sariling table, ginagawa rito kung wala pa (parehong istilo ng aliases column).
const MAX_CONFIG_CHARS = 8000;
const ready = sequelize.query(`
  CREATE TABLE IF NOT EXISTS "OfficeAvatars" (
    "userId" INTEGER PRIMARY KEY,
    "config" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(err => console.error('OfficeAvatars table error:', err.message));

// POST /api/office/say  body: { text } — chat bubble sa ulo ng sariling karakter
// (nasa memory lang; nakikita ng lahat sa susunod na GET /presence, mga 8 segundo)
let sayCounter = 0;
router.post('/say', async (req, res) => {
  try {
    const text = String(req.body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!text) return res.status(400).json({ error: 'Message is empty' });
    const prev = presence.get(req.user.id) || { id: req.user.id, email: req.user.email || null, name: await nameOf(req), x: 0, y: 0, away: false };
    presence.set(req.user.id, { ...prev, say: text, sayAt: Date.now(), sayId: ++sayCounter, at: Date.now() });
    res.json({ ok: true, sayId: sayCounter });
  } catch (err) {
    console.error('Office say error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- CHATWOOT NAME MAPPING (2026-11-02) ----------
// Persona name sa Chatwoot (hal. "Admin Hope") → tunay na tao sa roster ng
// office.html (full name, hal. "Milky Guerero"). Admin / Team Leader lang ang
// puwedeng magbago; lahat ay puwedeng magbasa.
const aliasesReady = sequelize.query(`
  CREATE TABLE IF NOT EXISTS "OfficeAliases" (
    "alias" TEXT PRIMARY KEY,
    "person" TEXT NOT NULL,
    "updatedBy" INTEGER,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(err => console.error('OfficeAliases table error:', err.message));
const canMap = role => ['admin', 'team leader'].includes(String(role || '').toLowerCase());

// GET /api/office/aliases
router.get('/aliases', async (req, res) => {
  try {
    await aliasesReady;
    const rows = await sequelize.query('SELECT "alias", "person" FROM "OfficeAliases" ORDER BY "alias"', { type: QueryTypes.SELECT });
    res.json({ aliases: rows, canEdit: canMap(req.user.role) });
  } catch (err) {
    console.error('Office aliases error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/office/aliases  body: { alias, person }  (person = null → tanggalin)
router.put('/aliases', async (req, res) => {
  try {
    if (!canMap(req.user.role)) return res.status(403).json({ error: 'Only admins and team leaders can map names' });
    const alias = String(req.body?.alias || '').trim().slice(0, 120);
    const person = req.body?.person == null ? null : String(req.body.person).trim().slice(0, 120);
    if (!alias) return res.status(400).json({ error: 'alias is required' });
    await aliasesReady;
    if (!person) await sequelize.query('DELETE FROM "OfficeAliases" WHERE "alias" = :alias', { replacements: { alias } });
    else await sequelize.query(`
      INSERT INTO "OfficeAliases" ("alias", "person", "updatedBy", "updatedAt") VALUES (:alias, :person, :by, NOW())
      ON CONFLICT ("alias") DO UPDATE SET "person" = EXCLUDED."person", "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = NOW()`,
      { replacements: { alias, person, by: req.user.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Office alias save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/office/avatars — itsura ng lahat (para sa mapa)
router.get('/avatars', async (req, res) => {
  try {
    await ready;
    const rows = await sequelize.query(`
      SELECT a."userId" AS id, u."name", u."email", a."config"
      FROM "OfficeAvatars" a JOIN "Users" u ON u."id" = a."userId"`, { type: QueryTypes.SELECT });
    res.json({ avatars: rows });
  } catch (err) {
    console.error('Office avatars error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/office/avatar  body: { config } — sariling account lang
router.put('/avatar', async (req, res) => {
  try {
    const config = req.body?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) return res.status(400).json({ error: 'config must be an object' });
    const json = JSON.stringify(config);
    if (json.length > MAX_CONFIG_CHARS) return res.status(400).json({ error: 'Wardrobe is too large' });
    await ready;
    await sequelize.query(`
      INSERT INTO "OfficeAvatars" ("userId", "config", "updatedAt") VALUES (:id, CAST(:json AS JSONB), NOW())
      ON CONFLICT ("userId") DO UPDATE SET "config" = EXCLUDED."config", "updatedAt" = NOW()`,
      { replacements: { id: req.user.id, json } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Office avatar save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
