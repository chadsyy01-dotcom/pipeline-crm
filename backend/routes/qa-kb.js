// backend/routes/qa-kb.js
//
// KB ACCURACY QA (added 2026-09-22) — checks agent AND bot replies against
// the brand's OWN Knowledge Base using OpenAI, so QA can catch factually
// wrong answers (maling bonus %, maling turnover, maling links, maling
// schedule) na hindi kayang hulihin ng keyword scan.
//
// STRICT PER BRAND: ang replies ng isang brand ay laging kinukumpara LANG
// sa KB ng brand ding yun (WHERE brand = :brand sa parehong query) — hindi
// kailanman ibang brand ang basehan.
//
// WIRING (server.js):
//   app.use('/api/qa', require('./routes/qa-kb'));
//
// RAILWAY VARIABLES:
//   OPENAI_API_KEY   required — the scan errors clearly kapag wala.
//   QA_KB_MODEL      optional — default 'gpt-4o-mini' (mura at sapat dito).
//
// COST CONTROL: by default, only replies that carry FACTUAL claims
// (numbers, %, ₱, links, promo/deposit/withdraw/turnover/KYC keywords) are
// sent to the AI, capped at `sample` (default 150) most recent — greetings
// and small talk can't contradict the KB, kaya sayang lang sa tokens.

const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const QA_KB_MODEL = process.env.QA_KB_MODEL || 'gpt-4o-mini';

// KEEP IN SYNC with AI_BOT_SENDER_NAMES in backend/routes/chatwoot.js.
// Dito, bots are NOT excluded — sinasama sila sa scan (kaya nga "Agent/bot
// checking") — the set is only used to TAG each flagged row as BOT o AGENT.
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

// Replies worth fact-checking: may numbers, pera, links, o KB-topic words.
// Kasama ang ilang Bengali keywords para sa HypePlay BD replies.
const FACT_HINT_RE = /(\d|%|₱|php|http|www\.|bonus|deposit|withdraw|turnover|rollover|cash\s*in|cash\s*out|maintenance|vip|kyc|verify|verification|promo|promotion|free\s*(spin|bet|credit)|minimum|maximum|\bmin\b|\bmax\b|limit|fee|requirement|schedule|website|\bapp\b|apk|register|account|password|otp|бонус|ডিপোজিট|উইথড্র|বোনাস|টার্নওভার)/i;

// POST /api/qa/kb-accuracy   body: { brand, from, to, checkAll?, sample? }
router.post('/kb-accuracy', requireAuth, async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OPENAI_API_KEY is not set on the backend (Railway → Variables). Ito ang gamit ng AI check.' });
    }
    const brand = String(req.body?.brand || '').trim();
    const from = req.body?.from || null;
    const to = req.body?.to || null;
    if (!brand) return res.status(400).json({ error: 'brand required' });
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const checkAll = req.body?.checkAll === true;
    const sample = Math.min(Math.max(Number(req.body?.sample) || 150, 10), 300);

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
    const KB_CHAR_CAP = 70000; // ~17k tokens — safe for gpt-4o-mini's context
    let kbText = '';
    let kbTruncated = false;
    for (const r of kbRows) {
      const block = `### ${r.title}\n${String(r.content).trim()}\n\n`;
      if (kbText.length + block.length > KB_CHAR_CAP) { kbTruncated = true; break; }
      kbText += block;
    }

    // 2) Agent + bot replies for the SAME brand, in the window.
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
      LIMIT 3000
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
    if (!checkAll) msgs = msgs.filter(m => FACT_HINT_RE.test(m.content));
    const considered = msgs.length;
    msgs = msgs.slice(0, sample);

    if (!msgs.length) {
      return res.json({ brand, scanned: 0, considered, totalReplies, flagged: [], kbSections: kbRows.length, kbTruncated, model: QA_KB_MODEL });
    }

    // 3) AI check in batches. temperature 0 + JSON-only contract.
    const BATCH = 25;
    const flagged = [];
    const sys =
      'You are a strict QA checker for a casino customer-support team. ' +
      'Compare each numbered reply against the OFFICIAL KNOWLEDGE BASE provided. ' +
      'Flag ONLY replies that FACTUALLY CONTRADICT the KB: wrong amounts or percentages, ' +
      'wrong requirements (turnover, KYC, minimum/maximum), wrong or unofficial links/websites, ' +
      'wrong schedules, promises the KB does not allow, or policies stated incorrectly. ' +
      'Replies may be in English, Tagalog/Taglish, or Bengali — judge the meaning, not the language. ' +
      'Do NOT flag: greetings, empathy, apologies, questions, things the KB simply does not cover, ' +
      'or paraphrases that keep the same facts. When unsure, do not flag. ' +
      'Respond ONLY with a JSON array, no markdown fences. Each element: ' +
      '{"i": <reply number>, "wrong": "<the incorrect claim, briefly>", ' +
      '"correct": "<what the KB actually says, briefly>", "section": "<KB section title>"}. ' +
      'If nothing contradicts the KB, respond with [].';

    for (let i = 0; i < msgs.length; i += BATCH) {
      const batch = msgs.slice(i, i + BATCH);
      const numbered = batch
        .map((m, j) => `[${j}] (${m.isBot ? 'BOT' : 'AGENT'} ${m.sender}) ${m.content.slice(0, 600)}`)
        .join('\n');
      const user = `OFFICIAL KNOWLEDGE BASE (brand: ${brand}):\n\n${kbText}\n---\nREPLIES TO CHECK:\n${numbered}`;

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: QA_KB_MODEL,
          temperature: 0,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`OpenAI HTTP ${resp.status}: ${t.slice(0, 200)}`);
      }
      const data = await resp.json();
      let text = data.choices?.[0]?.message?.content || '[]';
      text = text.replace(/```json|```/g, '').trim();
      let arr = [];
      try { arr = JSON.parse(text); }
      catch { console.warn('KB accuracy: unparseable AI batch response:', text.slice(0, 200)); }
      for (const f of (Array.isArray(arr) ? arr : [])) {
        const m = batch[Number(f.i)];
        if (!m || !f.wrong) continue;
        flagged.push({
          conversationId: m.conversationId,
          sender: m.sender,
          isBot: m.isBot,
          content: m.content,
          createdAt: m.createdAt,
          wrong: String(f.wrong).slice(0, 500),
          correct: String(f.correct || '').slice(0, 500),
          section: String(f.section || '').slice(0, 120),
        });
      }
    }

    console.log(`KB accuracy [${brand}]: ${msgs.length} replies AI-checked (of ${considered} factual / ${totalReplies} total) — ${flagged.length} flagged.`);
    res.json({ brand, scanned: msgs.length, considered, totalReplies, flagged, kbSections: kbRows.length, kbTruncated, model: QA_KB_MODEL });
  } catch (err) {
    console.error('KB accuracy scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
