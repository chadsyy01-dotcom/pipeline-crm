// backend/routes/chatwoot.js
//
// Chatwoot webhook receiver — this is the "easy way" to get chat data out of
// a self-hosted Chatwoot instance without touching Nginx at all. Chatwoot
// PUSHES event payloads to this endpoint (Settings -> Integrations ->
// Webhooks in the Chatwoot UI), so it never has to send the underscored
// `api_access_token` header that Nginx silently drops on this server —
// that header only matters for the OTHER direction (us calling Chatwoot's
// API), which this route doesn't need.
//
// SETUP (Chatwoot UI, per brand — each brand is a separate Chatwoot
// account/instance, so this gets configured once per brand):
//   Settings -> Integrations -> Webhooks -> Add new webhook
//   URL: https://<this-railway-service>/api/chatwoot/webhook/<brand-slug>
//        e.g. .../api/chatwoot/webhook/tmtcash, .../webhook/buenasph
//   Events: conversation_created, conversation_status_changed,
//           conversation_updated, message_created (pick whichever you need)
//
// SETUP (Railway -> this service -> Variables) — optional but recommended:
//   CHATWOOT_WEBHOOK_SECRET   the "secret" shown when you create the webhook
//                             in the Chatwoot UI. If unset, signatures are
//                             not checked and every delivery is accepted.
//
// NOTE ON SIGNATURE VERIFICATION: as of early 2026 there's an open Chatwoot
// bug (chatwoot/chatwoot#13809) on some self-hosted versions where the
// "secret" shown in the UI/API doesn't actually match the internal key used
// to sign requests, which makes verification fail even with a correct
// implementation. Because of that, a signature mismatch here only logs a
// warning and still accepts the delivery — we'd rather keep real ticket
// data than silently drop it over a platform bug. Tighten this to a hard
// reject once you've confirmed signatures verify cleanly on your instance.

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { ChatwootEvent, sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { requireAuth } = require('../middleware/auth');

// Chatwoot message content comes as HTML (e.g. "<p>Hello</p>") — strip tags
// for plain-text display in list/preview contexts. Full HTML is still kept
// as-is in the raw `payload` JSONB if a richer view ever needs it.
function stripHtml(html) {
  if (!html) return html;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Names of AI/bot personas that appear as a Chatwoot "Agent" but are NOT a
// real human — a reply from one of these does NOT count as a handoff, no
// matter what the conversation's labels say. Add more names here as new
// brands' bot personas get added (each brand may name theirs differently).
//
// Convention: the bot persona is the account the AI posts through — the
// brand's admin@ / bot@ login. Real human agents (Hanna, Mim, Lucy,
// Admin Mika, OM - AOM, Tala, Bella, etc.) must NOT be listed here, or
// their replies stop counting as handoffs.
const AI_BOT_SENDER_NAMES = new Set([
  // existing
  'Admin Joy',
  'Admin Love',
  'Agent Jem',
  'Manila Play Admin',
  'Mona',
  // added 2026-09-13 from Chatwoot agent rosters
  'Hype Play PH Admin',   // admin@hypeplay.asia
  'Bogchi',               // admin@hypeplaybdt.com
  'Lucky Stacks Admin',   // admin@luckystacks.ph
  'Admin May',            // bot@88mgk.com
  'TMTPlay Admin',        // admin@tmtplay88.online
  'Buenas88 Admin',       // admin@buenas88.vip
  // added 2026-09-13 from CSAT reports (assigned agent on nearly every
  // survey for the brand — same pattern as Admin Joy / Mona).
  // 'Admin Heart' was REMOVED from this list 2026-09-14: confirmed a REAL
  // agent on TMTCash — her replies now count as human handoffs/FTR and are
  // included in the QA conduct scan. Maya remains listed as a suspected
  // bot persona (manilaplayph) until confirmed either way.
  'Maya',                 // maya@manilaplay.ph (manilaplayph)
]);

function isRealHumanAgentReply(senderName, senderType) {
  return senderType === 'user' && !!senderName && !AI_BOT_SENDER_NAMES.has(senderName);
}

// ---------------------------------------------------------------------------
// STORAGE CONTROL (added 2026-09-13 after the Supabase -> Neon migration)
//
// Context: with every Chatwoot event stored in full, the table grew ~35 MB
// per day across 10 brands (614 MB in 4 days) and blew through the 500 MB
// free tier. Only four event types feed the dashboard; the rest (typing
// indicators, contact_created/updated, webwidget_triggered, and almost all
// message_updated) were pure noise. Three measures below keep growth low
// enough to live on Neon's free 0.5 GB indefinitely:
//   1. STORED_EVENTS allowlist — anything else is acknowledged (200) but
//      never written.
//   2. message_updated is the ONE exception: it's discarded UNLESS it carries
//      a CSAT survey response — that is the only place ratings arrive
//      (Chatwoot updates the existing survey message when the customer
//      answers; it does not create a new one). Deleting message_updated
//      wholesale wiped every CSAT/DSAT — hence this rule.
//   3. slimPayload() strips the bulky, never-read parts of the raw payload
//      (mainly conversation.messages, which repeats the whole thread on every
//      event), and prunePayloads() blanks payload entirely on rows older
//      than PAYLOAD_RETENTION_DAYS. Extracted columns are never touched, so
//      the dashboard is unaffected; only /backfill loses the ability to
//      re-derive those old rows, which is an acceptable trade.
// ---------------------------------------------------------------------------
const STORED_EVENTS = new Set([
  'message_created',
  'conversation_created',
  'conversation_status_changed',
  'conversation_updated',
]);

const PAYLOAD_RETENTION_DAYS = Number(process.env.CHATWOOT_PAYLOAD_RETENTION_DAYS) || 3;

// Full-row retention (added 2026-09-14): rows older than this are DELETED
// entirely — not just payload-blanked. Decided with ops: the dashboard's
// longest lookback need is month-vs-previous-month comparison, which
// requires up to ~2 months of history (current window + the equal-length
// window before it). 70 days = 2 months + buffer. This caps the table at a
// stable size instead of growing forever. Covers LiveChat rows too (same
// table). Override with CHATWOOT_EVENT_RETENTION_DAYS if the comparison
// window ever changes — never set it below ~62 while monthly comparisons
// are in use.
const EVENT_RETENTION_DAYS = Number(process.env.CHATWOOT_EVENT_RETENTION_DAYS) || 70;

// Max conversations returned PER BRAND when no ?brand= filter is given.
// Default 500 (raised from 200 on 2026-09-14 — Buenas/TMTCash/ManilaPlay/MCP
// each exceed 200 active conversations). Callers can pass ?perBrand=N up to
// PER_BRAND_MAX; the frontend asks for 1000. Raising this makes the JSON
// response larger on every 20s poll, so don't go beyond what the UI needs.
const PER_BRAND_LIMIT = 500;
const PER_BRAND_MAX = 2000;

function hasCsatResponse(payload) {
  return !!payload?.content_attributes?.submitted_values?.csat_survey_response;
}

function shouldStoreEvent(payload) {
  const event = payload.event || '';
  if (STORED_EVENTS.has(event)) return true;
  if (event === 'message_updated') return hasCsatResponse(payload);
  return false;
}

// Drops the parts of a Chatwoot payload that extractFields() never reads and
// that account for most of its size. Returns a new object; input untouched.
function slimPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  if (out.conversation && typeof out.conversation === 'object') {
    const c = { ...out.conversation };
    delete c.messages;               // full thread repeated on every event — the big one
    delete c.additional_attributes;  // browser/referer/geo blobs
    delete c.custom_attributes;
    delete c.contact_inbox;
    if (c.meta && typeof c.meta === 'object') {
      // keep meta.sender (contact identity); drop assignee/team objects
      c.meta = c.meta.sender ? { sender: c.meta.sender } : {};
    }
    out.conversation = c;
  }
  if (out.sender && typeof out.sender === 'object') {
    const s = { ...out.sender };
    delete s.additional_attributes;
    delete s.custom_attributes;
    out.sender = s;
  }
  delete out.additional_attributes;
  delete out.attachments;
  return out;
}

// Blank the payload on rows older than the retention window. Runs on boot
// and then every 24h. Idempotent; cheap once caught up (indexed by createdAt
// scan, skips rows already blanked).
async function prunePayloads() {
  try {
    // Step 1: delete rows past full retention (frees the most space).
    const [, delMeta] = await sequelize.query(`
      DELETE FROM "ChatwootEvents"
      WHERE "createdAt" < NOW() - (:evDays || ' days')::interval
    `, { replacements: { evDays: String(EVENT_RETENTION_DAYS) } });
    const nDel = delMeta?.rowCount ?? delMeta ?? 0;
    console.log(`Chatwoot prune: deleted ${nDel} row(s) older than ${EVENT_RETENTION_DAYS} day(s).`);

    // Step 2: blank payloads on remaining rows past payload retention.
    const [, meta] = await sequelize.query(`
      UPDATE "ChatwootEvents"
      SET "payload" = '{}'::jsonb
      WHERE "createdAt" < NOW() - (:days || ' days')::interval
        AND "payload" IS NOT NULL
        AND "payload" <> '{}'::jsonb
    `, { replacements: { days: String(PAYLOAD_RETENTION_DAYS) } });
    const n = meta?.rowCount ?? meta ?? 0;
    console.log(`Chatwoot prune: blanked payload on ${n} row(s) older than ${PAYLOAD_RETENTION_DAYS} day(s).`);
  } catch (err) {
    console.error('Chatwoot prune error:', err);
  }
}
setTimeout(prunePayloads, 60 * 1000);                 // 1 min after boot
setInterval(prunePayloads, 24 * 60 * 60 * 1000);      // then daily

// Normalizes Chatwoot conversation labels (e.g. "BNS-HH PENDING", "TMT-HH-
// CLOSED") into one of a small set of canonical handoff stages, regardless
// of each brand's own label prefix/spacing conventions:
//   'pending' — AI already handed off to a human agent, agent hasn't replied yet
//   'opened'  — an agent has picked it up, conversation is ongoing
//   'closed'  — the handoff is done / conversation with the agent is over
//   'handoff' — flagged for a human agent but not one of the above sub-stages
//   null      — no handoff label at all (still AI/bot-handled)
function normalizeHandoffStage(labels) {
  if (!labels || !labels.length) return null;
  const joined = labels.join(' ').toUpperCase();
  if (/HH[\s-]*PENDING|PENDING[\s-]*HH/.test(joined)) return 'pending';
  // Real-world bot labels (seen 2026-09-14): "tmtcpending_humanhandoff",
  // "tmtchumanhandoff" — prefix + pending/humanhandoff, underscores, no "HH".
  // Matched generically so any brand prefix (tmtc-, bns-, ...) works.
  if (/PENDING[\s_-]*(HUMAN)?[\s_-]*HANDOFF|HANDOFF[\s_-]*PENDING/.test(joined)) return 'pending';
  if (/HH[\s-]*OPEN/.test(joined)) return 'opened';
  if (/HH[\s-]*CLOSED|CLOSED[\s-]*HH/.test(joined)) return 'closed';
  if (/\bHH\b/.test(joined)) return 'handoff';
  if (/HUMAN[\s_-]*HANDOFF/.test(joined)) return 'handoff';
  return null;
}

function isSignatureValid(req) {
  const secret = process.env.CHATWOOT_WEBHOOK_SECRET;
  if (!secret) return true; // verification not configured — accept everything

  const signature = req.headers['x-chatwoot-signature'];
  const timestamp = req.headers['x-chatwoot-timestamp'];
  if (!signature || !timestamp || !req.rawBody) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${req.rawBody}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false; // length mismatch etc — treat as invalid, not a crash
  }
}

