# التزام (Eltizam) - Financial Management App

## Overview
A professional, mobile-first Arabic RTL financial management application built with
React + Express + PostgreSQL. Installable as a PWA, with a native app-like feel,
Tajawal font and a full Arabic UI.

## Architecture
- **Frontend**: React + Vite + TailwindCSS v4 + Shadcn UI + TanStack Query + wouter
- **Backend**: Express.js with Passport.js local strategy authentication
- **Database**: PostgreSQL via Drizzle ORM (`pg` driver)
- **Auth**: Session-based with express-session + connect-pg-simple

## Running it
| Command | What it does |
| --- | --- |
| `npm run dev` | Server + Vite middleware on one port (default 5000) |
| `npm run build` | Vite client build, then esbuild bundles the server to `dist/index.cjs` |
| `npm start` | Runs the production bundle |
| `npm run check` | TypeScript, no emit |
| `npm run db:migrate` | Applies pending migrations (`db:push` is deliberately disabled) |
| `npm run backup:db` | Manual database backup |
| `npm run icons` | Regenerates the PWA icon set from one source design |

`DATABASE_URL` and `SESSION_SECRET` are required; everything else in
`.env.example` is optional and degrades gracefully when unset.

## Migrations
Numbered steps in `server/db.ts`, applied automatically on boot and tracked in
`schema_migrations`. **Append a new version, never renumber an existing one** — a
deployed database records what it already ran, so reusing a number silently skips
the new step. The schema is currently at v20.

## Data model
Core: **users**, **wallets**, **categories**, **transactions**.

Planning: **obligations** (recurring dues, fixed or variable, with per-month
statuses), **commitments** (personal or financial, with steps, proofs, occurrences
and reminders), **recurringIncomes**, **savingsGoals**.

Bank inbox: **bankEmailConnections** (one mailbox + bank + wallet, with sync
health), **bankEmailEvents** (a parsed message and what became of it),
**bankCategoryRules** (a payee decision the user made once).

Notifications: **notificationPreferences**, **pushSubscriptions**,
**notificationDeliveries** (the dedupe ledger).

Also **integrationSettings** (admin-managed OAuth credentials, encrypted) and
**passwordResetRequests**.

## Server modules
- `routes.ts` — the bulk of the API, all under `/api`
- `storage.ts` — `DatabaseStorage`, every CRUD path and the balance rules
- `auth.ts` — Passport setup, register/login/logout, password reset
- `db.ts` — connection plus the migration list
- `bank-inbox.ts` — Gmail/Outlook OAuth, the sync scheduler, import and reconciliation
- `bank-message-parser.ts` — turns a bank alert into a transaction; pure, no I/O
- `bank-analysis.ts` — spending analysis over imported events
- `notifications.ts` — `notify()`, delivering over push, email, Telegram,
  WhatsApp and webhook, with quiet hours and per-event dedupe
- `automation.ts` — the commitment engine: occurrences, reminders, undo
- `insights.ts` — risks, unnoticed subscriptions, the decision simulator
- `understanding.ts` — a commitment from a sentence, a document, or speech
- `documents.ts` — contract storage and the calendar feed
- `integration-settings.ts` — encrypted provider credentials
- `write-queue.ts` — serialises writes that would otherwise race on one key
- `mail.ts`, `backup.ts`, `audit.ts`, `static.ts`, `vite.ts`

## Bank inbox
Reads only messages from the bank's own senders — never the whole mailbox — and
optionally only one account within that bank. A sync covers 90 days on a first
read, then only what arrived since the last successful one plus an overlap.

Two invariants worth knowing before changing anything here:

1. **A batch is imported oldest-first.** The importer settles the wallet to the
   closing balance each message reports, so the newest message must be processed
   last; and the balance-gap check compares a message against its predecessor,
   which therefore has to already be stored.
2. **A payment the user already entered by hand is linked, not duplicated.**
   Reconciliation matches on wallet, direction, amount and date, and deliberately
   ignores transfer legs and the importer's own "unknown difference" placeholders
   — it recognises what the *user* recorded.

Connections record the outcome of every attempt (`lastStatus`, `lastError`,
`failureCount`) and back off as failures repeat, so a revoked token says so
instead of looking like a quiet week.

## PWA
`client/public/manifest.webmanifest`, generated icons in `client/public/icons/`,
and `client/public/sw.js`.

The service worker caches the shell and content-hashed assets so the app opens
offline, and **never caches anything under `/api`** — a stale balance reads as
authoritative and gets acted on, which is worse than failing to load. The worker,
the manifest and `index.html` are served `no-cache`; hashed assets get a year and
`immutable`.

Installation is offered once, on first run, then only from a small corner button
(`components/install-prompt.tsx`). iOS has no install API, so it gets
instructions for Safari's share sheet instead.

## Notifications
Everything goes through `notify()` in `server/notifications.ts`, which respects
the channels the user enabled and their quiet hours, and dedupes on a caller
supplied key. Without credentials a channel reports itself unavailable rather
than half-working.

SMTP and the Web Push VAPID pair are resolved by `server/channel-settings.ts`:
an admin-saved row in `channel_settings` wins, and the environment variables are
the fallback when no row exists — so a deployment that cannot set environment
variables configures both from Admin › قنوات الإشعارات. Secrets are stored
encrypted with the same key as the OAuth settings, are never returned to the
client, and an empty field on save keeps the stored value. Resolution is cached
for 30s, so an edit takes effect without a restart. **Keep the VAPID pair
stable** — replacing it silently invalidates every subscription already handed
out, which is why the generate button warns first.

On iOS, push only works after the app is installed to the home screen.

## Frontend notes
- Routes are lazily loaded in `App.tsx` behind a `Suspense` boundary, so a screen
  is fetched when it is opened. Chunking is left to Rollup; a hand-written
  `manualChunks` that split React out was tried and reverted — the CJS interop
  wrappers initialised before React and every route rendered blank.
- RTL via `dir="rtl"` on the html root, Tajawal for Arabic typography.
- TailwindCSS v4 with CSS variable design tokens (H S% L%).
- Bottom navigation with a floating action button; drawer-based forms.
- Wallet colours are stored as Tailwind gradient class strings.
