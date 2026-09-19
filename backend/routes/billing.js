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
//
// ---------------------------------------------------------------------------
// FIX 2026-09-19 — "no unique or exclusion constraint matching the ON CONFLICT
// specification" (Postgres 42P10) on every save.
//
// Cause: a "BillingConfig" table already existed in this database with a
// DIFFERENT shape (no unique constraint on "key"). CREATE TABLE IF NOT EXISTS
// silently skips when the table exists, so the PRIMARY KEY below was never
// actually applied — and ON CONFLICT ("key") has nothing to match against.
//
// Two layers of fix, so this can't bite again:
//   1. ensureSchema() self-heals on boot: adds any missing columns, removes
//      duplicate "key" rows (keeping the newest), then creates a UNIQUE index
//      on "key" if one is missing.
//   2. saveConfig() no longer uses ON CONFLICT at all — it does UPDATE, and
//      INSERTs only when nothing was updated. This works whether or not the
//      unique index exists, so saves succeed even if step 1 can't run (e.g.
//      the DB user lacks DDL rights).
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

const TABLE_READY = (async () => {
  // Step 1: create the table if this is a fresh database.
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "BillingConfig" (
        "key" TEXT PRIMARY KEY,
        "data" JSONB NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedBy" TEXT
      )
    `);
  } catch (err) {
    console.error('Billing: table init failed:', err.message);
  }

  // Step 2: make sure the columns we rely on exist, in case an older/other
  // version of this table is what's actually in the database.
  for (const ddl of [
    `ALTER TABLE "BillingConfig" ADD COLUMN IF NOT EXISTS "data" JSONB`,
    `ALTER TABLE "BillingConfig" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE "BillingConfig" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT`,
  ]) {
    try { await sequelize.query(ddl); } catch (err) {
      console.warn('Billing: column check skipped —', err.message);
    }
  }

  // Step 3: ensure "key" is unique. Duplicates must go first or the index
  // creation fails; the newest row per key wins.
  try {
    const dupes = await sequelize.query(
      `SELECT "key", COUNT(*) AS n FROM "BillingConfig" GROUP BY "key" HAVING COUNT(*) > 1`,
      { type: QueryTypes.SELECT }
    );
    if (dupes.length) {
      await sequelize.query(`
        DELETE FROM "BillingConfig"
        WHERE ctid NOT IN (
          SELECT DISTINCT ON ("key") ctid
          FROM "BillingConfig"
          ORDER BY "key", "updatedAt" DESC NULLS LAST, ctid DESC
        )
      `);
      console.log(`Billing: removed duplicate rows for ${dupes.length} key(s), newest kept.`);
    }
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "billingconfig_key_unique" ON "BillingConfig" ("key")`
    );
    console.log('Billing: BillingConfig table ready (key is unique).');
  } catch (err) {
    // Not fatal — saveConfig() below does not depend on the index.
    console.warn('Billing: could not enforce unique "key" —', err.message,
                 '(saves will still work via update-then-insert)');
  }
})();

// Writes one JSON document under `key`. Deliberately avoids ON CONFLICT so it
// does not depend on a unique constraint existing (see FIX note at the top).
async function saveConfig(key, data, updatedBy) {
  const [, meta] = await sequelize.query(`
    UPDATE "BillingConfig"
       SET "data" = :data::jsonb, "updatedAt" = NOW(), "updatedBy" = :updatedBy
     WHERE "key" = :key
  `, { replacements: { key, data: JSON.stringify(data), updatedBy } });

  // Sequelize reports affected rows differently across dialects/versions.
  const affected = typeof meta === 'number' ? meta : (meta?.rowCount ?? 0);
  if (affected > 0) return;

  await sequelize.query(`
    INSERT INTO "BillingConfig" ("key", "data", "updatedAt", "updatedBy")
    VALUES (:key, :data::jsonb, NOW(), :updatedBy)
  `, { replacements: { key, data: JSON.stringify(data), updatedBy } });
}

// Reads one JSON document. Returns null when the key has never been saved.
async function readConfig(key) {
  const rows = await sequelize.query(`
    SELECT "data", "updatedAt", "updatedBy"
      FROM "BillingConfig"
     WHERE "key" = :key
     ORDER BY "updatedAt" DESC NULLS LAST
     LIMIT 1
  `, { replacements: { key }, type: QueryTypes.SELECT });
  return rows.length ? rows[0] : null;
}

// Shape stored under key 'consolidated':
// {
//   services: ["Netlify","N8N","Claude","Host Server","Supabase","LiveChat","SMS","Open AI"],
//   dates:    ["15th of the month", ...],           // same length as services
//   divisions:[{ name: "TMTCASH", vals: [114.04, 1431.43, ...] }, ...]
// }
// TOTALs are always computed, never stored — so they can't drift.
// LiveChat (2026-09-15) and SMS (2026-09-19) are manual-input columns; the
// Open AI column is a live overlay computed in the frontend and stored null.

// GET /api/billing/consolidated -> { data: {...} | null, updatedAt, updatedBy }
router.get('/consolidated', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const row = await readConfig('consolidated');
    if (!row) return res.json({ data: null });
    res.json({ data: row.data, updatedAt: row.updatedAt, updatedBy: row.updatedBy });
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
    await saveConfig('consolidated', data, updatedBy);
    console.log(`Billing: consolidated saved by ${updatedBy || 'unknown'} — ${data.divisions.length} divisions.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Billing save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// OpenAI credit baselines (added 2026-09-15). OpenAI exposes no balance API,
// so the dashboard computes balance = entered baseline - live spend since
// its date. This stores the baselines under key 'openai-credits'.
// Shape: { accounts: { "<account name>": { balance: 5.83, asOf: "2026-09-15" } } }
// ---------------------------------------------------------------------------
router.get('/openai-credits', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const row = await readConfig('openai-credits');
    if (!row) return res.json({ data: null });
    res.json({ data: row.data, updatedAt: row.updatedAt, updatedBy: row.updatedBy });
  } catch (err) {
    console.error('Billing openai-credits get error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/openai-credits', requireAuth, async (req, res) => {
  try {
    await TABLE_READY;
    const data = req.body?.data;
    if (!data || typeof data.accounts !== 'object' || data.accounts === null
        || !Object.values(data.accounts).every(v => v && typeof v.balance === 'number'
             && typeof v.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.asOf))) {
      return res.status(400).json({ error: 'Invalid credit baseline shape.' });
    }
    const updatedBy = req.user?.name || req.user?.email || null;
    await saveConfig('openai-credits', data, updatedBy);
    console.log(`Billing: openai-credits saved by ${updatedBy || 'unknown'} \u2014 ${Object.keys(data.accounts).length} accounts.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Billing openai-credits save error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