// message_created events sometimes omit `sender.type` at the top level even
// for a genuine customer message — the same info is then only available
// (differently cased: "Contact"/"User" instead of "contact"/"user") on the
// matching entry inside conversation.messages[]. Without this fallback, a
// real customer message with a missing top-level type gets misclassified
// as an automated/system message in the UI.
function resolveSenderType(payload, conversation) {
  if (payload.sender?.type) return payload.sender.type;
  const nested = conversation?.messages?.find(m => m.id === payload.id);
  if (nested?.sender_type) return nested.sender_type.toLowerCase();
  return null;
}

// Payload shape varies by event type: message events put the message at the
// top level with `conversation` nested inside; conversation events put the
// conversation itself at the top level. Extract defensively from either —
// anything missed here is still preserved in the raw `payload` JSONB column.
//
// inboxId/inboxName identify which Chatwoot inbox (and therefore which
// brand, once inboxes map 1:1 to brands) an event came from — NOT the
// "Webhook Name" set in the Chatwoot UI, which is just a label for your own
// webhook list and is never included in the payload itself.
function extractFields(payload) {
  const conversation = payload.conversation || (payload.status && payload.id ? payload : null);
  // Contact/customer identity shows up in different places depending on
  // event type — conversation-level events (conversation_created,
  // conversation_updated) nest it under `meta.sender`, message-level events
  // put it directly on `sender`, and some shapes nest it under
  // `conversation.contact`. Only trust a sender-shaped value when its
  // `type` is actually 'contact' (not 'user'/'agent_bot'), since an agent's
  // own reply/assignment would otherwise get mistaken for the customer.
  const metaSender = payload.meta?.sender || conversation?.meta?.sender;
  const isContactSender = (s) => s?.type === 'contact';
  const contact = conversation?.contact
    || (isContactSender(metaSender) ? metaSender : null)
    || (isContactSender(payload.sender) ? payload.sender : null)
    || payload.contact
    || null;
  const isMessageEvent = payload.content !== undefined || (payload.event || '').startsWith('message_');
  const inbox = payload.inbox || conversation?.inbox || null;
  // Chatwoot's API has used both `labels` and `label_names` for this field
  // across versions — check both, defensively.
  const labels = conversation?.labels || conversation?.label_names || payload.labels || payload.label_names || null;
  // A CSAT response is a customer's answer to the "Rate our support" survey
  // — it arrives as a normal message_created event, but with the rating
  // tucked inside content_attributes instead of (or alongside) plain text.
  const csatResponse = payload.content_attributes?.submitted_values?.csat_survey_response || null;

  // Handoff stage. Prefer the sender-based signal — a real human agent
  // (anyone except the AI bot persona) replying is a direct, automatic sign
  // of handoff, more reliable than depending on someone remembering to
  // apply a label. Falls back to the label if the sender doesn't tell us
  // anything (e.g. this event is a customer message, or a bot template)
  // but a label WAS applied — this is currently the only way 'pending'
  // gets set, since "assigned but not yet replied" isn't reliably
  // detectable from messages alone.
  //
  // RESOLVED OVERRIDE (fix 2026-09-14): bot handoff labels (e.g.
  // "pending_humanhandoff") stay on the conversation forever — Chatwoot
  // never removes them. Once the conversation is RESOLVED, any
  // label-derived pending/handoff must read as 'closed', or post-resolve
  // events (CSAT prompt, closing message, status change) re-assert
  // 'pending' and the chat gets stuck in Waiting-for-Agent.
  const convStatus = conversation?.status ?? payload.status ?? null;
  let handoffStage;
  if (isRealHumanAgentReply(payload.sender?.name, payload.sender?.type)) {
    handoffStage = convStatus === 'resolved' ? 'closed' : 'opened';
  } else {
    const labelStage = normalizeHandoffStage(labels);
    handoffStage = (labelStage && convStatus === 'resolved') ? 'closed' : labelStage;
  }

  return {
    conversationId: conversation?.id ?? payload.conversation_id ?? null,
    messageId: isMessageEvent ? (payload.id ?? null) : null,
    status: convStatus,
    inboxId: inbox?.id ?? conversation?.inbox_id ?? payload.inbox_id ?? null,
    inboxName: inbox?.name ?? null,
    contactName: contact?.name ?? null,
    contactEmail: contact?.email ?? null,
    content: payload.content ?? null,
    senderName: payload.sender?.name ?? null,
    senderType: resolveSenderType(payload, conversation),
    isPrivate: payload.private ?? payload.is_private ?? false,
    labels: labels && labels.length ? labels : null,
    csatRating: csatResponse?.rating ?? null,
    csatFeedback: csatResponse?.feedback_message ?? null,
    handoffStage,
  };
}

