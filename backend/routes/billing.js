// backend/routes/billing.js
//
// Consolidated Billing storage (added 2026-09-14). The OpenAI page's
// "Consolidated Billing (Monthly)" section is EDITABLE in-dashboard; this
// route persists it. The database (not the Google Sheet) is the source of
// truth — the sheet is only offered as a one-time import seed on first use,
// because the published-CSV link is read-only and writing back to Google
// would need a Sheets API service account (not worth the setup).
//
// Storage: a single JSON document in a tiny key-value table created on
// demand (raw SQL, no Sequelize model needed — keeps models/ untouched).
//
// WIRING (one line, backend/server.js, next to the other route mounts):
//   app.use('/api/billing', require('./routes/billing'));

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

const TABLE_READY = (async () => {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "BillingConfig" (
        "key" TEXT PRIMARY KEY,
        "data" JSONB NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedBy" TEXT
      )
    `);
    console.log('Billing: BillingConfig table ready.');
  } catch (err) {
    console.error('Billing: table init failed:', err.message);
  }
})();

// Shape stored under key 'consolidated':
// {
//   services: ["Netlify","N8N","Claude","Host Server","Supabase","Open AI"],
//   dates:    ["15th of the month", ...],           // same length as services
//   divisions:[{ name: "TMTCASH", vals: [114.04, 1431.43, ...] }, ...]
// }
// TOTALs are always computed, never stored — so they can't drift.

// GET /api/billing/consolidated -> { data: {...} | null, updatedAt, updatedBy }
router.get('/consolidated', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const rows = await sequelize.query(`
      SELECT "data", "updatedAt", "updatedBy" FROM "BillingConfig" WHERE "key" = 'consolidated'
    `, { type: QueryTypes.SELECT });
    if (!rows.length) return res.json({ data: null });
    res.json({ data: rows[0].data, updatedAt: rows[0].updatedAt, updatedBy: rows[0].updatedBy });
  } catch (err) {
    console.error('Billing get error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/billing/consolidated  body: { data: {...} }
router.put('/consolidated', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const data = req.body?.data;
    // Light validation — enough to reject garbage without being brittle.
    if (!data || !Array.isArray(data.services) || !Array.isArray(data.divisions)
        || !data.services.length || !data.divisions.length
        || !data.divisions.every(d => d && typeof d.name === 'string'
             && Array.isArray(d.vals) && d.vals.length === data.services.length)) {
      return res.status(400).json({ error: 'Invalid billing data shape.' });
    }
    const updatedBy = req.user?.name || req.user?.email || null;
    await sequelize.query(`
      INSERT INTO "BillingConfig" ("key", "data", "updatedAt", "updatedBy")
      VALUES ('consolidated', :data::jsonb, NOW(), :updatedBy)
      ON CONFLICT ("key") DO UPDATE
        SET "data" = EXCLUDED."data", "updatedAt" = NOW(), "updatedBy" = EXCLUDED."updatedBy"
    `, { replacements: { data: JSON.stringify(data), updatedBy } });
    console.log(`Billing: consolidated saved by ${updatedBy || 'unknown'} — ${data.divisions.length} divisions.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Billing save error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
