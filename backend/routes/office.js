const express = require('express');
const { User } = require('../models');
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
    const entry = {
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

module.exports = router;
