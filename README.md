# ui-test-pilot

Agent-driven, JSON-protocol UI testing.

An AI agent (Claude Code, Codex — later any model via OpenRouter) **authors and heals** UI test scenarios as plain JSON files; a **deterministic Playwright runner** (`uitp`) executes them. Once a scenario is green it is saved as a testcase, and the whole suite replays as a regression run with **zero LLM involvement**.

```
┌─────────┐  "test the login"   ┌──────────────┐
│  Agent   │ ──────────────────▶ │ plan 3–6     │
│ (Claude/ │                     │ scenarios    │
│  Codex)  │                     └──────┬───────┘
└────┬─────┘                            │
     │  uitp snapshot --url …           ▼
     │ ◀──── DOM digest (ranked selectors per element)
     │  writes scenarios/<feature>/<id>.json
     │  uitp run <id>.json [--until-step N]
     │ ◀──── pass ✓  /  failure report (failed step, error,
     │        fresh DOM digest, screenshot, console errors)
     │  fixes ONLY the failing step … re-run … green ✓
     ▼
  saved testcase  ──▶  later:  uitp run-all scenarios/   (no LLM)
```

## Why JSON protocols instead of generated Playwright code?

- **Healable**: a failed run returns a machine-readable failure report with a fresh DOM digest — the agent fixes one step, not a code file.
- **Deterministic regression**: replaying JSON through a fixed runner has no generation variance.
- **Model-agnostic**: any model that can read/write JSON can drive it. The CLI prints exactly one JSON document per command.
- **Reviewable**: testcases diff like data, with a human-readable `description` per step.

## Install

```bash
nvm use 22                      # Node >= 22 required
npm install
npx playwright install chromium
npm run build                   # tsc → dist/, exposes the `uitp` bin
```

In a consuming app, add it as a file dependency (`"ui-test-pilot": "file:../ui-test-pilot"`) or run via `node <here>/dist/cli.js`.

## CLI

stdout is always **exactly one JSON document**; progress goes to stderr.
Exit codes: `0` pass · `1` scenario failed (healable) · `2` invalid scenario JSON · `3` infrastructure error (don't heal — fix the environment).

```bash
uitp init [--dir uitests] [--base-url http://localhost:4200]   # scaffold in an app repo
uitp snapshot --url <url> [--full] [--frame <css>] [--storage-state <f>]
uitp run <scenario.json> [--until-step N] [--headed] [--artifacts-dir d]
uitp run-all <dir> [--grep tag] [--retries 1] [--junit f.xml] [--json f.json] [--bail]
uitp validate <files...>
```

`--until-step N` runs steps `0..N` and returns the resulting page's digest — that's how an agent authors multi-page flows incrementally (login redirects, wizards, modals).

## Scenario JSON

See [examples/](examples/) and the full schema reference in [adapters/claude-plugin/skills/ui-test/SKILL.md](adapters/claude-plugin/skills/ui-test/SKILL.md). Essentials:

- Versioned: `"schemaVersion": 1`.
- Each step: `description` (intent), `action`, ranked `target` candidates (`testid|id|role|label|placeholder|text|css` — runner probes in order, records the match).
- Secrets: `"value": "${MY_PASSWORD}"` + `"secret": true` + `env.required` — values are redacted in every report. `.env` next to `uitp.config.json` is loaded automatically.
- `http` steps call APIs (seeding) with the browser session's cookies.
- `storageState` load/save for "already logged in" suites.

## Agent adapters

- **Claude Code**: install [adapters/claude-plugin/](adapters/claude-plugin/) as a plugin, or copy/symlink `adapters/claude-plugin/skills/ui-test/` into a project's `.claude/skills/`. Then: *"test the login"*.
- **Codex**: copy [adapters/codex/uitest-prompt.md](adapters/codex/uitest-prompt.md) to `~/.codex/prompts/uitest.md` and/or add [adapters/codex/AGENTS-section.md](adapters/codex/AGENTS-section.md) to the app's `AGENTS.md`.
- **uitp-server (v2)**: a self-hosted Quarkus web app in [server/](server/) — chat UI (any OpenAI-compatible model authors/heals scenarios through the runner), a regression-suite browser with plain-language step rendering and a one-click run + self-heal loop, simple team login with per-user history and an admin view. See [server/README.md](server/README.md).

## App-side layout (created by `uitp init`)

```
uitests/
├── uitp.config.json   # { "baseUrl": "...", "artifactsDir": ".uitp" }
├── .env               # secrets (gitignored), .env.example committed
├── scenarios/<feature>/<id>.json
└── states/            # storage states (gitignored)
```

## Development

```bash
npm test    # vitest: schema, snapshot, runner, healing-contract specs
            # runs against a local HTML fixture site — no external app needed
```
