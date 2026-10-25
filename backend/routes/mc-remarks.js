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
//
// PROOF / SCREENSHOT (2026-10-25, "dapat pwede sila mag-add ng proof"):
//   POST   /api/mc-remarks/:brand/:conversationId/files   (raw body ng image
//          o video, headers X-File-Name, X-Duration) → naka-imbak sa
//          "McRemarkFiles" (BYTEA). Image max 5 MB; VIDEO max 3 minuto
//          (sinusuri sa browser bago i-upload) at max 40 MB. Max 6 files kada
//          remark; kailangang may reason na muna.
//   GET    /api/mc-remarks/files/:id   → ang larawan mismo (auth required)
//   DELETE /api/mc-remarks/files/:id   → nag-upload mismo, Team Leader o Admin
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
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "McRemarkFiles" (
        "id" SERIAL PRIMARY KEY,
        "brand" TEXT NOT NULL,
        "conversationId" BIGINT NOT NULL,
        "name" TEXT,
        "type" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "data" BYTEA NOT NULL,
        "uploadedBy" TEXT,
        "uploadedByEmail" TEXT,
        "uploadedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS "McRemarkFiles_conv" ON "McRemarkFiles" ("brand","conversationId")`);
  } catch (err) {
    console.error('McRemarks: table init failed:', err.message);
  }
})();

const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_VIDEO = 40 * 1024 * 1024;
const MAX_VIDEO_SEC = 180;
const MAX_FILES_PER_REMARK = 6;
const IMAGE_RE = /^image\/(png|jpe?g|gif|webp)$/i;
const VIDEO_RE = /^video\/(mp4|webm|quicktime|x-matroska)$/i;
const fileMeta = (f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, uploadedBy: f.uploadedBy, uploadedAt: f.uploadedAt });

const isValidator = (role) => /^(admin|team leader)$/i.test(String(role || ''));

async function actorName(req) {
  try {
    const u = await User.findByPk(req.user.id, { attributes: ['name', 'email'] });
    return { name: (u && u.name) || req.user.email || 'unknown', email: (u && u.email) || req.user.email || null };
  } catch { return { name: req.user.email || 'unknown', email: req.user.email || null }; }
}

const key = (r) => `${r.brand}:${r.conversationId}`;

async function withFiles(row) {
  if (!row) return row;
  const files = await sequelize.query(
    `SELECT "id","name","type","size","uploadedBy","uploadedAt" FROM "McRemarkFiles" WHERE "brand" = :brand AND "conversationId" = :id ORDER BY "id"`,
    { replacements: { brand: row.brand, id: row.conversationId }, type: QueryTypes.SELECT });
  return { ...row, files: files.map(fileMeta) };
}

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
    rows.forEach(r => { if (want.has(key(r))) remarks[key(r)] = { ...r, files: [] }; });
    const files = await sequelize.query(
      `SELECT "id","brand","conversationId","name","type","size","uploadedBy","uploadedAt" FROM "McRemarkFiles"
       WHERE "brand" IN (:brands) AND "conversationId" IN (:ids) ORDER BY "id"`,
      { replacements: { brands, ids }, type: QueryTypes.SELECT });
    files.forEach(f => { const r = remarks[key(f)]; if (r) r.files.push(fileMeta(f)); });
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
    res.json({ ok: true, remark: await withFiles(row) });
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
    res.json({ ok: true, remark: await withFiles(row) });
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

