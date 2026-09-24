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
    // PAGINATION (2026-09-24): ang bawat request ay nagsa-scan ng
    // pinakabagong 400 matching messages. Kapag puno, ipinapasa ng
    // frontend ang createdAt ng pinakalumang nabasa bilang ?before= para
    // ituloy ang scan sa mas luma pa ("Load more" button).
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !isNaN(before.getTime())) { dateCond += ' AND "createdAt" < :before'; replacements.before = before.toISOString(); }

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

    // IP MATCH (2026-09-24): ang IP ay nasa customerIp column, hindi sa
    // message content, kaya may sariling paghahanap. Tumatakbo lang kapag
    // IP-like ang query (digits/hex/tuldok/colon) at sa UNANG page (walang
    // before cursor — walang pagination ang IP matches, kumpleto agad sila).
    // Sakop din ng since/until date range.
    let ipResults = [];
    if (!before && /^[0-9a-fA-F:.]{3,45}$/.test(q)) {
      const ipRows = await sequelize.query(`
        SELECT DISTINCT ON ("conversationId")
          "conversationId", "brand", "customerIp", "createdAt"
        FROM "ChatwootEvents"
        WHERE "customerIp" ILIKE :pat ESCAPE '\\'
          AND "conversationId" IS NOT NULL${dateCond}
        ORDER BY "conversationId", "createdAt" DESC
        LIMIT 200
      `, { replacements, type: QueryTypes.SELECT });
      if (ipRows.length) {
        const ipIds = ipRows.map(r => r.conversationId);
        const names = await sequelize.query(`
          SELECT DISTINCT ON ("conversationId") "conversationId", "contactName"
          FROM "ChatwootEvents"
          WHERE "conversationId" IN (:ipIds) AND "contactName" IS NOT NULL
          ORDER BY "conversationId", "createdAt" DESC
        `, { replacements: { ipIds }, type: QueryTypes.SELECT });
        const nmap = new Map(names.map(r => [r.conversationId, r.contactName]));
        ipResults = ipRows.map(r => ({
          conversationId: r.conversationId,
          brand: r.brand,
          contactName: nmap.get(r.conversationId) || null,
          snippet: '\uD83D\uDCCD IP match: ' + r.customerIp,
          matchedSender: null,
          matchedAt: r.createdAt,
          matches: 1,
        }));
      }
    }

    // Pagsamahin: IP matches + content matches (deduped), pinakabago muna.
    const ipKeys = new Set(ipResults.map(r => r.brand + '::' + r.conversationId));
    const merged = [
      ...ipResults,
      ...[...byConv.values()].filter(r => !ipKeys.has(r.brand + '::' + r.conversationId)),
    ].sort((a, b) => new Date(b.matchedAt) - new Date(a.matchedAt));

    const oldestScanned = rows.length ? rows[rows.length - 1].createdAt : null;
    res.json({
      q,
      results: merged.slice(0, limit),
      // Para sa "Load more": may natitira pa kapag umabot sa scan cap.
      hasMore: rows.length === 400,
      oldestScanned,
    });
  } catch (err) {
    console.error('Chat search error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
