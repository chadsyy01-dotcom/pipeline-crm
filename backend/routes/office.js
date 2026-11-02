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

// GET /api/office/presence — lahat ng nasa page ngayon
router.get('/presence', (req, res) => {
  const now = Date.now();
  const people = [];
  for (const [id, p] of presence) {
    if (now - p.at > TTL_MS) presence.delete(id);
    else people.push(p);
  }
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
      x: num(req.body?.x, 0, 40),
      y: num(req.body?.y, 0, 30),
      away: !!req.body?.away,
      at: Date.now(),
    };
    presence.set(req.user.id, entry);
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
    if (!text) return res.status(400).json({ error: 'Walang mensahe' });
    const prev = presence.get(req.user.id) || { id: req.user.id, email: req.user.email || null, name: await nameOf(req), x: 0, y: 0, away: false };
    presence.set(req.user.id, { ...prev, say: text, sayAt: Date.now(), sayId: ++sayCounter, at: Date.now() });
    res.json({ ok: true, sayId: sayCounter });
  } catch (err) {
    console.error('Office say error:', err.message);
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
    if (!config || typeof config !== 'object' || Array.isArray(config)) return res.status(400).json({ error: 'config (object) ang kailangan' });
    const json = JSON.stringify(config);
    if (json.length > MAX_CONFIG_CHARS) return res.status(400).json({ error: 'Masyadong malaki ang wardrobe' });
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
