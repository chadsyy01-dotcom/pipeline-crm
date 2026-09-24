// backend/routes/chat-search.js  (2026-09-24)
//
// GET /api/chat/search?q=...&limit=100
//
// FULL CHAT-CONTENT SEARCH: hinahanap ang :q sa LAMAN ng lahat ng chat
// messages (ChatwootEvents.content) — lahat ng brands, buong retention
// (~70 days) — grouped per conversation, pinakabago muna. Ginagamit ng
// Customers page search box para mahanap ang usapan kahit SAANG mensahe
// nabanggit ang hinahanap (hal. Ticket ID, amount, username, phone).
//
// WIRING (server.js):
//   app.use('/api/chat', require('./routes/chat-search'));
// Walang environment variable na kailangan.

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

function stripHtml(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

router.get('/search', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.status(400).json({ error: 'q must be at least 3 characters' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    // I-escape ang ILIKE wildcards para literal ang paghahanap.
    const pat = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';

    const rows = await sequelize.query(`
      SELECT "conversationId", "brand", "contactName", "content", "senderName", "senderType", "createdAt"
      FROM "ChatwootEvents"
      WHERE event = 'message_created'
        AND "content" ILIKE :pat ESCAPE '\\'
        AND "conversationId" IS NOT NULL
      ORDER BY "createdAt" DESC
      LIMIT 400
    `, { replacements: { pat }, type: QueryTypes.SELECT });

    // Group per conversation — ang unang row (pinakabago) ang snippet.
    const byConv = new Map();
    for (const r of rows) {
      const key = r.brand + '::' + r.conversationId;
      if (!byConv.has(key)) {
        byConv.set(key, {
          conversationId: r.conversationId,
          brand: r.brand,
          contactName: r.contactName || null,
          snippet: stripHtml(r.content).slice(0, 220),
          matchedSender: r.senderName || (r.senderType === 'contact' ? 'Customer' : null),
          matchedAt: r.createdAt,
          matches: 0,
        });
      }
      const item = byConv.get(key);
      item.matches++;
      if (!item.contactName && r.senderType === 'contact' && r.contactName) item.contactName = r.contactName;
    }

    res.json({ q, results: [...byConv.values()].slice(0, limit) });
  } catch (err) {
    console.error('Chat search error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