// ---- PROOF FILES ---------------------------------------------------------
router.post('/:brand/:conversationId/files', requireAuth,
  express.raw({ type: () => true, limit: MAX_VIDEO + 1024 }),
  async (req, res) => {
    try {
      await TABLE_READY;
      const brand = String(req.params.brand || '').trim();
      const conversationId = Number(req.params.conversationId);
      const type = String(req.headers['content-type'] || '').split(';')[0].trim();
      if (!brand || !conversationId) return res.status(400).json({ error: 'brand at conversationId ang kailangan' });
      const isImg = IMAGE_RE.test(type), isVid = VIDEO_RE.test(type);
      if (!isImg && !isVid) return res.status(400).json({ error: 'Larawan (PNG, JPG, GIF, WEBP) o video (MP4, WEBM, MOV) lang ang puwedeng i-upload.' });
      const buf = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buf || !buf.length) return res.status(400).json({ error: 'Walang laman ang file.' });
      if (isImg && buf.length > MAX_IMAGE) return res.status(413).json({ error: 'Masyadong malaki ang larawan (max 5 MB).' });
      if (isVid && buf.length > MAX_VIDEO) return res.status(413).json({ error: 'Masyadong malaki ang video (max 40 MB) — i-trim o i-compress muna.' });
      const dur = Number(req.headers['x-duration']);
      if (isVid && dur && dur > MAX_VIDEO_SEC + 1) return res.status(400).json({ error: 'Max 3 minuto lang ang video clip.' });
      const [exists] = await sequelize.query(`SELECT 1 FROM "McRemarks" WHERE "brand" = :brand AND "conversationId" = :id`,
        { replacements: { brand, id: conversationId }, type: QueryTypes.SELECT });
      if (!exists) return res.status(400).json({ error: 'I-save muna ang dahilan bago mag-attach ng proof.' });
      const [{ n }] = await sequelize.query(`SELECT COUNT(*)::int AS n FROM "McRemarkFiles" WHERE "brand" = :brand AND "conversationId" = :id`,
        { replacements: { brand, id: conversationId }, type: QueryTypes.SELECT });
      if (n >= MAX_FILES_PER_REMARK) return res.status(400).json({ error: `Max ${MAX_FILES_PER_REMARK} na larawan kada remark.` });
      const who = await actorName(req);
      const name = decodeURIComponent(String(req.headers['x-file-name'] || 'screenshot')).replace(/[^\w.\- ()]+/g, '_').slice(0, 120);
      const [row] = await sequelize.query(`
        INSERT INTO "McRemarkFiles" ("brand","conversationId","name","type","size","data","uploadedBy","uploadedByEmail")
        VALUES (:brand, :id, :name, :type, :size, :data, :by, :email)
        RETURNING "id","name","type","size","uploadedBy","uploadedAt"
      `, { replacements: { brand, id: conversationId, name, type, size: buf.length, data: buf, by: who.name, email: who.email }, type: QueryTypes.SELECT });
      await sequelize.query(`UPDATE "McRemarks" SET "updatedAt" = NOW() WHERE "brand" = :brand AND "conversationId" = :id`,
        { replacements: { brand, id: conversationId } });
      res.json({ ok: true, file: fileMeta(row) });
    } catch (err) {
      console.error('McRemarks file upload:', err.message);
      res.status(err.type === 'entity.too.large' ? 413 : 500).json({ error: err.type === 'entity.too.large' ? 'Masyadong malaki ang file (image max 5 MB, video max 40 MB).' : err.message });
    }
  });

router.get('/files/:id', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const [f] = await sequelize.query(`SELECT "type","name","data" FROM "McRemarkFiles" WHERE "id" = :id`,
      { replacements: { id: Number(req.params.id) || 0 }, type: QueryTypes.SELECT });
    if (!f) return res.status(404).json({ error: 'Wala ang file.' });
    const data = Buffer.from(f.data);
    res.set('Content-Type', f.type);
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('Accept-Ranges', 'bytes');
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(f.name || 'proof')}"`);
    // Range requests para gumana ang seek ng <video>
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && /^video\//i.test(f.type)) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      if (start >= data.length || start > end) { res.set('Content-Range', `bytes */${data.length}`); return res.status(416).end(); }
      res.status(206);
      res.set('Content-Range', `bytes ${start}-${end}/${data.length}`);
      res.set('Content-Length', String(end - start + 1));
      return res.end(data.subarray(start, end + 1));
    }
    res.set('Content-Length', String(data.length));
    res.end(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/files/:id', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const id = Number(req.params.id) || 0;
    const [f] = await sequelize.query(`SELECT "id","uploadedByEmail" FROM "McRemarkFiles" WHERE "id" = :id`,
      { replacements: { id }, type: QueryTypes.SELECT });
    if (!f) return res.status(404).json({ error: 'Wala ang file.' });
    const mine = f.uploadedByEmail && req.user.email && f.uploadedByEmail.toLowerCase() === String(req.user.email).toLowerCase();
    if (!mine && !isValidator(req.user.role)) return res.status(403).json({ error: 'Ang nag-upload, Team Leader o Admin lang ang puwedeng mag-delete.' });
    await sequelize.query(`DELETE FROM "McRemarkFiles" WHERE "id" = :id`, { replacements: { id } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
