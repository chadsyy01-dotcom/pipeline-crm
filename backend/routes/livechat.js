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
//   LIVECHAT_GROUP_MAP        optional JSON: { "<group_id>": "<brand-slug>" }
//                             e.g. {"0":"livechat-general","1":"superscatterph",
//                                   "2":"manilacasino","3":"casinyeam"}
//                             Unknown/unmapped groups fall back to the slug
//                             "livechat-group-<id>" so they still show up in
//                             the brand tabs (and tell you the id to map).
//
// KEY DIFFERENCES FROM CHATWOOT (and how they're handled):
//   - One LiveChat license, brands = GROUPS. The :brand URL param is just
//     "main"; the real brand comes from chat.access.group_ids on
//     incoming_chat and is remembered per conversation for later events.
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
// to ignore the delivery.
// ---------------------------------------------------------------------------

async function normalize(body) {
  const action = body.action;
  const p = body.payload || {};
  const now = new Date();

  if (action === 'incoming_chat') {
    const chat = p.chat || {};
    const thread = chat.thread || {};
    const groupId = (thread.access?.group_ids || chat.access?.group_ids || [0])[0];
    const brand = brandForGroup(groupId);
    const customer = (chat.users || []).find(u => u.type === 'customer') || {};
    const conversationId = stableIntId(chat.id);
    const base = {
      brand,
      conversationId,
      inboxId: Number(groupId) || 0,
      inboxName: `LiveChat · group ${groupId}`,
      contactName: customer.name || null,
      contactEmail: customer.email || null,
      status: 'open',
      isPrivate: false,
    };
    const rows = [{
      ...base,
      event: 'conversation_created',
      payload: { source: 'livechat', action, lc_chat_id: chat.id, lc_thread_id: thread.id, group_id: groupId, customer: { id: customer.id, name: customer.name, email: customer.email } },
    }];
    // Initial events that came with the chat (e.g. the customer's first message).
    for (const ev of thread.events || []) {
      if (ev.type !== 'message' || !ev.text) continue;
      const st = senderTypeFor(ev.author_id);
      rows.push({
        ...base,
        event: 'message_created',
        messageId: stableIntId(ev.id),
        content: cleanText(ev.text),
        senderName: st === 'user' ? agentDisplayName(ev.author_id) : (customer.name || null),
        senderType: st,
        handoffStage: st === 'user' ? 'opened' : null,
        payload: { source: 'livechat', action, lc_chat_id: chat.id, lc_event_id: ev.id, author_id: ev.author_id, created_at: ev.created_at },
      });
    }
    return rows;
  }

  if (action === 'incoming_event') {
    const ev = p.event || {};
    if (ev.type !== 'message' || !ev.text) return null; // ignore system/rich/form events
    const conversationId = stableIntId(p.chat_id);
    const known = await lookupBrand(conversationId);
    const st = senderTypeFor(ev.author_id);
    return [{
      brand: known?.brand || 'livechat-unknown',
      conversationId,
      messageId: stableIntId(ev.id),
      inboxName: known?.inboxName || 'LiveChat',
      contactName: known?.contactName || null,
      contactEmail: known?.contactEmail || null,
      status: 'open',
      content: cleanText(ev.text),
      senderName: st === 'user' ? agentDisplayName(ev.author_id) : (known?.contactName || null),
      senderType: st,
      isPrivate: false,
      handoffStage: st === 'user' ? 'opened' : null,
      event: 'message_created',
      payload: { source: 'livechat', action, lc_chat_id: p.chat_id, lc_thread_id: p.thread_id, lc_event_id: ev.id, author_id: ev.author_id, created_at: ev.created_at },
    }];
  }

  if (action === 'chat_deactivated') {
    const conversationId = stableIntId(p.chat_id);
    const known = await lookupBrand(conversationId);
    return [{
      brand: known?.brand || 'livechat-unknown',
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
    if (!rating || rating.score === undefined || rating.score === null) return null; // not a rating change
    const conversationId = stableIntId(p.chat_id);
    const known = await lookupBrand(conversationId);
    const score = Number(rating.score);
    return [{
      brand: known?.brand || 'livechat-unknown',
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
    if (u.type !== 'agent') return null;
    const conversationId = stableIntId(p.chat_id);
    const known = await lookupBrand(conversationId);
    return [{
      brand: known?.brand || 'livechat-unknown',
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

  return null; // any other action — ignore
}

// ---------------------------------------------------------------------------
// POST /api/livechat/webhook/:brand   (:brand is "main" — see header)
// ---------------------------------------------------------------------------
router.post('/webhook/:brand', async (req, res) => {
  try {
    const body = req.body || {};

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
  res.json({ ok: true, secretConfigured: !!WEBHOOK_SECRET, groupMap: GROUP_MAP });
});

module.exports = router;
