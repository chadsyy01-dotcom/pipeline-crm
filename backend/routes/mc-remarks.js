// ---------------------------------------------------------------------------
// INTERNAL REMARKS PARA SA MISSED CHATS (2026-10-25, utos ni Chad)
//
// CSR naglalagay ng DAHILAN kung bakit na-miss ang chat; TL/Admin ang
// nagva-validate. INTERNAL LANG ITO — nakaimbak sa sariling table ng
// dashboard, HINDI ipinapadala sa Chatwoot/LiveChat, kaya hindi makikita ng
// player.
//
//   POST /api/mc-remarks/lookup   { items:[{brand, conversationId}] }
//        → { remarks: { "<brand>:<conversationId>": {...} } }
//   PUT  /api/mc-remarks/:brand/:conversationId   { reason }
//        → lahat ng naka-login; kapag binago ang reason, nagre-reset ang
//          validation (kailangang i-validate ulit ng TL).
//   POST /api/mc-remarks/:brand/:conversationId/validate  { validated, note }
//        → admin at Team Leader lang.
//   GET  /api/mc-remarks/recent?days=7  → listahan (para sa pag-review ng TL)
// ---------------------------------------------------------------------------
const express = require('express');
const router = express.Router();
const { sequelize, User } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

const TABLE_READY = (async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "McRemarks" (
        "id" SERIAL PRIMARY KEY,
        "brand" TEXT NOT NULL,
        "conversationId" BIGINT NOT NULL,
        "reason" TEXT NOT NULL,
        "remarkBy" TEXT,
        "remarkByEmail" TEXT,
        "remarkAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "validated" BOOLEAN NOT NULL DEFAULT FALSE,
        "validatedBy" TEXT,
        "validatedAt" TIMESTAMPTZ,
        "validationNote" TEXT,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE ("brand", "conversationId")
      )
    `);
  } catch (err) {
    console.error('McRemarks: table init failed:', err.message);
  }
})();

const isValidator = (role) => /^(admin|team leader)$/i.test(String(role || ''));

async function actorName(req) {
  try {
    const u = await User.findByPk(req.user.id, { attributes: ['name', 'email'] });
    return { name: (u && u.name) || req.user.email || 'unknown', email: (u && u.email) || req.user.email || null };
  } catch { return { name: req.user.email || 'unknown', email: req.user.email || null }; }
}

const key = (r) => `${r.brand}:${r.conversationId}`;

router.post('/lookup', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const pairs = items
      .map(i => ({ brand: String(i.brand || '').trim(), conversationId: Number(i.conversationId) }))
      .filter(i => i.brand && i.conversationId)
      .slice(0, 2000);
    if (!pairs.length) return res.json({ remarks: {} });
    const brands = [...new Set(pairs.map(p => p.brand))];
    const ids = [...new Set(pairs.map(p => p.conversationId))];
    const rows = await sequelize.query(
      `SELECT * FROM "McRemarks" WHERE "brand" IN (:brands) AND "conversationId" IN (:ids)`,
      { replacements: { brands, ids }, type: QueryTypes.SELECT });
    const want = new Set(pairs.map(key));
    const remarks = {};
    rows.forEach(r => { if (want.has(key(r))) remarks[key(r)] = r; });
    res.json({ remarks });
  } catch (err) {
    console.error('McRemarks lookup:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:brand/:conversationId', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const brand = String(req.params.brand || '').trim();
    const conversationId = Number(req.params.conversationId);
    const reason = String(req.body?.reason || '').trim().slice(0, 2000);
    if (!brand || !conversationId) return res.status(400).json({ error: 'brand at conversationId ang kailangan' });
    if (!reason) return res.status(400).json({ error: 'Ilagay ang dahilan ng missed chat.' });
    const who = await actorName(req);
    const [row] = await sequelize.query(`
      INSERT INTO "McRemarks" ("brand","conversationId","reason","remarkBy","remarkByEmail","remarkAt","updatedAt")
      VALUES (:brand, :conversationId, :reason, :name, :email, NOW(), NOW())
      ON CONFLICT ("brand","conversationId") DO UPDATE SET
        "reason" = EXCLUDED."reason",
        "remarkBy" = EXCLUDED."remarkBy",
        "remarkByEmail" = EXCLUDED."remarkByEmail",
        "remarkAt" = NOW(),
        "updatedAt" = NOW(),
        -- binago ang dahilan → kailangang i-validate ulit
        "validated" = CASE WHEN "McRemarks"."reason" = EXCLUDED."reason" THEN "McRemarks"."validated" ELSE FALSE END,
        "validatedBy" = CASE WHEN "McRemarks"."reason" = EXCLUDED."reason" THEN "McRemarks"."validatedBy" ELSE NULL END,
        "validatedAt" = CASE WHEN "McRemarks"."reason" = EXCLUDED."reason" THEN "McRemarks"."validatedAt" ELSE NULL END,
        "validationNote" = CASE WHEN "McRemarks"."reason" = EXCLUDED."reason" THEN "McRemarks"."validationNote" ELSE NULL END
      RETURNING *
    `, { replacements: { brand, conversationId, reason, name: who.name, email: who.email }, type: QueryTypes.SELECT });
    console.log(`McRemarks: ${who.name} -> ${brand} #${conversationId}`);
    res.json({ ok: true, remark: row });
  } catch (err) {
    console.error('McRemarks save:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:brand/:conversationId/validate', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    if (!isValidator(req.user.role)) return res.status(403).json({ error: 'Team Leader o Admin lang ang puwedeng mag-validate.' });
    const brand = String(req.params.brand || '').trim();
    const conversationId = Number(req.params.conversationId);
    const validated = req.body?.validated !== false;
    const note = String(req.body?.note || '').trim().slice(0, 1000) || null;
    const who = await actorName(req);
    const [row] = await sequelize.query(`
      UPDATE "McRemarks" SET
        "validated" = :validated,
        "validatedBy" = CASE WHEN :validated THEN :name ELSE NULL END,
        "validatedAt" = CASE WHEN :validated THEN NOW() ELSE NULL END,
        "validationNote" = :note,
        "updatedAt" = NOW()
      WHERE "brand" = :brand AND "conversationId" = :conversationId
      RETURNING *
    `, { replacements: { brand, conversationId, validated, note, name: who.name }, type: QueryTypes.SELECT });
    if (!row) return res.status(404).json({ error: 'Wala pang remark ang chat na ito.' });
    res.json({ ok: true, remark: row });
  } catch (err) {
    console.error('McRemarks validate:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/recent', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const rows = await sequelize.query(
      `SELECT * FROM "McRemarks" WHERE "updatedAt" >= NOW() - (:days || ' days')::interval ORDER BY "updatedAt" DESC LIMIT 1000`,
      { replacements: { days: String(days) }, type: QueryTypes.SELECT });
    res.json({ remarks: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
