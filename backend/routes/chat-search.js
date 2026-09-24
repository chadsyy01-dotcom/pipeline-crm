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

// Snippet na nakasentro sa MISMONG tinamaan. Kung ang tumama ay nasa
// nakatagong bahagi ng HTML (hal. href URL ng "Submit ticket here" link
// na hindi lumalabas sa nakikitang text), ipapakita ang URL mismo para
// malinaw kung bakit tumama ang mensahe. (2026-09-24)
function buildSnippet(rawContent, q) {
  const text = stripHtml(rawContent);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx !== -1) {
    // Tumama sa nakikitang text — snippet sa paligid ng tama.
    const start = Math.max(0, idx - 80);
    const end = Math.min(text.length, idx + q.length + 140);
    return (start > 0 ? '\u2026' : '') + text.slice(start, end) + (end < text.length ? '\u2026' : '');
  }
  // Hindi nasa visible text — hanapin sa mga link/URL sa loob ng HTML.
  const urls = String(rawContent).match(/https?:\/\/[^\s"'<>]+/g) || [];
  const hitUrl = urls.find(u => u.toLowerCase().includes(q.toLowerCase()));
  if (hitUrl) {
    return '\uD83D\uDD17 Match sa link sa loob ng message: ' + hitUrl + (text ? ' \u2014 \u201C' + text.slice(0, 120) + '\u2026\u201D' : '');
  }
  // Fallback: tumama sa ibang HTML attribute — ipakita na lang ang simula.
  return text.slice(0, 220);
}

router.get('/search', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.status(400).json({ error: 'q must be at least 3 characters' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    // I-escape ang ILIKE wildcards para literal ang paghahanap.
    const pat = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';

    // Optional date range (2026-09-24): galing sa Activity dropdown ng
    // Customers page (This Month, Yesterday, custom, atbp.) — kung wala,
    // buong retention ang saklaw. Mahalaga ito sa mga karaniwang search
    // terms (hal. ticket URL na laman ng halos bawat chat): kung walang
    // saklaw, ang pinakabagong 400 messages lang ang maabot at hindi
    // makikita ang mas maagang bahagi ng panahon.
    const replacements = { pat };
    let dateCond = '';
    const since = req.query.since ? new Date(req.query.since) : null;
    const until = req.query.until ? new Date(req.query.until) : null;
    if (since && !isNaN(since.getTime())) { dateCond += ' AND "createdAt" >= :since'; replacements.since = since.toISOString(); }
    if (until && !isNaN(until.getTime())) { dateCond += ' AND "createdAt" <= :until'; replacements.until = until.toISOString(); }

    const rows = await sequelize.query(`
      SELECT "conversationId", "brand", "contactName", "content", "senderName", "senderType", "createdAt"
      FROM "ChatwootEvents"
      WHERE event = 'message_created'
        AND "content" ILIKE :pat ESCAPE '\\'
        AND "conversationId" IS NOT NULL${dateCond}
      ORDER BY "createdAt" DESC
      LIMIT 400
    `, { replacements, type: QueryTypes.SELECT });

    // Group per conversation — ang unang row (pinakabago) ang snippet.
    const byConv = new Map();
    for (const r of rows) {
      const key = r.brand + '::' + r.conversationId;
      if (!byConv.has(key)) {
        byConv.set(key, {
          conversationId: r.conversationId,
          brand: r.brand,
          contactName: r.contactName || null,
          snippet: buildSnippet(r.content, q).slice(0, 300),
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
