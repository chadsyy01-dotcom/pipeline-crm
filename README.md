# Pipeline — a lightweight CRM

A working CRM scaffold: contacts, companies, a drag-and-drop deal pipeline, activity logging, and tasks.

**Stack**
- Backend: Node.js / Express / Sequelize / **Supabase Postgres** / JWT auth (custom, via bcrypt — not Supabase Auth)
- Frontend: React 18 + Vite, React Router, plain CSS (no framework)

## Setup

### 1. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Settings → Database → Connection string**, copy the **URI** (the direct, non-pooled one — port `5432`) for a long-running server like this one. If you deploy the backend somewhere serverless later, switch to the pooled URI on port `6543` instead.
3. You're only using Supabase as a managed Postgres database here — the Express backend still owns auth and API logic, so no other Supabase setup (RLS, Supabase Auth) is required for this to work.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Then edit `.env`:
- `DATABASE_URL` — from the Supabase step above
- `JWT_SECRET` — generate a real one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `REGISTRATION_OPEN` / `INVITE_CODE` — see **Signup control** below

```bash
npm run dev             # or: npm start
```

Runs on `http://localhost:4000`. On first boot `sequelize.sync()` creates all tables in your Supabase database and seeds six default pipeline stages (New → Qualified → Proposal → Negotiation → Won / Lost). The first user who registers becomes an `admin`. You'll see the tables appear under **Table Editor** in your Supabase dashboard once it's run.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173` and proxies `/api` calls to the backend. Open that URL, register an account, and you're in.

## What's included

- **Auth** — register/login, JWT, first user is admin, rate-limited (10 login attempts / 15 min, 5 signups / hour per IP)
- **Signup control** — after the first account, new registrations require an `INVITE_CODE` unless `REGISTRATION_OPEN=true`. The frontend's register form has an invite-code field for this.
- **Contacts** — full CRUD (including edit/delete in the UI), search, status (lead/active/customer/inactive), linked company
- **Companies** — full CRUD (including edit/delete in the UI), linked contacts and deals
- **Deals** — Kanban pipeline board with drag-and-drop stage changes; a deal detail page for editing title/value/stage, assigning a contact and company, adding notes, and deleting
- **Activities** — notes/calls/emails logged against a contact, shown as a timeline
- **Tasks** — simple per-user to-do list with due dates

## Extending it

- Replace `sequelize.sync()` with real migrations (e.g. `sequelize-cli` or Supabase's own migration tool) before production — `sync()` is fine for getting started but risky once you have real data.
- Add email sync: something like Nylas or IMAP/SMTP polling, writing into the `Activity` table.
- Add team/role permissions: `User.role` already exists (`admin`/`member`) — gate routes in `middleware/auth.js`.
- Move auth to Supabase Auth: swaps out the custom bcrypt/JWT flow in `routes/auth.js` for Supabase's — worth it if you want magic links, OAuth providers, or to call Supabase directly from the frontend later.
- Deploy like your other projects: frontend to Netlify (`npm run build` → `dist/`), backend to Railway (add `DATABASE_URL` and `JWT_SECRET` as Railway env vars), pointing the `VITE` proxy / API base at the deployed backend URL.
