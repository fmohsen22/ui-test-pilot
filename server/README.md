# uitp-server — chat-driven UI testing with a self-healing regression UI

A Quarkus web app on top of the [ui-test-pilot](../README.md) runner. Deploy it
next to any web application and your team gets:

- **Chat** (menu 1): describe a test in plain language ("test the login with a
  wrong username"). The built-in agent snapshots the live page, writes the
  scenario JSON, runs it and heals it until green. Every user has their own
  chat history.
- **Regression Tests** (menu 2): the whole suite as a tree (topic folders →
  test cases). Click a test case to see its steps rendered in plain language,
  edit the JSON, and re-run it with the self-healing loop.
- **Simple team login**: register with email, name and position. Admins see
  all users, all chats, and the full event/error log.
- **Storage**: users/chats/logs in PostgreSQL; the test cases themselves stay
  plain JSON files on disk (reviewable, diffable, git-friendly).
- **Bring your own model**: any OpenAI-compatible chat-completions API — the
  official OpenAI API, or an internal gateway with the same contract. Base
  URL, key and model are plain config. (The CLI-based Claude Code / Codex
  adapters in `../adapters/` keep working independently of this server.)

## Requirements (macOS and Windows)

| What | Why |
|---|---|
| JDK 21+ | runs the Quarkus server |
| Docker (Desktop) | PostgreSQL (+ optional pgAdmin) via one command |
| Node.js >= 22 | the uitp Playwright runner |

## Install & run

```bash
git clone https://github.com/fmohsen22/ui-test-pilot
cd ui-test-pilot/server
./run.sh        # macOS/Linux
run.bat         # Windows
```

That single command starts PostgreSQL (+ pgAdmin at http://localhost:5545,
admin@uitp.local / uitp), builds the runner if needed, and starts the server
at **http://localhost:8088**. The first registered user automatically becomes
admin.

## Pointing it at YOUR application

Set these (env vars or edit `src/main/resources/application.properties`):

```bash
export UITP_PROJECT_DIR=/path/to/your-app/uitests   # contains uitp.config.json + scenarios/
export UITP_LLM_BASE_URL=https://api.openai.com/v1  # or your internal OpenAI-compatible gateway
export UITP_LLM_API_KEY=sk-...
export UITP_LLM_MODEL=gpt-4o                        # or your internal model name
export UITP_ADMIN_EMAILS=qa-lead@your-company.com   # extra admins (optional)
```

Run `npx uitp init` in your app repo once to scaffold the `uitests/` folder
(see the root README). The app under test must be reachable from this server.

Without an API key the server still runs: login, chat history, the regression
tree, plain-language explanations, editing and plain runs all work — only the
chat agent and the self-heal loop need the model.

## Production notes

- `./mvnw package` then `java -jar target/quarkus-app/quarkus-run.jar` for a
  standalone deployment (systemd/service wrapper of your choice).
- Override DB coordinates via `UITP_DB_URL`, `UITP_DB_USER`, `UITP_DB_PASSWORD`.
- Sessions are bearer tokens (default 72h, `UITP_SESSION_HOURS`).
- This is an **internal tool**: put it behind your VPN/intranet; it has no
  rate limiting or email verification by design.
