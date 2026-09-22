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
// CLAIM CONTEXT (hinigpitan 2026-09-22 pt.4, per QA direction): ang
// amount check ay tumatakbo LANG kapag ang reply ay POLICY/PROMO CLAIM —
// promo mechanics, required deposit, min/max, multiplier, turnover,
// exclusivity, eligibility. Hindi na sapat ang basta may salitang
// "deposit" — dapat requirement/promo language talaga.
const CLAIM_CONTEXT_RE = /(promo(tion)?s?\b|bonus|free\s*(spin|bet|credit)|reload|cashback|welcome|minimum|maximum|\bmin\b|\bmax\b|requirements?|required?\b|kailangan(g|in)?\b|turnover|rollover|wagering?|multiplier|\b\d+\s*x\b|\bx\s*\d+\b|exclusive|valid\s+(for|sa|until|hanggang)|eligible|qualif(y|ied|ication)|বোনাস|টার্নওভার)/i;

// GAME PROVIDERS master vocabulary (2026-09-22): kapag ang promo/claim
// reply ay may binanggit na provider na WALA sa KB ng brand, flag —
// posibleng mali ang sinabing saklaw ng promo (hal. "valid sa JILI slots"
// pero PG Soft lang ang nasa KB). Distinct multi-char names lang para
// walang aksidenteng tama sa ordinaryong salita.
const GAME_PROVIDERS = ['CQ9','JILI','JDB','FACHAI','FA CHAI','PG SOFT','PGSOFT','SPADE GAMING','SPADEGAMING','HABANERO','PRAGMATIC PLAY','PRAGMATIC','EVOLUTION GAMING','EVOLUTION','MICROGAMING','NEXTSPIN','NOLIMIT CITY','NO LIMIT CITY','PLAYSTAR','RICH88','ASKMEBET','EZUGI','BOONGO','YGGDRASIL','RED TIGER','NETENT','TADA GAMING','TADA','KA GAMING','SA GAMING','WM CASINO','DREAM GAMING','AE SEXY','YELLOW BAT','YGR'];
const PROVIDER_RES = GAME_PROVIDERS.map(pv => ({ name: pv, re: new RegExp('\\b' + pv.replace(/\s+/g, '\\s+') + '\\b', 'i') }));

// COMPUTATION CHECK (2026-09-22): kapag ang reply ay may mismong
// kalkulasyon ("20 x 10 = 200", "10% of 5,000 = 500"), vine-verify ang
// arithmetic mismo — maling computation ay laging mali, KB man o hindi.
const MATH_MUL_RE = /(\d[\d,]*(?:\.\d+)?)\s*[x\u00d7\*]\s*(\d[\d,]*(?:\.\d+)?)\s*=\s*(\d[\d,]*(?:\.\d+)?)/gi;
const MATH_PCT_RE = /(\d[\d,]*(?:\.\d+)?)\s*%\s*(?:of|ng)\s*(\d[\d,]*(?:\.\d+)?)\s*=\s*(\d[\d,]*(?:\.\d+)?)/gi;
const numOf = t => Number(String(t).replace(/,/g, ''));
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

// Numeric cores present anywhere in the KB (commas stripped) — fallback
// lookup para sa mga claim na walang malinaw na topic.
function kbNumberSet(kbText) {
  const set = new Set();
  const re = /\b\d[\d,]*(?:\.\d+)?\b/g;
  let m;
  while ((m = re.exec(kbText)) !== null) set.add(m[0].replace(/,/g, ''));
  return set;
}

