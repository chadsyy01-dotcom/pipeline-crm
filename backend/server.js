require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize, DealStage } = require('./models');

const app = express();
app.use(cors());
// `verify` stashes the raw request bytes on req.rawBody alongside the normal
// parsed req.body — needed by routes/chatwoot.js to check the Chatwoot
// webhook signature, since that has to be computed over the exact raw JSON
// as sent, not a re-serialized copy (which can differ in key order/spacing).
// limit raised to 2mb (2026-09-16) so large Knowledge Base docs can be saved
// — the Express default is only 100kb.
app.use(express.json({
  limit: '2mb',
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/deal-stages', require('./routes/dealStages'));
app.use('/api/deals', require('./routes/deals'));
app.use('/api/openai-billing', require('./routes/openaiBilling'));
app.use('/api/chatwoot', require('./routes/chatwoot'));
app.use('/api/livechat', require('./routes/livechat'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/kb', require('./routes/kb'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;

async function start() {
  await sequelize.sync(); // use migrations instead of sync() in production

  // Seed default pipeline stages on first run
  const stageCount = await DealStage.count();
  if (stageCount === 0) {
    await DealStage.bulkCreate([
      { name: 'New', order: 0 },
      { name: 'Qualified', order: 1 },
      { name: 'Proposal', order: 2 },
      { name: 'Negotiation', order: 3 },
      { name: 'Won', order: 4, isWon: true },
      { name: 'Lost', order: 5, isLost: true },
    ]);
    console.log('Seeded default pipeline stages');
  }

  app.listen(PORT, () => console.log(`Pipeline CRM API running on port ${PORT}`));
}

start();
