# Visual AI Browser Agent

A privacy-conscious Chrome extension and supporting backend that observe permitted browser
activity, capture appropriate visual context, and turn low-level browser events into a
searchable activity timeline.

> **Status:** Module 1 (Browser Intelligence Foundation) is complete — browser telemetry
> from extension to dashboard. Screenshots, OCR and vision AI are Module 2. See
> [Roadmap](#roadmap).

## Concept

The system progressively refines raw browser activity into understanding:

```text
Browser Activity → Events → Visual Context → OCR → Vision AI → Timeline → Search → Insights
```

Rather than reporting "the user opened GitHub", the finished system aims to report
"the user investigated a GitHub issue, read the discussion, and checked the React docs".

Module 1 builds the layer everything else stands on: reliable, privacy-controlled event
collection, and somewhere to put it.

## Architecture

A pnpm monorepo, deliberately kept as a modular monolith with clean boundaries.

```text
Chrome Extension → Express Backend → Supabase (PostgreSQL + Storage)
                                          ↓
                                      Dashboard
```

| Workspace        | Role                                                              |
| ---------------- | ----------------------------------------------------------------- |
| `packages/types` | Event contracts and zod schemas shared by all three apps          |
| `apps/extension` | Manifest V3 extension: popup, background worker, content script   |
| `apps/server`    | Express REST API — routes → controllers → services → repositories |
| `apps/dashboard` | React dashboard, consumes the REST API only                       |

Design decisions and their reasoning are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Tech stack

- **Extension** — TypeScript, React, Vite, Tailwind CSS, Manifest V3
- **Backend** — Node.js, Express, TypeScript, REST
- **Data** — Supabase PostgreSQL and Supabase Storage, accessed through the Supabase JS
  client and SQL migrations (no ORM, by design)
- **State** — Zustand
- **Tooling** — pnpm, ESLint, Prettier, Vitest

## Prerequisites

| Tool    | Version    |
| ------- | ---------- |
| Node.js | >= 20.11   |
| pnpm    | >= 9       |
| Git     | any recent |

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm --filter @vab/server start     # http://localhost:3000
pnpm --filter @vab/dashboard dev    # http://localhost:5173
pnpm --filter @vab/extension build  # apps/extension/dist
```

Then load the extension: open `chrome://extensions`, enable **Developer mode**, choose
**Load unpacked**, and select `apps/extension/dist`. Open the popup and switch **Tracking**
on — nothing is collected until you do. Browse for a moment and the dashboard will fill in.

With no `.env` values set, the server runs against **in-memory storage**: everything works
end to end, but data is lost when the server restarts. `/health` reports which backend is
live.

## Connecting Supabase

1. Create a Supabase project.
2. Run [`apps/server/db/migrations/0001_initial_schema.sql`](apps/server/db/migrations/0001_initial_schema.sql)
   in the SQL editor.
3. Put the project URL and the **service-role** key in `.env` as `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, and restart the server.

The service-role key bypasses Row Level Security. It belongs only in the backend's
environment — never in the extension, the dashboard, or a committed file.

## Scripts

Run from the repository root; they fan out across the workspace.

| Command          | Purpose                                |
| ---------------- | -------------------------------------- |
| `pnpm verify`    | lint + format:check + typecheck + test |
| `pnpm lint`      | ESLint across the whole workspace      |
| `pnpm format`    | Prettier write                         |
| `pnpm typecheck` | TypeScript checks in every package     |
| `pnpm test`      | Tests in every package                 |
| `pnpm build`     | Build the extension and dashboard      |

The server runs from TypeScript source via `tsx` and has no build step.

## API

| Endpoint            | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `GET /health`       | Liveness and which storage backend is in use. Unauthenticated |
| `POST /api/events`  | Batch ingest from the extension. Idempotent on event id       |
| `GET /api/events`   | Recent events, filterable by session, type and domain         |
| `GET /api/sessions` | Recent sessions with event counts                             |

All `/api` routes require `x-api-key` when `API_KEY` is set.

## Privacy

These are enforced in code, not just documented. The relevant tests are named after each
claim.

- **Tracking is off on install.** Turning it on is a deliberate action.
- **Keyboard input is never captured.** No keyboard listener exists in the codebase.
- **Form field contents are never read.** A click on an input, textarea, select or
  contenteditable records the element type and nothing else.
- **URLs are stored without query strings.** Stripped at collection time, before the event
  leaves the browser, not filtered after storage.
- **Selected text is opt-in**, and selections inside form fields are ignored entirely.
- **A domain blocklist** is editable in the popup and covers subdomains.
- **Four Chrome permissions**, each justified in `manifest.config.ts`; host permissions
  cover localhost only.
- **Privileged secrets stay on the backend.** The dashboard reads through REST because a
  browser page holding database credentials could read everyone's history.

Module 1's known limitations — unscoped reads, RLS without policies, a shared API key —
are stated in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#known-limitations-in-module-1).

## Roadmap

| Module                              | Scope                                                                     | Status      |
| ----------------------------------- | ------------------------------------------------------------------------- | ----------- |
| 1 — Browser Intelligence Foundation | Extension shell, event collection, Express API, Supabase, basic dashboard | Complete    |
| 2 — Visual AI Intelligence          | Screenshots, OCR, vision providers, activity understanding, timeline      | Not started |
| 3 — Intelligence Platform           | Dashboard, search, filters, analytics, AI insights, export, settings      | Not started |

The full specification lives in [`docs/PROMPT.md`](docs/PROMPT.md).
