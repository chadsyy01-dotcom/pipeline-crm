// backend/routes/livechat.js
//
// LiveChat.com (Text Inc.) webhook receiver — the LiveChat counterpart of
// routes/chatwoot.js. LiveChat PUSHES events here; we normalize each one
// into the SAME `ChatwootEvents` table and the SAME event names the
// dashboard already understands (conversation_created, message_created,
// conversation_status_changed, conversation_updated, message_updated-with-
// CSAT), so the Customers page, CSAT/DSAT cards, First Reply Time and
// Chatting Time all work for LiveChat brands with no frontend changes
// beyond a BRAND_LABELS entry.
//
// SETUP (done 2026-09-13 — see Project Knowledge):
//   Text Platform Developer Console -> app "CSR Dashboard Webhooks"
//     - App Authorization block (server-side), scopes: chats--all:ro,
//       agents--all:ro, reports_read, webhooks_manage
//     - 5x Chat Webhooks (type: License), all pointing at
//         https://<railway>/api/livechat/webhook/main
//       one per trigger: incoming_chat, incoming_event, chat_deactivated,
//       thread_properties_updated, user_added_to_chat
//       (all with "chat_properties" additional data, same secret key)
//     - Private installation on the license (activates the webhooks)
//
// SETUP (Railway -> Variables):
//   LIVECHAT_WEBHOOK_SECRET   the secret key generated in the Chat Webhooks
//                             block. LiveChat sends it back in every payload
//                             as `secret_key`; deliveries that don't match
//                             are rejected. Required (no "accept everything"
//                             fallback — unlike Chatwoot, the mechanism here
//                             is reliable).
//   LIVECHAT_DOMAIN_MAP       optional JSON: { "<hostname substring>": "<brand-slug>" }
//                             e.g. {"casinyeam":"casinyeam","manilacasino":"manilacasino",
//                                   "superscatter":"superscatterph"}
//                             PRIMARY brand source: the site the customer
//                             chatted from (customer.last_visit.last_pages).
//                             Defaults for the 3 known brands are built in.
//   LIVECHAT_GROUP_MAP        (legacy, no longer used for brand attribution —
//                             groups don't decide the brand any more; see
//                             resolveBrand). Safe to leave unset.
//
// KEY DIFFERENCES FROM CHATWOOT (and how they're handled):
//   - One LiveChat license serving several sites. The :brand URL param is
//     just "main"; the real brand is resolved on incoming_chat from the
//     DOMAIN the customer chatted from (customer.last_visit.last_pages),
//     falling back to the LiveChat group id — and is then remembered per
//     conversation for all later events (which don't carry either).
//   - Chat/event IDs are strings ("PJ0MRSHTDG"), but ChatwootEvents.
//     conversationId / messageId are integers. We derive a stable positive
//     32-bit integer from the string (FNV-1a) in the 2,000,000,000+ range so
//     they can never collide with Chatwoot's own ids. The original string id
//     is kept in the stored payload as `lc_chat_id` / `lc_event_id`.
//   - Rating is Good/Bad (thumbs), not 1-5. Mapped: good -> 5 (CSAT),
//     bad -> 1 (DSAT). Arrives via thread_properties_updated with a
//     `rating` property; stored as a message_updated row with csatRating,
//     exactly like Chatwoot's CSAT rows, so /csat needs no change.
//   - No AI bot on LiveChat: every chat is human-handled. We therefore set
//     handoffStage 'opened' on the first agent message and 'closed' on
//     chat_deactivated, which makes the existing First Reply Time /
//     Chatting Time computation run for every LiveChat chat. (Those chats
//     will also appear under the HH tabs — expected, since they ARE human-
//     handled end to end.)
//   - Agents are identified by email (author_id). LIVECHAT_AGENTS maps
//     those to display names; unmapped emails are shown as-is.
//
// DEBUG LOGGING (added 2026-09-14): every delivery now logs its action and
// chat id on arrival, ignored deliveries log WHY they were ignored, and
// stored deliveries log the row count + brand. Grep Railway logs for
// "LiveChat webhook" while sending a test chat to trace the full path.

