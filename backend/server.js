require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize, DealStage } = require('./models');

const zlib = require('zlib');

const app = express();
app.use(cors());

// GZIP (2026-10-20): pinapaliit ang JSON/text na ipinapadala sa browser (~70–80% mas maliit),
// para bumaba ang egress cost sa Railway. Built-in zlib lang — walang bagong npm package.
// Gzip lang kapag tinatanggap ng browser, ≥ 1 KB, at JSON/text ang laman.
app.use((req, res, next) => {
  if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();
  const origSend = res.send.bind(res);
  res.send = function (body) {
    if (res.headersSent || res.getHeader('Content-Encoding') || res.statusCode === 204 || res.statusCode === 304) return origSend(body);
    const type = String(res.getHeader('Content-Type') || '');
    let buf = null;
    if (typeof body === 'string') buf = Buffer.from(body, 'utf8');
    else if (Buffer.isBuffer(body) && /json|text|javascript|csv/i.test(type)) buf = body;
    if (!buf || buf.length < 1024 || !/json|text|javascript|csv/i.test(type)) return origSend(body);
    try {
      const gz = zlib.gzipSync(buf, { level: 6 });
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.removeHeader('Content-Length');
      return origSend(gz);
    } catch (e) {
      return origSend(body);
    }
  };
  next();
});
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
app.use('/api/qa', require('./routes/qa-kb')); // KB Accuracy QA (added 2026-09-22) — needs OPENAI_API_KEY
app.use('/api/chat', require('./routes/chat-search')); // Chat-content search para sa Customers page (2026-09-24)
app.use('/api/divbilling', require('./routes/divbilling'));
app.use('/api/geo', require('./routes/geo')); // Concerns Map: IP → lungsod + mapa ng PH (2026-10-18)

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
