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

// Visitor IP (added 2026-09-18). LiveChat hands this over on the customer
// object; unlike Chatwoot it needs no digging through additional_attributes.
// Stored in its own ChatwootEvents column so the Customers page can show it
// after payload pruning. Only present from this deploy onward.
function customerIpOf(customer) {
  const ip = customer?.last_visit?.ip || customer?.ip || null;
  if (typeof ip !== 'string') return null;
  const trimmed = ip.trim();
  return /^[0-9a-fA-F:.]{7,45}$/.test(trimmed) ? trimmed : null;
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
// 2026-10-10: ang message na WALANG author_id ay itinuturing nang 'contact'
// (dating null → hindi lumalabas sa thread view at hindi nabibilang sa
// FTR/Missed computation, kaya "nawawala" ang mga mensahe ng customer).
function senderTypeFor(authorId) {
  if (!authorId) return 'contact';
  return String(authorId).includes('@') ? 'user' : 'contact';
}

// FILE/IMAGE events (2026-10-10): ang mga larawan/screenshot na pinapadala
// ng customer ay dumarating na ev.type='file' (may url/name/content_type) —
// dating NI-IGNORE kaya "nawawala" sa thread at hindi nabibilang sa FTR/
// Missed (nadiskubre kay Jackie30: screenshot ang sagot niya, hindi text).
// Iniimbak na ngayon bilang message_created na may placeholder na content;
// ang url ay nasa payload (lc_file_url) para magamit ng frontend.
function fileEventContent(ev) {
  const isImage = /^image\//i.test(ev.content_type || '') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(ev.url || '');
  const name = ev.name ? ` (${ev.name})` : '';
  return (isImage ? '📷 [Nagpadala ng larawan]' : '📎 [Nagpadala ng file]') + name;
}
// 2026-10-15: kunin ang url mula sa iba't ibang posibleng field, at i-log ang
// hugis ng file event (para makita sa Railway logs kapag walang url).
function lcFileUrl(ev) {
  const u = ev.url || ev.file?.url || ev.thumbnail2x_url || ev.thumbnail_url || null;
  if (!u) console.warn('[livechat] file event WALANG url:', JSON.stringify(ev).slice(0, 600));
  return u || undefined;
}
function isStorableEvent(ev) {
  return (ev.type === 'message' && ev.text) || (ev.type === 'file' && (ev.url || ev.name));
}
function eventContent(ev) {
  return ev.type === 'file' ? fileEventContent(ev) : cleanText(ev.text);
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
      // Visitor IP (2026-09-18) — see customerIpOf().
      customerIp: customerIpOf(customer),
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
      if (!isStorableEvent(ev)) continue;
      const st = senderTypeFor(ev.author_id);
      const content = eventContent(ev);
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
        payload: { source: 'livechat', action, lc_chat_id: chat.id, lc_event_id: ev.id, author_id: ev.author_id, created_at: ev.created_at, auto_greeting: greeting || undefined, lc_file_url: ev.type === 'file' ? lcFileUrl(ev) : undefined, lc_file_type: ev.type === 'file' ? ev.content_type : undefined },
      });
    }
    return rows;
  }

  if (action === 'incoming_event') {
    const ev = p.event || {};
    if (!isStorableEvent(ev)) {
      // DEBUG (2026-09-14): visible instead of silent
      console.log(`LiveChat webhook: ignoring incoming_event (type=${ev.type || '?'}, hasText=${!!ev.text}) chat=${p.chat_id || '?'}`);
      return null; // ignore system/rich/form events
    }
    const conversationId = stableIntId(p.chat_id);
    const known = await lookupBrand(conversationId);
    const st = senderTypeFor(ev.author_id);
    const content = eventContent(ev);
    // DEBUG (2026-10-10): makikita sa Railway logs kung ang bawat message ay
    // na-classify na agent ('user') o customer ('contact') — ginagamit sa
    // pag-diagnose ng nawawalang customer messages.
    console.log(`LiveChat webhook: message chat=${p.chat_id} author=${ev.author_id || '(wala)'} -> senderType=${st}`);
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
      payload: { source: 'livechat', action, lc_chat_id: p.chat_id, lc_thread_id: p.thread_id, lc_event_id: ev.id, author_id: ev.author_id, created_at: ev.created_at, auto_greeting: greeting || undefined, lc_file_url: ev.type === 'file' ? lcFileUrl(ev) : undefined, lc_file_type: ev.type === 'file' ? ev.content_type : undefined },
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
        customerIp: null,
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

// ---------------------------------------------------------------------------
// POST /api/livechat/reply  body: { brand, conversationId, content, attachment? }
// REPLY MULA SA DASHBOARD PARA SA LIVECHAT (2026-10-16, utos ni Chad) —
// text at larawan. Gamit ang LiveChat Agent Chat API v3.5.
//
// Railway variable (isang JSON):
//   LIVECHAT_REPLY_CONFIG = {"accountId":"<LiveChat account id>",
//     "token":"<Personal Access Token>","agentEmail":"<email ng agent na may-ari ng token>"}
//   - Gawin ang PAT sa https://developers.livechat.com/console → Tools →
//     Personal Access Tokens. Scopes: chats--all:rw, chats.conversation--all:rw
//     (at chats--access:rw kung hihingin).
//   - accountId = "Account ID" na makikita rin sa page na iyon.
//   - Ang agentEmail ang lalabas na sender; idadagdag siya sa chat kung wala pa.
// Ang LiveChat chat_id ay kinukuha sa payload.lc_chat_id ng pinakahuling row
// ng conversation (conversationId sa DB ay hash lang ng chat_id).
// ---------------------------------------------------------------------------
const { requireAuth } = require('../middleware/auth');
let LC_REPLY = null, LC_REPLY_ERROR = null;
try { LC_REPLY = process.env.LIVECHAT_REPLY_CONFIG ? JSON.parse(process.env.LIVECHAT_REPLY_CONFIG) : null; }
catch (e) { LC_REPLY_ERROR = e.message; console.error('LIVECHAT_REPLY_CONFIG is not valid JSON:', e.message); }
const LC_API = 'https://api.livechatinc.com/v3.5/agent/action';

function lcAuthHeader() {
  return 'Basic ' + Buffer.from(`${LC_REPLY.accountId}:${LC_REPLY.token}`).toString('base64');
}
async function lcAction(action, body) {
  const r = await fetch(`${LC_API}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: lcAuthHeader() },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data = {}; try { data = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) {
    const err = new Error(data?.error?.message || `HTTP ${r.status}`);
    err.status = r.status; err.type = data?.error?.type; err.raw = text.slice(0, 300);
    throw err;
  }
  return data;
}
async function lcUpload(buf, type, name) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  const r = await fetch(`${LC_API}/upload_file`, { method: 'POST', headers: { Authorization: lcAuthHeader() }, body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.url) throw new Error('upload_file: ' + (data?.error?.message || `HTTP ${r.status}`));
  return data.url;
}
async function lcSend(chatId, event) {
  try {
    return await lcAction('send_event', { chat_id: chatId, event });
  } catch (e) {
    // Hindi pa kasali sa chat ang agent → idagdag, tapos subukan ulit
    if (/not.*(user|member)|requester|access/i.test(e.message) && LC_REPLY.agentEmail) {
      await lcAction('add_user_to_chat', { chat_id: chatId, user_id: LC_REPLY.agentEmail, user_type: 'agent', visibility: 'all', ignore_requester_presence: true });
      return await lcAction('send_event', { chat_id: chatId, event });
    }
    throw e;
  }
}

router.post('/reply', requireAuth, async (req, res) => {
  try {
    if (!LC_REPLY || !LC_REPLY.accountId || !LC_REPLY.token) {
      return res.status(400).json({ error: LC_REPLY_ERROR
        ? `SIRA ang JSON ng LIVECHAT_REPLY_CONFIG sa Railway (${LC_REPLY_ERROR}).`
        : 'Hindi pa naka-configure ang LiveChat replies. Idagdag ang LIVECHAT_REPLY_CONFIG sa Railway ({"accountId":"…","token":"…","agentEmail":"…"}) at i-redeploy.' });
    }
    const conversationId = Number(req.body?.conversationId);
    const brand = String(req.body?.brand || '').trim();
    const content = String(req.body?.content || '').trim();
    const att = req.body?.attachment && req.body.attachment.data ? req.body.attachment : null;
    if (!conversationId || (!content && !att)) return res.status(400).json({ error: 'conversationId at content o attachment ang kailangan' });
    if (att && !/^image\/(png|jpe?g|gif|webp)$/i.test(String(att.type || ''))) return res.status(400).json({ error: 'Larawan lang (PNG, JPG, GIF, WEBP) ang puwedeng i-upload.' });

    const rows = await sequelize.query(`
      SELECT payload->>'lc_chat_id' AS chat_id
      FROM "ChatwootEvents"
      WHERE "conversationId" = :conversationId ${brand ? 'AND "brand" = :brand' : ''}
        AND payload->>'lc_chat_id' IS NOT NULL
      ORDER BY "createdAt" DESC LIMIT 1
    `, { replacements: { conversationId, brand }, type: QueryTypes.SELECT });
    const chatId = rows[0] && rows[0].chat_id;
    if (!chatId) return res.status(404).json({ error: 'Hindi mahanap ang LiveChat chat id ng conversation na ito (masyadong luma na ang chat).' });

    const sent = [];
    if (att) {
      const buf = Buffer.from(String(att.data).replace(/^data:[^,]*,/, ''), 'base64');
      if (buf.length > 10 * 1024 * 1024) return res.status(400).json({ error: 'Masyadong malaki ang larawan (max 10 MB).' });
      const name = String(att.name || 'image').replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'image';
      const url = await lcUpload(buf, att.type, name);
      sent.push(await lcSend(chatId, { type: 'file', url, visibility: 'all' }));
    }
    if (content) sent.push(await lcSend(chatId, { type: 'message', text: content, visibility: 'all' }));

    const by = req.user?.name || req.user?.email || 'unknown';
    console.log(`LiveChat dashboard reply by ${by} -> ${brand} chat ${chatId} (${sent.length} event)`);
    // Ang webhook echo (incoming_event) ang mag-iimbak nito sa DB.
    res.json({ ok: true });
  } catch (err) {
    console.error('LiveChat reply error:', err.message, err.raw || '');
    const hint = err.status === 401 ? ' (401: mali ang accountId/token sa LIVECHAT_REPLY_CONFIG)'
      : err.status === 403 ? ' (403: kulang ang scopes ng Personal Access Token)'
      : /inactive|not active|chat is closed/i.test(err.message) ? ' (sarado na ang chat sa LiveChat — hindi na ma-replyan)' : '';
    res.status(502).json({ error: `Tumanggi ang LiveChat: ${err.message}${hint}` });
  }
});

module.exports = router;