const express = require('express');
const router = express.Router();
const { ChatwootEvent, sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const WEBHOOK_SECRET = process.env.LIVECHAT_WEBHOOK_SECRET || '';

// group_id -> brand slug. Override/extend via LIVECHAT_GROUP_MAP env var.
// Fill in real ids once known (LiveChat -> Team -> Groups -> click group ->
// id is in the URL). General is always 0.
const DEFAULT_GROUP_MAP = {
  '0': 'livechat-general',
};
let GROUP_MAP = { ...DEFAULT_GROUP_MAP };
try {
  if (process.env.LIVECHAT_GROUP_MAP) {
    GROUP_MAP = { ...GROUP_MAP, ...JSON.parse(process.env.LIVECHAT_GROUP_MAP) };
  }
} catch (e) {
  console.error('LiveChat: LIVECHAT_GROUP_MAP is not valid JSON — using defaults.', e.message);
}

// agent email -> display name (from LiveChat -> Team -> Agents, 2026-09-13)
const LIVECHAT_AGENTS = {
  'josonkylamae8@gmail.com': 'Admin - Eve',
  'ruzzversace@gmail.com': 'Admin - Jen',
  'nacionaleskiven5@gmail.com': 'Admin - Jace',
  'arandajamescharles@gmail.com': 'Admin - Barbie',
  'teambravocsr@fhbpo.com': 'Admin - Astrid',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Stable string -> positive int32 in [2_000_000_000, 2_147_000_000).
// FNV-1a 32-bit; the offset keeps LiveChat ids well clear of Chatwoot's
// auto-increment ids (which are ~150k as of Sep 2026).
function stableIntId(str) {
  if (!str) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 2_000_000_000 + ((h >>> 0) % 147_000_000);
}

function brandForGroup(groupId) {
  const key = String(groupId ?? '0');
  return GROUP_MAP[key] || `livechat-group-${key}`;
}

// Domain -> brand. Matched as a case-insensitive SUBSTRING of the hostname,
// so "www.casinyeam.com", "casinyeam.ph" and "m.casinyeam.vip" all map to
// the same brand. Override/extend via LIVECHAT_DOMAIN_MAP env var (JSON:
// { "<substring>": "<brand-slug>" }). Checked in insertion order; put more
// specific substrings first if two could overlap.
const DEFAULT_DOMAIN_MAP = {
  'casinyeam': 'casinyeam',
  'manilacasino': 'manilacasino',
  'superscatter': 'superscatterph',
  'supperscatter': 'superscatterph',
  'ssph': 'superscatterph',
};
let DOMAIN_MAP = { ...DEFAULT_DOMAIN_MAP };
try {
  if (process.env.LIVECHAT_DOMAIN_MAP) {
    DOMAIN_MAP = { ...JSON.parse(process.env.LIVECHAT_DOMAIN_MAP), ...DOMAIN_MAP };
  }
} catch (e) {
  console.error('LiveChat: LIVECHAT_DOMAIN_MAP is not valid JSON — using defaults.', e.message);
}

// Pull the hostname the customer was chatting from. LiveChat puts the pages
// the visitor browsed on the customer object (last_visit.last_pages) and the
// referrer on last_visit.referrer; the chat widget's own url is sometimes on
// session_fields. Returns null if nothing usable is present.
function customerHost(customer) {
  const candidates = [];
  const lv = customer?.last_visit || {};
  for (const pg of lv.last_pages || []) if (pg?.url) candidates.push(pg.url);
  if (lv.referrer) candidates.push(lv.referrer);
  for (const sf of customer?.session_fields || []) {
    for (const v of Object.values(sf || {})) if (typeof v === 'string' && /^https?:\/\//i.test(v)) candidates.push(v);
  }
  for (const url of candidates) {
    try { return new URL(url).hostname.toLowerCase(); } catch { /* not a url */ }
  }
  return null;
}

function brandForHost(host) {
  if (!host) return null;
  for (const [needle, slug] of Object.entries(DOMAIN_MAP)) {
    if (host.includes(needle.toLowerCase())) return slug;
  }
  return null;
}

// Brand rule (confirmed 2026-09-14): the ORIGINATING DOMAIN decides the
// brand. Anything that can't be identified from a known domain — no page
// URL in the payload, an unrecognised host, a chat started from somewhere
// other than a brand site — goes to LC General. LiveChat groups are NOT
// used for brand attribution (kept only as inboxId metadata).
const GENERAL_BRAND = 'livechat-general';
function resolveBrand(customer, groupId) {
  const host = customerHost(customer);
  return { brand: brandForHost(host) || GENERAL_BRAND, host };
}

function agentDisplayName(authorId) {
  return LIVECHAT_AGENTS[authorId] || authorId || null;
}

// LiveChat author_id: agents are emails, customers are UUIDs.
function senderTypeFor(authorId) {
  if (!authorId) return null;
  return authorId.includes('@') ? 'user' : 'contact';
}

// LiveChat message text may be plain; keep a light strip for safety.
function cleanText(t) {
  if (!t) return null;
  return String(t).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || null;
}

// ---------------------------------------------------------------------------
// Auto-greeting detection (added 2026-09-14)
//
// The OpenWidget/LiveChat setup sends an automatic welcome message UNDER AN
// AGENT IDENTITY the moment a chat starts (e.g. "Hi, Welcome to your 24/7
// Support."). Without this filter, every chat instantly counts as "agent
// replied", which (a) makes the Waiting-for-Agent / HH Pending widgets
// permanently zero and (b) fakes the First Reply Time (~22s = greeting
// speed, not human speed).
//
// Messages matching a greeting pattern are STILL STORED (so the transcript
// is complete) but do NOT set handoffStage 'opened' — the first REAL human
// reply does. Patterns are case-insensitive substrings of the cleaned text.
// Override/extend via LIVECHAT_GREETING_PATTERNS env var (JSON array of
// strings), e.g. ["welcome to your 24/7 support","kumusta! paano kami"].
// ---------------------------------------------------------------------------
const DEFAULT_GREETING_PATTERNS = [
  'welcome to your 24/7 support',
];
let GREETING_PATTERNS = [...DEFAULT_GREETING_PATTERNS];
try {
  if (process.env.LIVECHAT_GREETING_PATTERNS) {
    const extra = JSON.parse(process.env.LIVECHAT_GREETING_PATTERNS);
    if (Array.isArray(extra)) GREETING_PATTERNS = [...new Set([...GREETING_PATTERNS, ...extra.map(s => String(s))])];
  }
} catch (e) {
  console.error('LiveChat: LIVECHAT_GREETING_PATTERNS is not valid JSON array — using defaults.', e.message);
}

function isAutoGreeting(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return GREETING_PATTERNS.some(p => t.includes(p.toLowerCase()));
}

// The brand is only known on incoming_chat (chat.access.group_ids). For all
// later events on that chat, look it up from what we already stored.
async function lookupBrand(conversationId) {
  const rows = await sequelize.query(`
    SELECT "brand", "contactName", "contactEmail", "inboxName"
    FROM "ChatwootEvents"
    WHERE "conversationId" = :conversationId AND "inboxName" LIKE 'LiveChat%'
    ORDER BY "createdAt" ASC
    LIMIT 1
  `, { replacements: { conversationId }, type: QueryTypes.SELECT });
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Normalizers — each returns { rows: [ {...ChatwootEvent fields} ] } or null
// to ignore the delivery. When ignoring, log the reason so silent drops are
// visible in Railway logs (added 2026-09-14).
// ---------------------------------------------------------------------------

async function normalize(body) {
  const action = body.action;
  const p = body.payload || {};
  const now = new Date();

  if (action === 'incoming_chat') {
    const chat = p.chat || {};
    const thread = chat.thread || {};
    const groupId = (thread.access?.group_ids || chat.access?.group_ids || [0])[0];
    const customer = (chat.users || []).find(u => u.type === 'customer') || {};
    const { brand, host } = resolveBrand(customer, groupId);
    const conversationId = stableIntId(chat.id);
    const base = {
      brand,
      conversationId,
      inboxId: Number(groupId) || 0,
      // "LiveChat · <host>" when the domain is known, else the group — the
      // prefix is what lookupBrand() keys on, so keep it.
      inboxName: host ? `LiveChat · ${host}` : `LiveChat · group ${groupId}`,
      contactName: customer.name || null,
      contactEmail: customer.email || null,
      status: 'open',
      isPrivate: false,
    };
    const rows = [{
      ...base,
      event: 'conversation_created',
      // 'pending' (added 2026-09-14): every LiveChat chat is human-handled
      // from the start, so the chat's creation IS its handoff moment. This
      // puts it in Waiting-for-Agent / HH Pending until a REAL human reply
      // sets 'opened' (auto-greetings excluded — see isAutoGreeting). If the
      // dashboard's waiting query expects a different stage value than
      // 'pending', adjust here to match.
      handoffStage: 'pending',
      payload: { source: 'livechat', action, lc_chat_id: chat.id, lc_thread_id: thread.id, group_id: groupId, host, customer: { id: customer.id, name: customer.name, email: customer.email } },
    }];
    // Initial events that came with the chat (e.g. the customer's first message).
    for (const ev of thread.events || []) {
      if (ev.type !== 'message' || !ev.text) continue;
      const st = senderTypeFor(ev.author_id);
      const content = cleanText(ev.text);
      // Auto-greeting (2026-09-14): stored, but never counts as the agent's
      // first reply — see isAutoGreeting().
      const greeting = st === 'user' && isAutoGreeting(content);
      if (greeting) console.log(`LiveChat webhook: auto-greeting detected (incoming_chat) chat=${chat.id} — not counted as agent reply`);
      rows.push({
        ...base,
        event: 'message_created',
        messageId: stableIntId(ev.id),
        content,
        senderName: st === 'user' ? agentDisplayName(ev.author_id) : (customer.name || null),
        senderType: st,
        handoffStage: st === 'user' && !greeting ? 'opened' : null,
        payload: { source: 'livechat', action, lc_chat_id: chat.id, lc_event_id: ev.id, author_id: ev.author_id, created_at: ev.created_at, auto_greeting: greeting || undefined },
      });
    }
    return rows;
  }

  if (action === 'incoming_event') {
    const ev = p.event || {};
    if (ev.type !== 'message' || !ev.text) {
      // DEBUG (2026-09-14): visible instead of silent
      console.log(`LiveChat webhook: ignoring incoming_event (type=${ev.type || '?'}, hasText=${!!ev.text}) chat=${p.chat_id || '?'}`);
      return null; // ignore system/rich/form events
    }
    const conversationId = stableIntId(p.chat_id);
    const known = await lookupBrand(conversationId);
    const st = senderTypeFor(ev.author_id);
    const content = cleanText(ev.text);
    // Auto-greeting (2026-09-14): stored, but never counts as the agent's
    // first reply — see isAutoGreeting().
    const greeting = st === 'user' && isAutoGreeting(content);
    if (greeting) console.log(`LiveChat webhook: auto-greeting detected (incoming_event) chat=${p.chat_id} — not counted as agent reply`);
    return [{
      brand: known?.brand || GENERAL_BRAND,
      conversationId,
      messageId: stableIntId(ev.id),
      inboxName: known?.inboxName || 'LiveChat',
      contactName: known?.contactName || null,
      contactEmail: known?.contactEmail || null,
      status: 'open',
      content,
      senderName: st === 'user' ? agentDisplayName(ev.author_id) : (known?.contactName || null),
      senderType: st,
      isPrivate: false,
      handoffStage: st === 'user' && !greeting ? 'opened' : null,
      event: 'message_created',
      payload: { source: 'livechat', action, lc_chat_id: p.chat_id, lc_thread_id: p.thread_id, lc_event_id: ev.id, author_id: ev.author_id, created_at: ev.created_at, auto_greeting: greeting || undefined },
    }];
  }

  if (action === 'chat_deactivated') {
    const conversationId = stableIntId(p.chat_id);
    const known = await lookupBrand(conversationId);
    return [{
      brand: known?.brand || GENERAL_BRAND,
      conversationId,
      inboxName: known?.inboxName || 'LiveChat',
      contactName: known?.contactName || null,
      contactEmail: known?.contactEmail || null,
      status: 'resolved',
      isPrivate: false,
      handoffStage: 'closed',
      event: 'conversation_status_changed',
      payload: { source: 'livechat', action, lc_chat_id: p.chat_id, lc_thread_id: p.thread_id, user_id: p.user_id },
    }];
  }

  if (action === 'thread_properties_updated') {
    const rating = p.properties?.rating;
    if (!rating || rating.score === undefined || rating.score === null) {
      // DEBUG (2026-09-14): visible instead of silent
      console.log(`LiveChat webhook: ignoring thread_properties_updated (no rating) chat=${p.chat_id || '?'}`);
      return null; // not a rating change
    }
    const conversationId = stableIntId(p.chat_id);
    const known = await lookupBrand(conversationId);
    const score = Number(rating.score);
    return [{
      brand: known?.brand || GENERAL_BRAND,
      conversationId,
      messageId: stableIntId(`${p.chat_id}:${p.thread_id}:rating`),
      inboxName: known?.inboxName || 'LiveChat',
      contactName: known?.contactName || null,
      contactEmail: known?.contactEmail || null,
      isPrivate: false,
      csatRating: score === 1 ? 5 : 1,          // good -> 5, bad -> 1
      csatFeedback: rating.comment || null,
      event: 'message_updated',                 // same shape as Chatwoot CSAT rows
      payload: { source: 'livechat', action, lc_chat_id: p.chat_id, lc_thread_id: p.thread_id, rating },
    }];
  }

  if (action === 'user_added_to_chat') {
    const u = p.user || {};
    if (u.type !== 'agent') {
      // DEBUG (2026-09-14): visible instead of silent
      console.log(`LiveChat webhook: ignoring user_added_to_chat (user type=${u.type || '?'}) chat=${p.chat_id || '?'}`);
      return null;
    }
    const conversationId = stableIntId(p.chat_id);
    const known = await lookupBrand(conversationId);
    return [{
      brand: known?.brand || GENERAL_BRAND,
      conversationId,
      inboxName: known?.inboxName || 'LiveChat',
      contactName: known?.contactName || null,
      contactEmail: known?.contactEmail || null,
      status: 'open',
      senderName: agentDisplayName(u.id || u.email),
      senderType: 'user',
      isPrivate: false,
      event: 'conversation_updated',
      payload: { source: 'livechat', action, lc_chat_id: p.chat_id, agent: u.id || u.email, reason: p.reason },
    }];
  }

  // DEBUG (2026-09-14): visible instead of silent
  console.log(`LiveChat webhook: ignoring unknown action "${action || '(none)'}"`);
  return null; // any other action — ignore
}

// ---------------------------------------------------------------------------
// POST /api/livechat/webhook/:brand   (:brand is "main" — see header)
// ---------------------------------------------------------------------------
router.post('/webhook/:brand', async (req, res) => {
  try {
    const body = req.body || {};

    // DEBUG (2026-09-14): log every delivery on arrival, before any checks,
    // so Railway logs show whether LiveChat is reaching us at all.
    console.log(
      'LiveChat webhook received:',
      body.action || '(no action)',
      'chat:', body.payload?.chat?.id || body.payload?.chat_id || '?',
      'secret_key present:', !!body.secret_key
    );

    if (!WEBHOOK_SECRET) {
      console.error('LiveChat webhook: LIVECHAT_WEBHOOK_SECRET is not set — rejecting delivery.');
      return res.status(500).json({ ok: false, error: 'secret not configured' });
    }
    if (body.secret_key !== WEBHOOK_SECRET) {
      console.warn('LiveChat webhook: secret mismatch — rejected.');
      return res.status(401).json({ ok: false });
    }

    const rows = await normalize(body);
    if (!rows || !rows.length) {
      return res.status(200).json({ ok: true, stored: false });
    }

    for (const r of rows) {
      await ChatwootEvent.create({
        messageId: null,
        content: null,
        senderName: null,
        senderType: null,
        labels: null,
        csatRating: null,
        csatFeedback: null,
        handoffStage: null,
        status: null,
        inboxId: null,
        ...r,
      });
    }
    // DEBUG (2026-09-14): confirm what was stored and under which brand.
    console.log(`LiveChat webhook: stored ${rows.length} row(s) — action=${body.action}, brand=${rows[0].brand}, conversationId=${rows[0].conversationId}`);
    res.status(200).json({ ok: true, stored: rows.length });
  } catch (err) {
    console.error('LiveChat webhook error:', err);
    // 200 so LiveChat doesn't hammer retries for a DB hiccup (same policy as Chatwoot).
    res.status(200).json({ ok: false });
  }
});

// GET /api/livechat/health — quick check that the route is mounted and the
// secret is configured (does not reveal it).
router.get('/health', (req, res) => {
  res.json({ ok: true, secretConfigured: !!WEBHOOK_SECRET, domainMap: DOMAIN_MAP, groupMap: GROUP_MAP, greetingPatterns: GREETING_PATTERNS });
});

module.exports = router;
