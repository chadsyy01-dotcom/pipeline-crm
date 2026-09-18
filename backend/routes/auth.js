const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Brute-force protection: a handful of attempts per IP per window, not a
// hard global cap — tune these if real usage needs it.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts from this IP. Try again later.' },
});

// Account edits (added 2026-09-18). Looser than login — a user fiddling with
// their picture shouldn't get locked out — but still bounded, since these
// endpoints write to the Users table.
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many account updates. Try again in a few minutes.' },
});

// ---------------------------------------------------------------------------
// Account-edit policy (decided 2026-09-18, see Project Knowledge)
//   Profile picture — EVERY user, own account only.
//   Name / password — ADMIN only: their own, and a reset on anyone else's.
//   Email          — nobody. It's the login credential; a typo locks someone
//                    out of the dashboard, so it stays fixed here and is
//                    changed directly in the DB if it ever has to be.
//   Role           — not editable through these endpoints either, so an
//                    admin can't accidentally demote the last admin.
// The role is re-read from the DATABASE on every request rather than trusted
// from the JWT: tokens last 7 days, so a demoted admin would otherwise keep
// admin powers until their token expired.
// ---------------------------------------------------------------------------
const MIN_PASSWORD = 8;
const MAX_AVATAR_CHARS = 300_000;   // ~220 kB of image; a 256px JPEG is ~40 kB
const PUBLIC_FIELDS = ['id', 'name', 'email', 'role', 'avatar'];

function validateAvatar(avatar) {
  if (avatar === null) return null;                       // explicit removal
  if (typeof avatar !== 'string') return 'avatar must be a data URL string or null';
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(avatar)) return 'avatar must be a base64 JPEG, PNG or WebP data URL';
  if (avatar.length > MAX_AVATAR_CHARS) return 'Picture is too large — please pick a smaller image';
  return null;
}

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { name, email, password, inviteCode } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }

    const userCount = await User.count();
    const isFirstUser = userCount === 0;

    // Once someone exists, signup is gated. The first user (bootstrapping
    // the account) always gets through so you're never locked out of your
    // own fresh deployment. After that, set REGISTRATION_OPEN=true in .env
    // to allow open signup, or leave it unset/false and require INVITE_CODE
    // to match what new teammates are given out-of-band.
    if (!isFirstUser && process.env.REGISTRATION_OPEN !== 'true') {
      if (!process.env.INVITE_CODE || inviteCode !== process.env.INVITE_CODE) {
        return res.status(403).json({ error: 'Signups are invite-only. Ask an admin for an invite code.' });
      }
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      passwordHash,
      role: isFirstUser ? 'admin' : 'member',
    });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// try/catch added 2026-09-18: without it, a rejected query here (e.g. a
// ConnectionAcquireTimeoutError while the database is struggling) becomes an
// unhandled promise rejection, which Node 18+ turns into a process exit —
// one slow DB moment on this single route took the whole API down. Every
// other route in this file already guards its awaits; this one didn't.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, { attributes: PUBLIC_FIELDS });
    if (!user) return res.status(404).json({ error: 'Account not found' });
    res.json({ user });
  } catch (err) {
    console.error('Auth /me error:', err.message);
    res.status(503).json({ error: 'Account lookup failed — please try again.' });
  }
});

// PATCH /api/auth/me   body: { avatar?, name?, currentPassword?, newPassword? }
// The one endpoint a user calls on their OWN account.
//   avatar  — allowed for everyone (data URL, or null to remove)
//   name / newPassword — admin only, and newPassword needs currentPassword.
// Asking an admin for their current password before a password change is
// deliberate: it makes a walked-away-from, still-logged-in session useless
// for hijacking the account.
router.patch('/me', requireAuth, accountLimiter, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const { avatar, name, currentPassword, newPassword } = req.body || {};
    const isAdmin = user.role === 'admin';
    const changes = [];

    if (avatar !== undefined) {
      const problem = validateAvatar(avatar);
      if (problem) return res.status(400).json({ error: problem });
      user.avatar = avatar;
      changes.push('picture');
    }

    if (name !== undefined) {
      if (!isAdmin) return res.status(403).json({ error: 'Only an admin can change the name on an account. Ask an admin for help.' });
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty' });
      user.name = trimmed;
      changes.push('name');
    }

    if (newPassword !== undefined) {
      if (!isAdmin) return res.status(403).json({ error: 'Only an admin can change a password. Ask an admin for a reset.' });
      if (String(newPassword).length < MIN_PASSWORD) {
        return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
      }
      if (!currentPassword) return res.status(400).json({ error: 'Current password is required to set a new one' });
      const valid = await bcrypt.compare(String(currentPassword), user.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
      user.passwordHash = await bcrypt.hash(String(newPassword), 10);
      changes.push('password');
    }

    if (!changes.length) return res.status(400).json({ error: 'Nothing to update' });

    await user.save();
    console.log(`Account update: ${user.email} changed their own ${changes.join(' + ')}.`);
    res.json({ ok: true, updated: changes, user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar } });
  } catch (err) {
    console.error('Account update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/directory — ANY logged-in user. The bare minimum needed to
// draw teammates' faces elsewhere in the dashboard (added 2026-09-18 for the
// "Agents Active" table): display name + picture, nothing else. Emails and
// roles stay behind /users, which is admin-only — a picture on a leaderboard
// is not a reason to hand every member the staff list.
router.get('/directory', requireAuth, async (req, res) => {
  try {
    const users = await User.findAll({ attributes: ['name', 'avatar'], order: [['name', 'ASC']] });
    res.json({ users });
  } catch (err) {
    console.error('Directory error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/users — admin only. Feeds the "Team members" picker on the
// Profile page. No password material is ever returned.
router.get('/users', requireAuth, async (req, res) => {
  try {
    const me = await User.findByPk(req.user.id, { attributes: ['role'] });
    if (me?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const users = await User.findAll({ attributes: PUBLIC_FIELDS, order: [['name', 'ASC']] });
    res.json({ users });
  } catch (err) {
    console.error('User list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/auth/users/:id   body: { name?, newPassword? }
// Admin only — a RESET on someone else's account, so the target's current
// password isn't required (that's the whole point: they've forgotten it).
// Email, role and avatar are deliberately not touchable here: the picture is
// the user's own to set, and email/role stay fixed per the policy above.
// Every reset is logged with who did it to whom.
router.patch('/users/:id', requireAuth, accountLimiter, async (req, res) => {
  try {
    const me = await User.findByPk(req.user.id, { attributes: ['id', 'name', 'email', 'role'] });
    if (me?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const target = await User.findByPk(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { name, newPassword } = req.body || {};
    const changes = [];

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty' });
      target.name = trimmed;
      changes.push('name');
    }

    if (newPassword !== undefined) {
      if (String(newPassword).length < MIN_PASSWORD) {
        return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
      }
      target.passwordHash = await bcrypt.hash(String(newPassword), 10);
      changes.push('password');
    }

    if (!changes.length) return res.status(400).json({ error: 'Nothing to update' });

    await target.save();
    console.log(`Admin account edit: ${me.email} updated ${target.email}'s ${changes.join(' + ')}.`);
    res.json({ ok: true, updated: changes, user: { id: target.id, name: target.name, email: target.email, role: target.role, avatar: target.avatar } });
  } catch (err) {
    console.error('Admin account edit error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
