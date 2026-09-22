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

// HARD RESTRICT (2026-09-22, per QA review): ticket-status replies are
// DISREGARDED entirely — a reply carrying a Ticket/Reference ID (hal.
// "BPH-20260922-67358") ay tungkol sa isang partikular na ticket, at lahat
// ng numero doon (ticket no., timeframes, atbp.) ay hindi KB facts.
const TICKET_ID_RE = /\b[A-Z]{2,5}[-_ ]?\d{6,8}[-_ ]?\d{3,6}\b/;

// Player-transactional context: kapag ang reply ay tungkol sa SARILING
// balance/bets/wagering ng player ("your balance is ₱1,300.43", "you still
// need to bet 55,740"), ang mga amount doon ay computed per player — hindi
// KB facts — kaya nilalaktawan ang amount check (links chine-check pa rin).
// (pinalawak 2026-09-22 pt.2 — mula sa aktwal na false positives: ang
// bot ay nagde-describe ng transaksyon ng player mula sa screenshot/
// system, kaya wala ang amounts sa TEXT ng player at hindi sila nahuhuli
// ng relay check. Ang wording mismo ng reply ang nagsasabing transaksyon
// ito, hindi KB policy.)
const PLAYER_TXN_RE = /(balance|wager|wagering|you still need|kailangan (mo|nyo|niyo) pang?|nag[- ]?avail|na[- ]?avail|your account|iyong (balance|account)|winnings|panalo mo|total bets?|na[- ]?deposit mo|na[- ]?withdraw mo|your (withdrawal|deposit|payment|transaction|request)|(withdrawal|deposit|payment|transaction)s?\s+(of|for|records?|request)|successful (withdrawal|deposit|payment|cash\s*out|cash\s*in|transaction)|payment notification|reference (number|no\.?)|processed (at|on)|you have (a |an |two |\d)|you received|natanggap (mo|nyo|niyo|na)|na[- ]?receive|currently ("|&quot;)?(processing|transferring|pending|on[- ]?hold)|("|&quot;)?transferring("|&quot;)?,?\s|remaining turnover|left to meet|natitirang? (turnover|balanse|requirement)|meron (ka|kayo|po kayo) pang|(your|iyong|inyong)\s+(php\s*|\u20b1)?\d|cancellation of your|you (had|got|won)\b|\bwin of\b|nanalo (ka|kayo|po)|panalo (mo|nyo|niyo))/i;

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
    // Two-pass (2026-09-22): (1) collect candidate findings; (2) RELAY
    // CHECK — kung ang amount ay BINANGGIT DIN NG PLAYER sa parehong
    // conversation, ang agent ay nag-relay/umulit lang ng numero ng player
    // (hal. inulit ang balance o hiniling na halaga) — hindi ito KB claim,
    // kaya dini-drop ang finding.
    let skippedTickets = 0;
    const candidates = [];
    for (const m of msgs) {
      // HARD RESTRICT: ticket-status reply → disregard nang buo.
      if (TICKET_ID_RE.test(m.content)) { skippedTickets++; continue; }
      const findings = [];

      // 3a. Links na wala sa KB
      URL_RE.lastIndex = 0;
      let um;
      const seenHosts = new Set();
      while ((um = URL_RE.exec(m.content)) !== null) {
        const host = hostOf(um[0]);
        if (!host || host.length < 4 || seenHosts.has(host)) continue;
        seenHosts.add(host);
        if (!kbHosts.has(host) && !kbLower.includes(host)) {
          findings.push({ text: `Link na WALA sa KB: ${host}` });
        }
      }

      // 3b. Amounts na wala sa KB (financial context lang; nilalaktawan
      //     ang mga reply tungkol sa sariling balance/bets ng player)
      if (MONEY_CONTEXT_RE.test(m.content) && !PLAYER_TXN_RE.test(m.content)) {
        const seenCores = new Set();
        for (const tok of extractAmountTokens(m.content)) {
          if (seenCores.has(tok.core)) continue;
          seenCores.add(tok.core);
          // May sentimo (hal. 5000.44): laging transactional na figure
          // (balance/winnings/na-compute) — hindi kailanman KB fact — skip.
          if (/\.\d*[1-9]/.test(tok.core)) continue;
          if (!kbNums.has(tok.core)) {
            findings.push({ text: `Amount na wala sa KB: ${tok.display}`, core: tok.core });
          }
        }
      }

      if (findings.length) candidates.push({ m, findings });
    }

    // RELAY CHECK: kunin ang mga mensahe ng PLAYER (senderType='contact')
    // sa mga apektadong conversation lang; kung lumalabas doon ang
    // parehong numero, relay lang ito — drop.
    const amountConvIds = [...new Set(candidates
      .filter(c => c.findings.some(f => f.core))
      .map(c => c.m.conversationId)
      .filter(Boolean))];
    const playerCores = new Map();
    if (amountConvIds.length) {
      const custRows = await sequelize.query(`
        SELECT "conversationId", "content"
        FROM "ChatwootEvents"
        WHERE event = 'message_created'
          AND "senderType" = 'contact'
          AND "content" IS NOT NULL
          AND "brand" = :brand
          AND "conversationId" IN (:amountConvIds)
        LIMIT 8000
      `, { replacements: { brand, amountConvIds }, type: QueryTypes.SELECT });
      for (const r of custRows) {
        const set = playerCores.get(r.conversationId) || new Set();
        const txt = stripHtml(r.content) || '';
        const re = /\b\d[\d,]*(?:\.\d+)?\b/g;
        let nm;
        while ((nm = re.exec(txt)) !== null) set.add(nm[0].replace(/,/g, ''));
        playerCores.set(r.conversationId, set);
      }
    }

    const flagged = [];
    let relayDropped = 0;
    for (const c of candidates) {
      const custSet = playerCores.get(c.m.conversationId);
      const kept = c.findings.filter(f => {
        if (f.core && custSet && custSet.has(f.core)) { relayDropped++; return false; }
        return true;
      });
      if (!kept.length) continue;
      flagged.push({
        conversationId: c.m.conversationId,
        sender: c.m.sender,
        isBot: c.m.isBot,
        content: c.m.content,
        createdAt: c.m.createdAt,
        wrong: kept.map(f => f.text).join(' \u00B7 ').slice(0, 500),
        correct: 'I-verify vs KB \u2014 buksan ang thread at i-compare sa section.',
        section: guessSection(c.m.content.toLowerCase()),
      });
    }

    console.log(`KB accuracy (match) [${brand}]: ${msgs.length} replies checked (of ${totalReplies} total, ${skippedTickets} ticket replies disregarded, ${relayDropped} player-relayed amounts dropped) — ${flagged.length} flagged.`);
    res.json({ brand, scanned: msgs.length - skippedTickets, considered: totalReplies, totalReplies, skippedTickets, flagged, kbSections: kbRows.length, kbTruncated: false, matcher: 'exact-match-v4' });
  } catch (err) {
    console.error('KB accuracy scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