// TOPIC-SCOPED matching (2026-09-22 pt.3, after the "minimum deposit ay 50"
// test na nakalusot): hindi sapat na ang numero ay nasa KB KAHIT SAAN —
// ang "50" ng ibang section (50 free spins, 50% promo) ay hindi dapat
// makapag-validate ng maling minimum deposit. Kada topic, kinukuha LANG
// ang mga numerong nasa loob ng ±250 chars ng mga banggit ng topic
// keyword sa KB; ang claim tungkol sa topic na yun ay dapat tumama DOON.
const AMOUNT_TOPICS = [
  { key: 'deposit',  re: /(deposit|cash\s*in|\u09a1\u09bf\u09aa\u09cb\u099c\u09bf\u099f)/i },
  { key: 'withdraw', re: /(withdraw|cash\s*out|payout|\u0989\u0987\u09a5\u09a1\u09cd\u09b0)/i },
  { key: 'turnover', re: /(turnover|rollover|wagering?|\u099f\u09be\u09b0\u09cd\u09a8\u0993\u09ad\u09be\u09b0)/i },
  { key: 'bonus',    re: /(bonus|promo(tion)?|free\s*(spin|bet|credit)|reload|cashback|\u09ac\u09cb\u09a8\u09be\u09b8)/i },
];
function topicNumberSets(kbText) {
  const sets = {};
  const numRe = /\b\d[\d,]*(?:\.\d+)?\b/g;
  for (const t of AMOUNT_TOPICS) {
    const set = new Set();
    const re = new RegExp(t.re.source, 'gi');
    let m;
    while ((m = re.exec(kbText)) !== null) {
      const win = kbText.slice(Math.max(0, m.index - 250), Math.min(kbText.length, m.index + 250));
      numRe.lastIndex = 0;
      let nm;
      while ((nm = numRe.exec(win)) !== null) set.add(nm[0].replace(/,/g, ''));
    }
    sets[t.key] = set;
  }
  return sets;
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

// ---------------------------------------------------------------------------
// SHARED ENGINE (refactor 2026-09-22): iisang analyzeReply() ang ginagamit
// ng buong scan AT ng single-reply test endpoint sa ibaba — kung ano ang
// hatol sa test, yun din ang hatol ng scan sa parehong reply.
// ---------------------------------------------------------------------------

async function loadKbCtx(brand) {
  const kbRows = await sequelize.query(`
    SELECT "title", "content"
    FROM "KnowledgeBaseSections"
    WHERE "brand" = :brand AND "content" IS NOT NULL AND "content" <> ''
    ORDER BY "title" ASC
  `, { replacements: { brand }, type: QueryTypes.SELECT });
  if (!kbRows.length) return null;
  const kbText = kbRows.map(r => `### ${r.title}\n${String(r.content)}`).join('\n\n');
  const kbLower = kbText.toLowerCase();
  const kbHosts = new Set();
  URL_RE.lastIndex = 0;
  let hm;
  while ((hm = URL_RE.exec(kbText)) !== null) kbHosts.add(hostOf(hm[0]));
  return { kbRows, kbText, kbLower, kbNums: kbNumberSet(kbText), kbTopicNums: topicNumberSets(kbText), kbHosts };
}

// Section attribution — best-effort jump-off para sa reviewer.
function guessSection(ctx, msgLower) {
  const topics = ['deposit', 'withdraw', 'turnover', 'bonus', 'promo', 'kyc', 'maintenance', 'vip', 'game', 'error', 'account'];
  const hit = topics.find(t => msgLower.includes(t));
  if (!hit) return '';
  const sec = ctx.kbRows.find(r => (r.title + ' ' + r.content).toLowerCase().includes(hit));
  return sec ? sec.title : '';
}

// Para sa test tool: SAAN sa KB tumama ang numero — ipinapakita ang mismong
// KB snippet na nag-validate, para makita agad kung tama nga o KB ang mali.
function findKbSnippet(ctx, core, topicKeys) {
  const coreRe = new RegExp('\\b' + core.replace(/\./g, '\\.') + '\\b');
  const clean = x => x.replace(/\s+/g, ' ').trim();
  if (topicKeys && topicKeys.length) {
    for (const key of topicKeys) {
      const topic = AMOUNT_TOPICS.find(t => t.key === key);
      if (!topic) continue;
      const re = new RegExp(topic.re.source, 'gi');
      let m;
      while ((m = re.exec(ctx.kbText)) !== null) {
        const win = ctx.kbText.slice(Math.max(0, m.index - 250), Math.min(ctx.kbText.length, m.index + 250));
        const hit = coreRe.exec(win);
        if (hit) return { topic: key, snippet: clean(win.slice(Math.max(0, hit.index - 80), hit.index + 90)) };
      }
    }
    return null;
  }
  const hit = coreRe.exec(ctx.kbText);
  if (!hit) return null;
  return { topic: null, snippet: clean(ctx.kbText.slice(Math.max(0, hit.index - 80), hit.index + 90)) };
}

// Ang iisang hatulan para sa isang reply. trace=true → detalyadong "bakit".
function analyzeReply(content, ctx, trace) {
  const t = trace ? { ticket: false, claimContext: false, playerTxn: null, links: [], amounts: [], math: [], providers: [] } : null;
  if (TICKET_ID_RE.test(content)) {
    if (t) t.ticket = true;
    return { skippedBy: 'ticket', findings: [], trace: t };
  }
  const findings = [];
  const claimCtx = CLAIM_CONTEXT_RE.test(content);
  const txnMatch = content.match(PLAYER_TXN_RE);
  if (t) { t.claimContext = claimCtx; t.playerTxn = txnMatch ? txnMatch[0] : null; }

  // 3a. Links na wala sa KB
  URL_RE.lastIndex = 0;
  let um;
  const seenHosts = new Set();
  while ((um = URL_RE.exec(content)) !== null) {
    const host = hostOf(um[0]);
    if (!host || host.length < 4 || seenHosts.has(host)) continue;
    seenHosts.add(host);
    const inKb = ctx.kbHosts.has(host) || ctx.kbLower.includes(host);
    if (t) t.links.push({ host, inKb });
    if (!inKb) findings.push({ text: `Link na WALA sa KB: ${host}` });
  }

  // 3b. Amounts na wala sa KB — claim context lang, hindi transactional,
  //     TOPIC-SCOPED sa deposit/withdraw/turnover/bonus.
  if (claimCtx && !txnMatch) {
    const replyTopics = AMOUNT_TOPICS.filter(tp => tp.re.test(content));
    const topicKeys = replyTopics.map(tp => tp.key);
    let allowed = ctx.kbNums;
    let topicLabel = '';
    if (replyTopics.length) {
      allowed = new Set();
      for (const tp of replyTopics) for (const n of ctx.kbTopicNums[tp.key]) allowed.add(n);
      topicLabel = ` (${topicKeys.join('/')})`;
    }
    const seenCores = new Set();
    for (const tok of extractAmountTokens(content)) {
      if (seenCores.has(tok.core)) continue;
      seenCores.add(tok.core);
      // May sentimo (hal. 5000.44): transactional figure — skip.
      if (/\.\d*[1-9]/.test(tok.core)) { if (t) t.amounts.push({ token: tok.display, verdict: 'skipped-centavo' }); continue; }
      if (!allowed.has(tok.core)) {
        if (t) t.amounts.push({ token: tok.display, verdict: 'FLAGGED', topics: topicKeys });
        findings.push({ text: `Amount na wala sa KB${topicLabel}: ${tok.display}`, core: tok.core });
      } else if (t) {
        t.amounts.push({ token: tok.display, verdict: 'pasado', topics: topicKeys, kbMatch: findKbSnippet(ctx, tok.core, topicKeys) });
      }
    }
  }

  // 3c. COMPUTATION CHECK — laging tumatakbo: maling arithmetic ay mali.
  for (const pair of [[MATH_MUL_RE, 'mul'], [MATH_PCT_RE, 'pct']]) {
    const re = pair[0], kind = pair[1];
    re.lastIndex = 0;
    let mm;
    while ((mm = re.exec(content)) !== null) {
      const a = numOf(mm[1]), b = numOf(mm[2]), c = numOf(mm[3]);
      if (!isFinite(a) || !isFinite(b) || !isFinite(c)) continue;
      const expect = kind === 'mul' ? a * b : (a / 100) * b;
      const okMath = Math.abs(expect - c) <= 0.01;
      if (t) t.math.push({ expr: mm[0].trim(), ok: okMath });
      if (!okMath) findings.push({ text: `MALING COMPUTATION: ${mm[0].trim()} (dapat ${expect.toLocaleString()})` });
    }
  }

  // 3d. GAME PROVIDER CHECK — sa promo/claim context lang.
  if (claimCtx) {
    for (const pv of PROVIDER_RES) {
      if (!pv.re.test(content)) continue;
      const needle = pv.name.toLowerCase();
      const inKb = ctx.kbLower.includes(needle) || ctx.kbLower.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''));
      if (t) t.providers.push({ name: pv.name, inKb });
      if (!inKb) findings.push({ text: `Game provider na wala sa KB: ${pv.name}` });
    }
  }

  return { skippedBy: null, findings, trace: t };
}

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
    const ctx = await loadKbCtx(brand);
    if (!ctx) {
      return res.status(400).json({ error: `Walang naka-sync na KB sections ang brand "${brand}" — i-Import/Sync muna sa Knowledge Base page bago mag-accuracy scan.` });
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

    // 3) Iisang engine kada reply.
    let skippedTickets = 0;
    const candidates = [];
    for (const m of msgs) {
      const r = analyzeReply(m.content, ctx, false);
      if (r.skippedBy === 'ticket') { skippedTickets++; continue; }
      if (r.findings.length) candidates.push({ m, findings: r.findings });
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
        section: guessSection(ctx, c.m.content.toLowerCase()),
      });
    }

    console.log(`KB accuracy (match) [${brand}]: ${msgs.length} replies checked (of ${totalReplies} total, ${skippedTickets} ticket replies disregarded, ${relayDropped} player-relayed amounts dropped) — ${flagged.length} flagged.`);
    res.json({ brand, scanned: msgs.length - skippedTickets, considered: totalReplies, totalReplies, skippedTickets, flagged, kbSections: ctx.kbRows.length, kbTruncated: false, matcher: 'exact-match-v7' });
  } catch (err) {
    console.error('KB accuracy scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 🧪 SINGLE-REPLY TEST — POST /api/qa/kb-accuracy/test { brand, text }
// Sinasagot ang "bakit hindi na-flag / bakit na-flag?" para sa isang
// partikular na reply, gamit ang EKSAKTONG parehong engine ng scan, na may
// buong trace: aling guard ang lumaktaw, o aling KB snippet ang tumama.
router.post('/kb-accuracy/test', requireAuth, async (req, res) => {
  try {
    const brand = String(req.body?.brand || '').trim();
    const text = (stripHtml(String(req.body?.text || '')) || '').trim();
    if (!brand || !text) return res.status(400).json({ error: 'brand at text required' });
    const ctx = await loadKbCtx(brand);
    if (!ctx) return res.status(400).json({ error: `Walang naka-sync na KB sections ang brand "${brand}".` });
    const r = analyzeReply(text, ctx, true);
    res.json({
      brand,
      verdict: r.skippedBy ? 'SKIPPED' : (r.findings.length ? 'FLAGGED' : 'PASADO'),
      skippedBy: r.skippedBy,
      findings: r.findings.map(f => f.text),
      trace: r.trace,
      note: 'Sa buong scan, may dagdag pang RELAY CHECK (amounts na binanggit ng player sa parehong conversation ay dini-drop) na wala dito dahil walang kasamang conversation.',
    });
  } catch (err) {
    console.error('KB accuracy test error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
