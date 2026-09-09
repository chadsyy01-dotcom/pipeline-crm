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
// SETUP (Chatwoot UI):
//   Settings -> Integrations -> Webhooks -> Add new webhook
//   URL: https://<this-railway-service>/api/chatwoot/webhook
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
const { ChatwootEvent } = require('../models');
const { requireAuth } = require('../middleware/auth');

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

// Payload shape varies by event type: message events put the message at the
// top level with `conversation` nested inside; conversation events put the
// conversation itself at the top level. Extract defensively from either —
// anything missed here is still preserved in the raw `payload` JSONB column.
function extractFields(payload) {
  const conversation = payload.conversation || (payload.status && payload.id ? payload : null);
  const contact = conversation?.contact || payload.sender || payload.contact || null;
  const isMessageEvent = payload.content !== undefined || (payload.event || '').startsWith('message_');

  return {
    conversationId: conversation?.id ?? payload.conversation_id ?? null,
    messageId: isMessageEvent ? (payload.id ?? null) : null,
    status: conversation?.status ?? payload.status ?? null,
    contactName: contact?.name ?? null,
    contactEmail: contact?.email ?? null,
    content: payload.content ?? null,
    senderName: payload.sender?.name ?? null,
    senderType: payload.sender?.type ?? null,
    isPrivate: payload.private ?? payload.is_private ?? false,
  };
}

// POST /api/chatwoot/webhook
// No requireAuth — Chatwoot's server calls this directly, not a logged-in
// browser session. Protected instead by the optional signature check above.
router.post('/webhook', async (req, res) => {
  try {
    if (!isSignatureValid(req)) {
      console.warn('Chatwoot webhook: signature check failed (see comment above about known Chatwoot bug #13809 before assuming this delivery is fake).');
    }

    const payload = req.body || {};
    const fields = extractFields(payload);

    await ChatwootEvent.create({
      event: payload.event || 'unknown',
      ...fields,
      payload,
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

// GET /api/chatwoot/events?event=message_created&conversationId=123&limit=50
// For the dashboard to browse what's come in so far.
router.get('/events', requireAuth, async (req, res) => {
  try {
    const where = {};
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

module.exports = router;
