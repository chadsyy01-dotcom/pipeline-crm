// backend/routes/qa-kb.js
//
// KB ACCURACY QA — v2 EXACT-MATCH (2026-09-22): per decision, WALANG
// OpenAI dependency. Ang mga reply ng agents AT bots (mula sa parehong
// ChatwootEvents na pinupuno ng routes/chatwoot.js — ang data din ng
// Customers tab) ay dine-derive-an ng mga KONKRETONG claims na kayang
// i-match nang deretso sa KB text ng brand:
//   1. LINKS — bawat URL/website sa reply na ang host ay WALA kahit saan
//      sa KB ng brand ay fina-flag (maling site / unofficial link).
//   2. AMOUNTS — mga halagang may kontekstong pinansyal (₱100, 20%, 5x, o
//      numerong katabi ng deposit/withdraw/turnover/bonus keywords) na
//      WALA sa KB ay fina-flag bilang "i-verify".
//
// STRICT PER BRAND: replies at KB ay parehong WHERE brand = :brand.
//
// HONEST LIMITATION (basahin!): exact matching ito, hindi pag-unawa.
//   - Kayang hulihin: maling/lumang links, mga amount na wala sa KB.
//   - HINDI kayang hulihin: maling PALIWANAG na walang numbers/links
//     (hal. "hindi na po kailangan ng KYC" — salungat sa KB pero walang
//     ma-ma-match). Posible ring may false positives (hal. amount na
//     galing sa transaksyon mismo ng player). Kaya "I-VERIFY" ang label
//     ng findings, hindi "mali" — ang QA reviewer pa rin ang huhusga,
//     one click away ang buong thread.
//
// WIRING (server.js) — unchanged:
//   app.use('/api/qa', require('./routes/qa-kb'));
// WALANG environment variable na kailangan.

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

// KEEP IN SYNC with AI_BOT_SENDER_NAMES in backend/routes/chatwoot.js.
// Bots are INCLUDED in the scan; the set only tags each row as BOT o AGENT.
const AI_BOT_SENDER_NAMES = new Set([
  'Admin Joy',
  'Admin Love',
  'Agent Jem',
  'Manila Play Admin',
  'Mona',
  'Hype Play PH Admin',
  'Bogchi',
  'Lucky Stacks Admin',
  'Admin May',
  'TMTPlay Admin',
  'Buenas88 Admin',
  'Maya',
]);