// POST /api/chatwoot/webhook/:brand
// No requireAuth — Chatwoot's server calls this directly, not a logged-in
// browser session. Protected instead by the optional signature check above.
//
// :brand comes from the URL itself, not the payload — each brand runs its
// own separate Chatwoot account/instance, so inbox_id/account_id inside the
// payload aren't guaranteed unique across them (two brands could both have
// "inbox_id": 1). Give each brand's webhook its own URL when configuring it
// in that brand's Chatwoot: .../api/chatwoot/webhook/tmtcash,
// .../api/chatwoot/webhook/buenasph, etc. — use short lowercase slugs,
// consistent with brandCode conventions elsewhere in this codebase.
router.post('/webhook/:brand', async (req, res) => {
  try {
    if (!isSignatureValid(req)) {
      console.warn('Chatwoot webhook: signature check failed (see comment above about known Chatwoot bug #13809 before assuming this delivery is fake).');
    }

    const payload = req.body || {};

    // Storage control: acknowledge but don't persist events the dashboard
    // never reads (see STORED_EVENTS / shouldStoreEvent above).
    if (!shouldStoreEvent(payload)) {
      return res.status(200).json({ ok: true, stored: false });
    }

    // Extract from the FULL payload (so nothing is lost to slimming), then
    // persist only the slimmed copy.
    const fields = extractFields(payload);

    await ChatwootEvent.create({
      brand: req.params.brand,
      event: payload.event || 'unknown',
      ...fields,
      payload: slimPayload(payload),
    });

    // Chatwoot doesn't do anything with the response body, but it does
    // expect a fast 2xx — respond immediately rather than doing any slow
    // work (e.g. further processing) before replying.
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Chatwoot webhook error:', err);
    // Still 200 — a 4xx/5xx here just makes Chatwoot retry the same
    // delivery, which won't help if the failure was e.g. a DB hiccup.
    res.status(200).json({ ok: false });
  }
});

