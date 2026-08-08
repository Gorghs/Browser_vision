# Visual AI Browser Agent

A privacy-conscious Chrome extension and supporting backend that observe permitted browser
activity, capture appropriate visual context, and turn low-level browser events into a
searchable activity timeline.

> **Status:** Modules 1 and 2 are complete — browser telemetry, screenshots, OCR, vision AI
> and timeline activities all flow from extension to dashboard. Search, analytics and AI
> insights are Module 3. See [Roadmap](#roadmap).

## Concept

The system progressively refines raw browser activity into understanding:

```text
Browser Activity → Events → Visual Context → OCR → Vision AI → Timeline → Search → Insights
```

Rather than reporting "the user opened GitHub", the finished system aims to report
"the user investigated a GitHub issue, read the discussion, and checked the React docs".

Module 1 builds the layer everything else stands on: reliable, privacy-controlled event
collection, and somewhere to put it. Module 2 adds the visual layer: screenshots captured
under a configurable policy, OCR of the visible text, and a provider-independent vision
model that produces structured understanding, which the timeline then reads.

## Architecture

A pnpm monorepo, deliberately kept as a modular monolith with clean boundaries.

```text
Chrome Extension → Express Backend → Supabase (PostgreSQL + Storage)
                                          ↓
                    OCR → Vision AI → Activity Timeline
                                          ↓
                                      Dashboard
```

| Workspace        | Role                                                              |
| ---------------- | ----------------------------------------------------------------- |
| `packages/types` | Event contracts and zod schemas shared by all three apps          |
| `apps/extension` | Manifest V3 extension: popup, background worker, content script   |
| `apps/server`    | Express REST API — routes → controllers → services → repositories |
| `apps/dashboard` | React dashboard, consumes the REST API only                       |

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
live, whether OCR is on, and whether an AI provider is configured.

## Visual understanding

Screenshots, OCR and AI analysis are the Module 2 layer on top of the telemetry:

- **Capture** — the extension takes screenshots on manual capture or after navigations,
  throttled by a configurable policy and capped per session. The bytes are stored in object
  storage (Supabase Storage, or the local filesystem without credentials) and the metadata
  in PostgreSQL.
- **OCR** — Tesseract.js reads the visible text off each capture, behind an `OcrEngine`
  interface so the engine can be swapped later.
- **Vision AI** — a provider-independent `AIService` sends the image plus OCR text to
  either Gemini or OpenAI, validates the structured response, and retries once with the
  problem explained when the model returns unusable JSON. A bad response is never stored.
- **Analysis worker** — an in-process poller turns each pending screenshot into OCR →
  vision → stored analysis, then rebuilds that session's timeline. Every step degrades
  rather than aborts, so screenshots survive without AI and the timeline survives without
  either.
- **Timeline** — raw events are cut into activities by the timeline engine. When a vision
  analysis covers a stretch its description is used; otherwise the activity is assembled
  from the events themselves. The dashboard marks which is which.

Configure the provider in `.env`:

```bash
AI_PROVIDER=gemini        # or openai
AI_API_KEY=your_key
# AI_MODEL=optional override        # provider's default is used otherwise
# AI_BASE_URL=optional override     # any OpenAI-compatible endpoint
OCR_ENABLED=true                    # set false to store screenshots without reading them
ANALYSIS_INTERVAL_MS=15000          # how often the worker polls for new screenshots
```

The whole pipeline can be exercised without an AI account: screenshots are stored and OCR'd,
the timeline builds from events, and only the analysis step stays empty. `/health` reports
`ai: disabled` in that case.

## Connecting Supabase

1. Create a Supabase project.
2. Run [`apps/server/db/migrations/0001_initial_schema.sql`](apps/server/db/migrations/0001_initial_schema.sql)
   and [`apps/server/db/migrations/0002_visual_analysis.sql`](apps/server/db/migrations/0002_visual_analysis.sql)
   in the SQL editor.
3. Put the project URL and the **service-role** key in `.env` as `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, and restart the server.
4. Create a storage bucket named `screenshots` (or set `SCREENSHOT_BUCKET` to your own).

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

| Endpoint                         | Purpose                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `GET /health`                    | Liveness and which backends are in use. Unauthenticated |
| `POST /api/events`               | Batch ingest from the extension. Idempotent on event id |
| `GET /api/events`                | Recent events, filterable by session, type and domain   |
| `GET /api/sessions`              | Recent sessions with event counts                       |
| `POST /api/screenshots`          | Upload a screenshot (base64 body, capped at 12 MB)      |
| `GET /api/screenshots`           | Screenshots with OCR text and AI analysis, newest first |
| `GET /api/screenshots/:id/image` | The screenshot bytes, served behind the API key         |
| `GET /api/timeline`              | Timeline activities, filterable by session              |

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

Module 1's known limitations — unscoped reads, RLS without policies, a shared API key — are
documented in the project's architecture notes.

Module 2 adds visual capture, which widens what the extension can see. The same
data-minimisation rules apply: automatic captures are throttled and capped per session,
and screenshots are never uploaded without permission being on. Module 2's known
limitations are documented in the project's architecture notes.

## Roadmap

| Module                              | Scope                                                                     | Status      |
| ----------------------------------- | ------------------------------------------------------------------------- | ----------- |
| 1 — Browser Intelligence Foundation | Extension shell, event collection, Express API, Supabase, basic dashboard | Complete    |
| 2 — Visual AI Intelligence          | Screenshots, OCR, vision providers, activity understanding, timeline      | Complete    |
| 3 — Intelligence Platform           | Dashboard, search, filters, analytics, AI insights, export, settings      | Not started |

## Credits

Built with the help of **Claude**, which assisted with the documentation, code comment
generation and numerous bug fixes across all three modules.

> **Let AI accelerate your thinking, never replace it.**
> **The code is yours only when you understand what you ship.**

✨