function stripHtml(html) {
  if (!html) return html;
  return String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---- URL extraction ----
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+|\b[a-z0-9][a-z0-9-]{1,60}\.(?:com|net|org|ph|vip|asia|online|site|app|io|co|me|bet|casino|link|club|live|pro|xyz)(?:\/[^\s<>"')\]]*)?/gi;
function hostOf(url) {
  let h = String(url).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  h = h.split(/[\/?#]/)[0];
  return h.replace(/[.,!?;:]+$/, '');
}

// ---- Amount extraction ----
// Financial-context keywords: numbers in a reply only get checked when the
// reply talks about money/requirements (para hindi ma-flag ang "wait 5
// minutes" at mga reference numbers sa ordinaryong usapan).
const MONEY_CONTEXT_RE = /(deposit|withdraw|turnover|rollover|bonus|promo|promotion|cash\s*in|cash\s*out|minimum|maximum|\bmin\b|\bmax\b|fee|limit|requirement|free\s*(spin|bet|credit)|ডিপোজিট|উইথড্র|বোনাস|টার্নওভার)/i;
const AMOUNT_RE = /(₱|\bphp\s*)?\b(\d[\d,]*(?:\.\d+)?)\s*(%|x\b|\bphp\b|\bpesos\b)?/gi;
function extractAmountTokens(text) {
  const tokens = [];
  let m;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(text)) !== null) {
    const hasUnit = !!(m[1] || m[3]);
    const core = m[2].replace(/,/g, '');
    const digitsLen = core.replace(/\D/g, '').length;
    if (digitsLen >= 7) continue;                    // ref numbers / phone — skip
    const val = Number(core);
    if (!isFinite(val)) continue;
    if (!hasUnit && (val < 50 || (val >= 1900 && val <= 2099))) continue; // maliit na counts at years — skip
    tokens.push({ display: (m[1] || '') + m[2] + (m[3] ? m[3] : ''), core });
  }
  return tokens;
}

// Numeric cores present anywhere in the KB (commas stripped) — the lookup
// table an agent's amount must land in to pass.
function kbNumberSet(kbText) {
  const set = new Set();
  const re = /\b\d[\d,]*(?:\.\d+)?\b/g;
  let m;
  while ((m = re.exec(kbText)) !== null) set.add(m[0].replace(/,/g, ''));
  return set;
}

// Replies worth checking at all (may factual/financial content o link).
const FACT_HINT_RE = /(\d|%|₱|php|http|www\.|\.com|\.ph|deposit|withdraw|turnover|rollover|bonus|promo|minimum|maximum|fee|limit|requirement|ডিপোজিট|উইথড্র|বোনাস)/i;

// POST /api/qa/kb-accuracy   body: { brand, from, to, sample? }
router.post('/kb-accuracy', requireAuth, async (req, res) => {
  try {
    const brand = String(req.body?.brand || '').trim();
    const from = req.body?.from || null;
    const to = req.body?.to || null;
    if (!brand) return res.status(400).json({ error: 'brand required' });
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const sample = Math.min(Math.max(Number(req.body?.sample) || 500, 10), 2000);

    // 1) The brand's OWN KB — the single source of truth for this scan.
    const kbRows = await sequelize.query(`
      SELECT "title", "content"
      FROM "KnowledgeBaseSections"
      WHERE "brand" = :brand AND "content" IS NOT NULL AND "content" <> ''
      ORDER BY "title" ASC
    `, { replacements: { brand }, type: QueryTypes.SELECT });
    if (!kbRows.length) {
      return res.status(400).json({ error: `Walang naka-sync na KB sections ang brand "${brand}" — i-Import/Sync muna sa Knowledge Base page bago mag-accuracy scan.` });
    }
    const kbText = kbRows.map(r => `### ${r.title}\n${String(r.content)}`).join('\n\n');
    const kbLower = kbText.toLowerCase();
    const kbNums = kbNumberSet(kbText);
    // Hosts mentioned anywhere in the KB — the official links.
    const kbHosts = new Set();
    let hm;
    URL_RE.lastIndex = 0;
    while ((hm = URL_RE.exec(kbText)) !== null) kbHosts.add(hostOf(hm[0]));

    // Section attribution: unang section na may financial keyword na tugma
    // sa reply — best effort lang, para may mabilisang jump-off ang reviewer.
    function guessSection(msgLower) {
      const topics = ['deposit', 'withdraw', 'turnover', 'bonus', 'promo', 'kyc', 'maintenance', 'vip', 'game', 'error', 'account'];
      const hit = topics.find(t => msgLower.includes(t));
      if (!hit) return '';
      const sec = kbRows.find(r => (r.title + ' ' + r.content).toLowerCase().includes(hit));
      return sec ? sec.title : '';
    }

    // 2) Agent + bot replies for the SAME brand, in the window — the same
    //    ChatwootEvents rows the Customers tab is built from.
    const rows = await sequelize.query(`
      SELECT "conversationId", "senderName", "content", "createdAt"
      FROM "ChatwootEvents"
      WHERE event = 'message_created'
        AND "senderType" = 'user'
        AND "isPrivate" = false
        AND "content" IS NOT NULL
        AND "senderName" IS NOT NULL
        AND "brand" = :brand
        AND "createdAt" BETWEEN :from AND :to
      ORDER BY "createdAt" DESC
      LIMIT 5000
    `, { replacements: { brand, from, to }, type: QueryTypes.SELECT });

    let msgs = rows
      .map(r => ({
        conversationId: r.conversationId,
        sender: r.senderName,
        isBot: AI_BOT_SENDER_NAMES.has(r.senderName),
        content: stripHtml(r.content),
        createdAt: r.createdAt,
      }))
      .filter(m => m.content && m.content.length >= 15);
    const totalReplies = msgs.length;
    msgs = msgs.filter(m => FACT_HINT_RE.test(m.content)).slice(0, sample);

    // 3) Deterministic matching — walang AI, walang external calls.
    const flagged = [];
    for (const m of msgs) {
      const findings = [];
      const msgLower = m.content.toLowerCase();

      // 3a. Links na wala sa KB
      URL_RE.lastIndex = 0;
      let um;
      const seenHosts = new Set();
      while ((um = URL_RE.exec(m.content)) !== null) {
        const host = hostOf(um[0]);
        if (!host || host.length < 4 || seenHosts.has(host)) continue;
        seenHosts.add(host);
        if (!kbHosts.has(host) && !kbLower.includes(host)) {
          findings.push(`Link na WALA sa KB: ${host}`);
        }
      }

      // 3b. Amounts na wala sa KB (financial context lang)
      if (MONEY_CONTEXT_RE.test(m.content)) {
        const seenCores = new Set();
        for (const tok of extractAmountTokens(m.content)) {
          if (seenCores.has(tok.core)) continue;
          seenCores.add(tok.core);
          if (!kbNums.has(tok.core)) {
            findings.push(`Amount na wala sa KB: ${tok.display}`);
          }
        }
      }

      if (findings.length) {
        flagged.push({
          conversationId: m.conversationId,
          sender: m.sender,
          isBot: m.isBot,
          content: m.content,
          createdAt: m.createdAt,
          wrong: findings.join(' · ').slice(0, 500),
          correct: 'I-verify vs KB — buksan ang thread at i-compare sa section.',
          section: guessSection(msgLower),
        });
      }
    }

    console.log(`KB accuracy (match) [${brand}]: ${msgs.length} replies checked (of ${totalReplies} total) — ${flagged.length} flagged.`);
    res.json({ brand, scanned: msgs.length, considered: totalReplies, totalReplies, flagged, kbSections: kbRows.length, kbTruncated: false, matcher: 'exact-match-v2' });
  } catch (err) {
    console.error('KB accuracy scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