// GET /api/chatwoot/conversations?brand=buenasph&limit=50
// One row per conversation (not per raw event) — latest status/contact info
// plus a plain-text preview of the most recent message. Three queries
// instead of one merged: the conversation's LATEST event (any type) may not
// be the one that carries message content (e.g. it could be a typing/status
// -only event) or reliable contact info (a status-change event often has
// neither) — so status, contact identity, and message preview are each
// resolved from the most recent row that actually has that data, then merged.
// Computes Total Chatting Time (art) and First Response Time (ftr), in
// seconds, from a conversation's chronologically-ordered messages. Bot
// replies (AI_BOT_SENDER_NAMES) are ignored entirely — they neither count
// as a response nor as the handoff itself, since they don't represent a
// human agent. The "handoff point" is defined as the agent's first
// GENUINE reply to a customer message (i.e. there must be a preceding
// customer message to reply to) — not just the first non-bot agent
// message in the thread. This keeps ftr and art scoped to the exact same
// set of conversations, so their "N handoffs" counts always match: a
// conversation only counts toward either average once it has a real,
// gap-measurable handoff. "Chatting time" itself is the full span from
// that handoff point to the conversation's last message — not an average
// of individual reply gaps — so it reflects how long the customer was
// actually being chatted with by an agent.
function computeArtFtr(messages) {
  let lastCustomerMsgTime = null;
  let firstAgentGap = null;
  let firstAgentMsgTime = null;

  for (const m of messages) {
    if (m.senderType === 'contact') {
      lastCustomerMsgTime = new Date(m.createdAt).getTime();
    } else if (m.senderType === 'user' && AI_BOT_SENDER_NAMES.has(m.senderName)) {
      continue; // bot reply — not a human response, ignore entirely
    } else if (m.senderType === 'user' && lastCustomerMsgTime !== null) {
      const msgTime = new Date(m.createdAt).getTime();
      if (firstAgentGap === null) {
        firstAgentGap = (msgTime - lastCustomerMsgTime) / 1000;
        firstAgentMsgTime = msgTime; // handoff point = first genuine reply
      }
      lastCustomerMsgTime = null;
    }
  }

  let chattingTime = null;
  if (firstAgentMsgTime !== null && messages.length) {
    const lastMsgTime = new Date(messages[messages.length - 1].createdAt).getTime();
    chattingTime = Math.max(0, (lastMsgTime - firstAgentMsgTime) / 1000);
  }

  return {
    art: chattingTime,
    ftr: firstAgentGap,
  };
}

