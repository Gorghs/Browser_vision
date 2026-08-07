# Visual AI Browser Agent

A privacy-conscious Chrome extension and supporting backend that observe permitted browser
activity, capture appropriate visual context, and turn low-level browser events into a
searchable activity timeline.

> **Status:** early development. Module 1 (Browser Intelligence Foundation) is in progress.
> Only the repository foundation exists so far — see [Roadmap](#roadmap).

## Concept

The system progressively refines raw browser activity into understanding:

```text
Browser Activity → Events → Visual Context → OCR → Vision AI → Timeline → Search → Insights
```

Rather than reporting "the user opened GitHub", the finished system aims to report
"the user investigated a GitHub issue, read the discussion, and checked the React docs".

## Architecture

A pnpm monorepo, deliberately kept as a modular monolith with clean boundaries.

```text
Chrome Extension → Express Backend → Supabase (PostgreSQL + Storage)
                                  ↘ AI providers (Gemini / OpenAI)
                                          ↓
                                      Dashboard
```

| Workspace        | Role                                                              |
| ---------------- | ----------------------------------------------------------------- |
| `apps/extension` | Manifest V3 extension: popup, background worker, content script   |
| `apps/server`    | Express REST API — routes → controllers → services → repositories |
| `apps/dashboard` | React dashboard, consumes the REST API only                       |
| `packages/*`     | Shared types and utilities                                        |

Workspaces are created in the task that first needs them, so the tree above fills in as
development progresses. Nothing is scaffolded before it holds real code.

## Tech stack

- **Extension** — TypeScript, React, Vite, Tailwind CSS, Manifest V3
- **Backend** — Node.js, Express, TypeScript, REST
- **Data** — Supabase PostgreSQL and Supabase Storage, accessed through the Supabase JS
  client and SQL migrations (no ORM, by design)
- **AI** — provider abstraction over Google Gemini and OpenAI
- **OCR** — Tesseract.js
- **State** — Zustand
- **Tooling** — pnpm, ESLint, Prettier

## Prerequisites

| Tool    | Version    |
| ------- | ---------- |
| Node.js | >= 20.11   |
| pnpm    | >= 9       |
| Git     | any recent |

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in real values
```

`.env` is git-ignored. Privileged credentials — in particular the Supabase service-role key
— stay on the backend and are never bundled into the extension or the dashboard.

## Scripts

Run from the repository root. Package-level scripts fan out across the workspace.

| Command             | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `pnpm lint`         | ESLint across the whole workspace            |
| `pnpm lint:fix`     | ESLint with autofix                          |
| `pnpm format`       | Prettier write                               |
| `pnpm format:check` | Prettier check (CI-friendly)                 |
| `pnpm typecheck`    | TypeScript checks in every workspace package |
| `pnpm test`         | Tests in every workspace package             |
| `pnpm build`        | Build every workspace package                |
| `pnpm verify`       | lint + format:check + typecheck + test       |

`typecheck`, `test`, and `build` use `pnpm -r --if-present`, so they succeed as no-ops until
the packages that define them exist.

## Privacy principles

These are engineering requirements, not aspirations:

- Request the minimum set of Chrome permissions needed for the current functionality.
- Never capture raw keyboard input or passwords.
- Make tracking, visual capture, and AI processing user-controllable.
- Keep privileged secrets on the backend; apply Row Level Security in Supabase.
- Collect only the data a feature actually needs.

## Roadmap

| Module                              | Scope                                                                     | Status      |
| ----------------------------------- | ------------------------------------------------------------------------- | ----------- |
| 1 — Browser Intelligence Foundation | Extension shell, event collection, Express API, Supabase, basic dashboard | In progress |
| 2 — Visual AI Intelligence          | Screenshots, OCR, vision providers, activity understanding, timeline      | Planned     |
| 3 — Intelligence Platform           | Dashboard, search, filters, analytics, AI insights, export, settings      | Planned     |

The full specification lives in [`docs/PROMPT.md`](docs/PROMPT.md).
