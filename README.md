# Field Dispatch Automation

Job-completion pipeline for a home-services company, plus an MCP server that lets AI agents read the job system and draft follow-ups for human approval.

**Pipeline** (`POST /webhook/job-complete`): technician notes -> LLM customer summary -> PDF -> Postgres -> customer email via Make.com. Every stage is recorded in `completed_jobs.status`, so a failure is visible and retryable instead of silently re-running.

**MCP server** (`npm run mcp`): read tools for jobs, customer history, today's jobs, and customers missing a follow-up, plus one write tool that creates a follow-up *draft*. Drafts are approved or rejected by a person in the portal's review queue; only approval sends.

## Layout

| Path | Purpose |
|---|---|
| `src/app.js` | Express app (no `listen`), used by both `server.js` and Vercel |
| `src/pipeline.js` | Stage-by-stage job processing with durable status |
| `src/jobs.js`, `src/followups.js` | Data access. The only SQL in the project. Shared with the MCP server |
| `src/validate.js`, `src/auth.js` | Input validation (pure) and portal-key auth |
| `db/schema.sql` | Idempotent schema; `npm run db:migrate` applies it |
| `db/seed.js` | Demo data (`DEMO-*` job ids only); `db/create-mcp-role.js` provisions the agent role |
| `mcp/server.js` | MCP server over stdio, connects with the least-privilege role |
| `public/` | Tech portal (`index.html`) and office review queue (`review.html`) |
| `api/index.js`, `vercel.json` | Vercel serverless entrypoint and routing |

## Setup

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, OPENAI_API_KEY, PORTAL_KEY (and Make URLs if you have them)
npm run db:migrate        # create / upgrade tables
npm run db:seed           # demo customers, jobs, follow-ups (add -- --reset to wipe DEMO-* first)
npm run db:role -- --write-env   # creates Postgres role mcp_agent and writes MCP_DATABASE_URL to .env
npm test
npm run dev               # http://localhost:3000
```

Open the portal, expand **Portal access**, and paste `PORTAL_KEY`. It is stored in the browser and sent as the `x-portal-key` header on every API call.

## API

All routes except `/api/health` require `x-portal-key: <PORTAL_KEY>` (or `Authorization: Bearer`).

| Method | Path | Notes |
|---|---|---|
| POST | `/webhook/job-complete` | multipart: `jobId, techName, customerEmail, rawNotes, jobPrice, photos[]`. 409 if the job id exists |
| POST | `/api/jobs/:jobId/retry-notify` | re-send the summary email for a `notify_failed` job |
| GET | `/api/jobs?limit=&status=` or `?date=YYYY-MM-DD` | recent jobs, or jobs completed on a date (business timezone) |
| GET | `/api/jobs/:jobId` | job + its follow-ups |
| GET | `/api/jobs/:jobId/pdf` | the stored summary PDF |
| GET | `/api/customers/:email/history` | all jobs for a customer, with totals |
| GET | `/api/customers/without-follow-up?days=7` | customers with a recent job and no sent follow-up |
| GET | `/api/follow-ups?status=draft` | follow-ups by status |
| POST | `/api/follow-ups` | create a draft by hand |
| POST | `/api/follow-ups/:id/approve` | approve and send (via `MAKE_FOLLOWUP_WEBHOOK_URL`); `x-reviewer` header is recorded |
| POST | `/api/follow-ups/:id/reject` / `/retry` | reject a draft / retry a failed send |

Job statuses: `received -> summarized -> stored -> notified`, or `notify_failed` / `failed` with `last_error` set.
Follow-up statuses: `draft -> approved -> sent`, or `rejected` / `failed`.

## MCP server

Runs locally over stdio and connects to Postgres as `mcp_agent` (SELECT on all tables, INSERT on `follow_ups` only, verified by `db/create-mcp-role.js`). It cannot approve, send, update, or delete anything.

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "field-dispatch": {
      "command": "node",
      "args": ["C:/Users/ty200/Desktop/automation/field-dispatch-automation/mcp/server.js"]
    }
  }
}
```

Claude Code: `claude mcp add field-dispatch -- node C:/Users/ty200/Desktop/automation/field-dispatch-automation/mcp/server.js`

The server reads `.env` from the project directory, so `MCP_DATABASE_URL`, `BUSINESS_TIMEZONE`, and `APP_BASE_URL` (used for links back to the review queue) must be set there.

Tools: `get_job`, `get_customer_history`, `list_completed_jobs`, `list_customers_without_follow_up`, `list_follow_ups`, `draft_follow_up`.

Demo prompts that work against the seed data:

- "Which customers haven't gotten a follow-up this week?"
- "Show me Maria Lopez's history." (`maria.lopez@example.com`)
- "What did we complete today?"
- "Draft a friendly follow-up for job DEMO-1006 asking whether the toilet is still running." Then approve it at `/review.html`.

## Remote MCP (connect any agent by URL)

The same six tools are served over MCP Streamable HTTP at `/mcp` on the deployed app, so a viewer can connect their own Claude (or any MCP client) without cloning anything. Access needs a bearer token, `MCP_BEARER_TOKEN`, which is separate from the portal key: it unlocks the tools only, never the approve endpoint. Requests run as the `mcp_agent` database role.

Give a viewer the URL and the token. Then:

- **Claude Code:** `claude mcp add --transport http field-dispatch https://<your-app>.vercel.app/mcp --header "Authorization: Bearer <token>"`
- **Claude.ai / Claude Desktop connectors, or any client with no header field:** use the token as a path segment: `https://<your-app>.vercel.app/mcp/<token>`
- **Cursor, Windsurf, etc.:** URL plus an `Authorization: Bearer <token>` header in their MCP settings.

Rotate the token in Vercel to cut off every connected agent at once. The endpoint is stateless (one JSON response per request), which is what a serverless host can serve.

## Deploy to Vercel

The app runs as one serverless function (`api/index.js`) with `public/` served statically. PDFs are generated in memory and stored in Postgres, so nothing touches the filesystem.

```bash
npx vercel login
npx vercel link                    # create / pick the project
node scripts/vercel-env.js         # pushes DATABASE_URL, MCP_DATABASE_URL, MCP_BEARER_TOKEN, PORTAL_KEY, OPENAI_API_KEY, MAKE_*, BUSINESS_TIMEZONE, APP_BASE_URL from .env
npx vercel --prod
```

After the first deploy, set `APP_BASE_URL` in `.env` to the Vercel URL (it is what the MCP server puts in `review_url`) and re-run `node scripts/vercel-env.js` if you want the deployed app to know its own URL.

Limits to know: Vercel caps request bodies at 4.5 MB, so the portal accepts at most 3 photos of 1.5 MB each. `maxDuration` is 60 s, which covers the OpenAI call plus PDF plus Make.com.

## Demo data

`npm run db:seed` inserts 6 customers and 12 `DEMO-*` jobs spread over the last 20 days, with some follow-ups sent, one draft waiting, and several customers with none. It never touches non-`DEMO-` rows. Use a Neon branch if you want the demo fully separate from the client's data.