router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const brand = req.query.brand || null;
    const from = req.query.from || null;
    const to = req.query.to || null;
    // Cap raised 200 -> 1000 (2026-09-13): with 10 brands, low-traffic ones
    // (MGK, LuckystacksPH) were being crowded out of the top-200 by Buenas/
    // TMT/MCP volume and vanished from the brand tabs entirely. The frontend
    // should still pass ?limit=1000 explicitly to get the full set.
    const limit = Math.min(Number(req.query.limit) || 50, PER_BRAND_MAX);
    const brandClause = brand ? 'AND "brand" = :brand' : '';
    // Restricts which conversations are "in scope" for this request, and
    // what counts as their lastActivityAt, to activity that happened within
    // [from, to] — WITHOUT restricting the other lookups below (contact,
    // message preview, handoff, csat), which still resolve each matched
    // conversation's TRUE latest info regardless of date. This avoids two
    // failure modes: (1) a date filter silently missing older conversations
    // that got crowded out of the unfiltered top-`limit` rows by newer,
    // unrelated activity elsewhere, and (2) showing blank/"Unknown" contact
    // or status info for a conversation whose identifying data happens to
    // predate the selected window.
    const dateClause = (from && to) ? 'AND "createdAt" BETWEEN :from AND :to' : '';

    // Per-brand cap (2026-09-13): a single global top-N let high-volume
    // brands (Buenas/TMT/MCP) crowd low-volume ones (MGK, LuckystacksPH)
    // out of the list entirely. Now every brand gets its own most-recent
    // `perBrand` conversations, so all brands always appear in the tabs.
    // Implemented with ROW_NUMBER() over the per-conversation "latest"
    // rows, partitioned by brand.
    const perBrand = brand
      ? limit
      : Math.min(Number(req.query.perBrand) || PER_BRAND_LIMIT, PER_BRAND_MAX);
    const latestPerConversation = await sequelize.query(`
      SELECT "conversationId", "brand", "inboxName", "status", "lastActivityAt"
      FROM (
        SELECT latest.*,
               ROW_NUMBER() OVER (PARTITION BY "brand" ORDER BY "lastActivityAt" DESC) AS rn
        FROM (
          SELECT DISTINCT ON ("conversationId")
            "conversationId", "brand", "inboxName", "status", "createdAt" AS "lastActivityAt"
          FROM "ChatwootEvents"
          WHERE "conversationId" IS NOT NULL ${brandClause} ${dateClause}
          ORDER BY "conversationId", "createdAt" DESC
        ) latest
      ) ranked
      WHERE rn <= :perBrand
    `, { replacements: { brand, from, to, perBrand }, type: QueryTypes.SELECT });

    // Egress control (2026-09-14, after Neon data-transfer quota exhaustion):
    // the four lookups below used to DISTINCT ON over the WHOLE table on
    // every poll — thousands of rows (message previews included) shipped
    // from the DB each time. Scoping them to the conversation ids actually
    // selected above cuts DB egress by an order of magnitude.
    const selectedIds = latestPerConversation.map(r => r.conversationId);
    if (!selectedIds.length) {
      return res.json({ conversations: [] });
    }
    const idsClause = 'AND "conversationId" IN (:selectedIds)';

    const latestContactPerConversation = await sequelize.query(`
      SELECT DISTINCT ON ("conversationId")
        "conversationId", "contactName", "contactEmail"
      FROM "ChatwootEvents"
      WHERE "conversationId" IS NOT NULL AND "contactName" IS NOT NULL ${brandClause} ${idsClause}
      ORDER BY "conversationId", "createdAt" DESC
    `, { replacements: { brand, selectedIds }, type: QueryTypes.SELECT });

    const latestMessagePerConversation = await sequelize.query(`
      SELECT DISTINCT ON ("conversationId")
        "conversationId", "content", "senderName", "senderType", "createdAt" AS "lastMessageAt"
      FROM "ChatwootEvents"
      WHERE "conversationId" IS NOT NULL AND "content" IS NOT NULL ${brandClause} ${idsClause}
      ORDER BY "conversationId", "createdAt" DESC
    `, { replacements: { brand, selectedIds }, type: QueryTypes.SELECT });

    const latestHandoffPerConversation = await sequelize.query(`
      SELECT DISTINCT ON ("conversationId")
        "conversationId", "handoffStage", "labels"
      FROM "ChatwootEvents"
      WHERE "conversationId" IS NOT NULL AND "handoffStage" IS NOT NULL ${brandClause} ${idsClause}
      ORDER BY "conversationId", "createdAt" DESC
    `, { replacements: { brand, selectedIds }, type: QueryTypes.SELECT });

    const latestCsatPerConversation = await sequelize.query(`
      SELECT DISTINCT ON ("conversationId")
        "conversationId", "csatRating", "csatFeedback"
      FROM "ChatwootEvents"
      WHERE "conversationId" IS NOT NULL AND "csatRating" IS NOT NULL ${brandClause} ${idsClause}
      ORDER BY "conversationId", "createdAt" DESC
    `, { replacements: { brand, selectedIds }, type: QueryTypes.SELECT });

    const contactMap = new Map(latestContactPerConversation.map(r => [r.conversationId, r]));
    const messageMap = new Map(latestMessagePerConversation.map(r => [r.conversationId, r]));
    const handoffMap = new Map(latestHandoffPerConversation.map(r => [r.conversationId, r]));
    const csatMap = new Map(latestCsatPerConversation.map(r => [r.conversationId, r]));
    const conversations = latestPerConversation
      .map(row => {
        const contact = contactMap.get(row.conversationId);
        const msg = messageMap.get(row.conversationId);
        const handoff = handoffMap.get(row.conversationId);
        const csat = csatMap.get(row.conversationId);
        return {
          conversationId: row.conversationId,
          brand: row.brand,
          inboxName: row.inboxName,
          contactName: contact ? contact.contactName : null,
          contactEmail: contact ? contact.contactEmail : null,
          status: row.status,
          lastActivityAt: row.lastActivityAt,
          lastMessage: msg ? stripHtml(msg.content) : null,
          lastMessageAt: msg ? msg.lastMessageAt : null,
          lastMessageSender: msg ? msg.senderName : null,
          lastMessageSenderType: msg ? msg.senderType : null,
          handoffStage: handoff ? handoff.handoffStage : null,
          labels: handoff ? handoff.labels : null,
          csatRating: csat ? csat.csatRating : null,
          csatFeedback: csat ? csat.csatFeedback : null,
          art: null,
          ftr: null,
        };
      });

    // ART/FTR need the FULL message thread (not just the latest row), so
    // this only runs for conversations that actually have a handoff —
    // there's no point computing human response times for pure-AI ones,
    // and it keeps this extra query scoped to a much smaller set.
    const handoffIds = conversations.filter(c => c.handoffStage).map(c => c.conversationId);
    if (handoffIds.length > 0) {
      const allMessages = await sequelize.query(`
        SELECT "conversationId", "senderType", "senderName", "createdAt"
        FROM "ChatwootEvents"
        WHERE event = 'message_created' AND content IS NOT NULL
          AND "conversationId" IN (:handoffIds)
        ORDER BY "conversationId", "createdAt" ASC
      `, { replacements: { handoffIds }, type: QueryTypes.SELECT });

      const byConversation = {};
      allMessages.forEach(m => {
        (byConversation[m.conversationId] ??= []).push(m);
      });

      conversations.forEach(c => {
        if (!c.handoffStage) return;
        const msgs = byConversation[c.conversationId];
        if (!msgs) return;
        const { art, ftr } = computeArtFtr(msgs);
        c.art = art;
        c.ftr = ftr;
      });
    }

    // No global slice when showing all brands — the per-brand cap above
    // already bounds the result (<= PER_BRAND_LIMIT x number of brands).
    const sorted = conversations
      .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt))
      .slice(0, brand ? limit : conversations.length);

    res.json({ conversations: sorted });
  } catch (err) {
    console.error('Chatwoot conversations error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chatwoot/events?brand=tmtcash&event=message_created&conversationId=123&limit=50
// For the dashboard to browse what's come in so far.
// GET /api/chatwoot/csat?brand=buenasph&from=2026-09-01T00:00:00.000Z&to=2026-09-13T23:59:59.999Z
// Aggregate CSAT stats from stored survey responses. Chatwoot's default
// scale is 1-5 — this uses the common convention of 4-5 = satisfied (CSAT),
// 1-2 = dissatisfied (DSAT), 3 = neutral. Adjust the thresholds below if
// your actual survey uses a different scale (e.g. a straight thumbs up/down).
// `from`/`to` are optional ISO timestamps — when both are present, only
// CSAT responses whose event `createdAt` (i.e. when the customer actually
// submitted the survey) falls within that window are counted. Passing only
// one of the two is treated as no date filter at all, same as passing
// neither, since a half-open range isn't something the frontend ever sends.
router.get('/csat', requireAuth, async (req, res) => {
  try {
    const brand = req.query.brand || null;
    const from = req.query.from || null;
    const to = req.query.to || null;
    const brandClause = brand ? 'AND "brand" = :brand' : '';
    const dateClause = (from && to) ? 'AND "createdAt" BETWEEN :from AND :to' : '';

    // One response per conversation — a customer could technically answer
    // more than once if surveyed again, so take their latest answer only
    // (within the date window, when one is given).
    const responses = await sequelize.query(`
      SELECT DISTINCT ON ("conversationId")
        "conversationId", "csatRating", "csatFeedback", "createdAt"
      FROM "ChatwootEvents"
      WHERE "conversationId" IS NOT NULL AND "csatRating" IS NOT NULL ${brandClause} ${dateClause}
      ORDER BY "conversationId", "createdAt" DESC
    `, { replacements: { brand, from, to }, type: QueryTypes.SELECT });

    const total = responses.length;
    const csatCount = responses.filter(r => r.csatRating >= 4).length;
    const dsatCount = responses.filter(r => r.csatRating <= 2).length;
    const neutralCount = total - csatCount - dsatCount;
    const avgRating = total ? responses.reduce((sum, r) => sum + r.csatRating, 0) / total : null;

    res.json({
      total,
      avgRating: avgRating !== null ? Math.round(avgRating * 100) / 100 : null,
      csatCount,
      dsatCount,
      neutralCount,
      csatPercent: total ? Math.round((csatCount / total) * 1000) / 10 : null,
      dsatPercent: total ? Math.round((dsatCount / total) * 1000) / 10 : null,
      responses: responses.map(r => ({ conversationId: r.conversationId, rating: r.csatRating, feedback: r.csatFeedback, createdAt: r.createdAt })),
    });
  } catch (err) {
    console.error('Chatwoot CSAT stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chatwoot/stats?from=...&to=...
// Lightweight aggregates for the main dashboard — NOT subject to the
// per-brand 200 cap of /conversations, so counts are exact. Returns, for the
// [from,to] window (defaults to all time when either is missing):
//   conversationsByBrand  { brand: n }  conversations with ANY activity in window
//   csatByBrand           { brand: { csat, dsat, neutral, total } }  latest rating
//                         per conversation, submitted within window
//   handoffPending        n conversations whose LATEST handoff stage is 'pending'
//                         (no date filter — a pending handoff is pending until
//                         someone replies, however old it is)
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const dateClause = (from && to) ? 'AND "createdAt" BETWEEN :from AND :to' : '';

    const convRows = await sequelize.query(`
      SELECT "brand", COUNT(DISTINCT "conversationId") AS n
      FROM "ChatwootEvents"
      WHERE "conversationId" IS NOT NULL ${dateClause}
      GROUP BY "brand"
    `, { replacements: { from, to }, type: QueryTypes.SELECT });

    const csatRows = await sequelize.query(`
      SELECT "brand", "csatRating" FROM (
        SELECT DISTINCT ON ("conversationId") "brand", "csatRating"
        FROM "ChatwootEvents"
        WHERE "conversationId" IS NOT NULL AND "csatRating" IS NOT NULL ${dateClause}
        ORDER BY "conversationId", "createdAt" DESC
      ) latest
    `, { replacements: { from, to }, type: QueryTypes.SELECT });

    const pendingRows = await sequelize.query(`
      SELECT COUNT(*) AS n FROM (
        SELECT DISTINCT ON ("conversationId") "handoffStage"
        FROM "ChatwootEvents"
        WHERE "conversationId" IS NOT NULL AND "handoffStage" IS NOT NULL
        ORDER BY "conversationId", "createdAt" DESC
      ) latest
      WHERE "handoffStage" = 'pending'
    `, { type: QueryTypes.SELECT });

    const conversationsByBrand = {};
    convRows.forEach(r => { conversationsByBrand[r.brand] = Number(r.n); });

    const csatByBrand = {};
    csatRows.forEach(r => {
      const b = csatByBrand[r.brand] ??= { csat: 0, dsat: 0, neutral: 0, total: 0 };
      b.total++;
      if (r.csatRating >= 4) b.csat++;
      else if (r.csatRating <= 2) b.dsat++;
      else b.neutral++;
    });

    res.json({
      conversationsByBrand,
      csatByBrand,
      handoffPending: Number(pendingRows[0]?.n || 0),
    });
  } catch (err) {
    console.error('Chatwoot stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chatwoot/pending
// Lightweight feed for the "Needs Attention — Waiting for Agent" widget
// (added 2026-09-14 for egress control). Returns ONLY conversations whose
// LATEST handoff stage is 'pending', with just the fields the widget shows.
// Replaces the dashboard's previous approach of pulling the full 1000-per-
// brand conversation list every poll just to filter it down to a handful.
router.get('/pending', requireAuth, async (req, res) => {
  try {
    const pendingRows = await sequelize.query(`
      SELECT "conversationId", "brand" FROM (
        SELECT DISTINCT ON ("conversationId") "conversationId", "brand", "handoffStage"
        FROM "ChatwootEvents"
        WHERE "conversationId" IS NOT NULL AND "handoffStage" IS NOT NULL
        ORDER BY "conversationId", "createdAt" DESC
      ) latest
      WHERE "handoffStage" = 'pending'
    `, { type: QueryTypes.SELECT });

    if (!pendingRows.length) return res.json({ pending: [] });
    const ids = pendingRows.map(r => r.conversationId);
    const brandMap = new Map(pendingRows.map(r => [r.conversationId, r.brand]));

    const [contacts, messages, activity] = await Promise.all([
      sequelize.query(`
        SELECT DISTINCT ON ("conversationId") "conversationId", "contactName"
        FROM "ChatwootEvents"
        WHERE "conversationId" IN (:ids) AND "contactName" IS NOT NULL
        ORDER BY "conversationId", "createdAt" DESC
      `, { replacements: { ids }, type: QueryTypes.SELECT }),
      sequelize.query(`
        SELECT DISTINCT ON ("conversationId") "conversationId", "content"
        FROM "ChatwootEvents"
        WHERE "conversationId" IN (:ids) AND "content" IS NOT NULL
        ORDER BY "conversationId", "createdAt" DESC
      `, { replacements: { ids }, type: QueryTypes.SELECT }),
      sequelize.query(`
        SELECT "conversationId", MAX("createdAt") AS "lastActivityAt"
        FROM "ChatwootEvents"
        WHERE "conversationId" IN (:ids)
        GROUP BY "conversationId"
      `, { replacements: { ids }, type: QueryTypes.SELECT }),
    ]);
    const contactMap = new Map(contacts.map(r => [r.conversationId, r.contactName]));
    const messageMap = new Map(messages.map(r => [r.conversationId, r.content]));
    const activityMap = new Map(activity.map(r => [r.conversationId, r.lastActivityAt]));

    res.json({
      pending: ids.map(id => ({
        conversationId: id,
        brand: brandMap.get(id),
        contactName: contactMap.get(id) || null,
        lastMessage: stripHtml(messageMap.get(id) || null),
        lastActivityAt: activityMap.get(id) || null,
      })),
    });
  } catch (err) {
    console.error('Chatwoot pending list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chatwoot/dismiss-pending  body: { conversationId, brand }
// Manual escape hatch for the Waiting-for-Agent widget (added 2026-09-14):
// writes a synthetic 'closed' handoff event for the conversation, so the
// latest-handoff-wins logic drops it from /pending and /stats for EVERYONE,
// permanently. If a genuinely NEW handoff happens on the same conversation
// later, its newer 'pending' event outranks this row and the chat correctly
// reappears. Audited: logs and stores who dismissed it.
router.post('/dismiss-pending', requireAuth, async (req, res) => {
  try {
    const conversationId = Number(req.body?.conversationId);
    const brand = String(req.body?.brand || '').trim();
    if (!conversationId || !brand) return res.status(400).json({ error: 'conversationId and brand required' });
    const by = req.user?.name || req.user?.email || 'unknown';
    // Inherit the conversation's last known status/inbox — this synthetic
    // row becomes its LATEST row, and a null status here would make the
    // Customers page show "Unknown" for an otherwise-fine conversation.
    const lastKnown = await sequelize.query(`
      SELECT
        (SELECT "status" FROM "ChatwootEvents" WHERE "conversationId" = :cid AND "status" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1) AS status,
        (SELECT "inboxName" FROM "ChatwootEvents" WHERE "conversationId" = :cid AND "inboxName" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1) AS "inboxName"
    `, { replacements: { cid: conversationId }, type: QueryTypes.SELECT });
    await ChatwootEvent.create({
      brand,
      event: 'manual_dismiss',
      conversationId,
      messageId: null,
      status: lastKnown[0]?.status ?? null,
      inboxId: null,
      inboxName: lastKnown[0]?.inboxName ?? null,
      contactName: null,
      contactEmail: null,
      content: null,
      senderName: by,
      senderType: null,
      isPrivate: false,
      labels: null,
      csatRating: null,
      csatFeedback: null,
      handoffStage: 'closed',
      payload: { source: 'manual-dismiss', by, at: new Date().toISOString() },
    });
    console.log(`Waiting-for-Agent: conversation ${conversationId} (${brand}) manually dismissed by ${by}.`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Chatwoot dismiss-pending error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chatwoot/agent-messages?brands=buenasph,tmtcash&from=...&to=...
// Feed for the QA page's Agent Conduct scanner (added 2026-09-14): returns
// REAL human agents' outbound messages (senderType='user', excluding the
// AI bot personas) for the given brands and window — just the columns the
// scanner needs, so each scan stays small. Classification itself happens
// client-side so the wordlists can be tuned without redeploying the backend.
router.get('/agent-messages', requireAuth, async (req, res) => {
  try {
    const brands = String(req.query.brands || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!brands.length) return res.status(400).json({ error: 'brands required (csv)' });
    const from = req.query.from || null;
    const to = req.query.to || null;
    const limit = Math.min(Number(req.query.limit) || 2000, 5000);
    const dateClause = (from && to) ? 'AND "createdAt" BETWEEN :from AND :to' : '';
    const botNames = [...AI_BOT_SENDER_NAMES];

    const rows = await sequelize.query(`
      SELECT "conversationId", "brand", "senderName", "content", "createdAt"
      FROM "ChatwootEvents"
      WHERE event = 'message_created'
        AND "senderType" = 'user'
        AND "content" IS NOT NULL
        AND "senderName" IS NOT NULL
        AND "senderName" NOT IN (:botNames)
        AND "brand" IN (:brands)
        ${dateClause}
      ORDER BY "createdAt" DESC
      LIMIT :limit
    `, { replacements: { brands, botNames, from, to, limit }, type: QueryTypes.SELECT });

    res.json({ messages: rows.map(r => ({
      conversationId: r.conversationId,
      brand: r.brand,
      agent: r.senderName,
      content: stripHtml(r.content),
      createdAt: r.createdAt,
    })) });
  } catch (err) {
    console.error('Chatwoot agent-messages error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/events', requireAuth, async (req, res) => {
  try {
    const where = {};
    if (req.query.brand) where.brand = req.query.brand;
    if (req.query.event) where.event = req.query.event;
    if (req.query.conversationId) where.conversationId = Number(req.query.conversationId);

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const events = await ChatwootEvent.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
    });
    res.json({ events });
  } catch (err) {
    console.error('Chatwoot events list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chatwoot/import-csat
// One-time restore tool (added 2026-09-14 after the Neon->Supabase migration
// left the new DB without September's ratings). Accepts rows exported from
// each brand's Chatwoot Reports->CSAT CSV and writes them as the same
// message_updated/csatRating rows the live webhook produces, with createdAt
// set to the ORIGINAL recorded time so date filters and monthly comparisons
// see them in the right period. Idempotent: a conversation that already has
// a rating row (from live webhooks or a previous import run) is skipped, so
// running this twice — or importing a CSV that overlaps live data — cannot
// double-count anything.
router.post('/import-csat', requireAuth, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'rows[] required' });

    // Existing rated conversations (any brand) — skip these.
    const existing = await sequelize.query(`
      SELECT DISTINCT "conversationId" FROM "ChatwootEvents" WHERE "csatRating" IS NOT NULL
    `, { type: QueryTypes.SELECT });
    const existingIds = new Set(existing.map(r => Number(r.conversationId)));

    // Within the submitted batch, keep only the LATEST rating per conversation
    // (a customer re-rated conversation appears twice in Chatwoot's export).
    const latestByConv = new Map();
    for (const r of rows) {
      const id = Number(r.conversationId);
      if (!id || !r.brand || r.rating == null) continue;
      const prev = latestByConv.get(id);
      if (!prev || new Date(r.recordedAt) > new Date(prev.recordedAt)) latestByConv.set(id, r);
    }

    let imported = 0, skippedExisting = 0;
    for (const r of latestByConv.values()) {
      const id = Number(r.conversationId);
      if (existingIds.has(id)) { skippedExisting++; continue; }
      const when = r.recordedAt ? new Date(r.recordedAt) : new Date();
      await ChatwootEvent.create({
        brand: String(r.brand),
        event: 'message_updated',
        conversationId: id,
        messageId: null,
        status: null,
        inboxId: null,
        inboxName: null,
        contactName: r.contactName || null,
        contactEmail: null,
        content: null,
        senderName: r.agentName || null,
        senderType: null,
        isPrivate: false,
        labels: null,
        csatRating: Number(r.rating),
        csatFeedback: r.feedback || null,
        handoffStage: null,
        payload: { source: 'csat-import', imported_at: new Date().toISOString() },
        createdAt: when,
        updatedAt: when,
      });
      existingIds.add(id);
      imported++;
    }
    console.log(`CSAT import: ${imported} imported, ${skippedExisting} skipped (already rated), batch=${rows.length}`);
    res.json({ ok: true, imported, skippedExisting, batch: rows.length });
  } catch (err) {
    console.error('CSAT import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chatwoot/backfill
// One-time maintenance action: re-runs the CURRENT extractFields() logic
// against every stored row's raw `payload`, and updates the derived
// columns to match. Nothing about the payload itself changes — this just
// lets rows captured before an extraction-logic fix (like the meta.sender
// fix) benefit from it immediately, instead of waiting for a new event on
// that same conversation. Safe to run more than once.
router.post('/backfill', requireAuth, async (req, res) => {
  try {
    // Only rows whose payload is a REAL webhook capture can be re-derived.
    // Two guards (2026-09-14, after a failed run):
    //   1. payload must contain an 'event' key — synthetic rows (e.g. the
    //      CSAT import's {source:'csat-import'} payload) would re-derive to
    //      all-nulls and WIPE their own ratings if processed.
    //   2. Fetch only id+payload for candidate rows via raw SQL instead of
    //      findAll()-ing the entire table into memory — the old version
    //      could time out / OOM, which is what "Failed — try again" was.
    const candidates = await sequelize.query(`
      SELECT "id", "payload"
      FROM "ChatwootEvents"
      WHERE "payload" IS NOT NULL
        AND "payload" <> '{}'::jsonb
        AND "payload" ? 'event'
    `, { type: QueryTypes.SELECT });

    let updated = 0;
    let skipped = 0;
    for (const row of candidates) {
      const payload = row.payload;
      if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
        skipped++;
        continue;
      }
      const f = extractFields(payload);
      await sequelize.query(`
        UPDATE "ChatwootEvents" SET
          "conversationId" = :conversationId, "messageId" = :messageId, "status" = :status,
          "inboxId" = :inboxId, "inboxName" = :inboxName, "contactName" = :contactName,
          "contactEmail" = :contactEmail, "senderName" = :senderName, "senderType" = :senderType,
          "isPrivate" = :isPrivate, "labels" = :labels, "handoffStage" = :handoffStage,
          "csatRating" = :csatRating, "csatFeedback" = :csatFeedback
        WHERE "id" = :id
      `, { replacements: {
        id: row.id,
        conversationId: f.conversationId, messageId: f.messageId, status: f.status,
        inboxId: f.inboxId, inboxName: f.inboxName, contactName: f.contactName,
        contactEmail: f.contactEmail, senderName: f.senderName, senderType: f.senderType,
        isPrivate: f.isPrivate, labels: f.labels ? `{${f.labels.map(l => '"' + String(l).replace(/"/g, '') + '"').join(',')}}` : null,
        handoffStage: f.handoffStage, csatRating: f.csatRating, csatFeedback: f.csatFeedback,
      } });
      updated++;
    }
    console.log(`Chatwoot backfill: ${updated} updated, ${skipped} skipped, ${candidates.length} candidates (imports & blank payloads excluded by query).`);
    res.json({ ok: true, updated, skipped });
  } catch (err) {
    console.error('Chatwoot backfill error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
