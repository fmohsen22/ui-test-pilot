---
name: ui-test
description: Author, heal, and run UI tests as JSON scenario protocols executed by the deterministic uitp Playwright runner. Use when the user asks to "test the UI", "test the login", "write UI tests for <feature>", or "run the UI regression". The agent invents scenarios, scans the live DOM, writes one JSON file per scenario, runs it, and fixes the JSON until green.
---

# ui-test — agentic JSON-protocol UI testing

You drive a deterministic Playwright runner (`uitp`) through a strict loop:
**plan scenarios → snapshot the DOM → author JSON → run → heal → save**.
You never write Playwright code — only scenario JSON. The runner gives you
everything you need in structured JSON on stdout.

## CLI contract

All commands print exactly ONE JSON document to stdout. Exit codes:

- `0` — passed
- `1` — scenario failed → **heal it** (the output contains the failure report)
- `2` — invalid scenario JSON → fix the file per the validator errors
- `3` — infrastructure error (browser missing, app not running) → **STOP and tell the user. Never try to heal exit 3.**

If `uitp` is not on PATH, try `npx uitp` from the app's frontend package, or `node <ui-test-pilot>/dist/cli.js`.

```
uitp snapshot --url <url> [--full] [--frame <css>] [--storage-state <f>]
uitp run <scenario.json> [--until-step N] [--headed]
uitp run-all <dir> [--grep <tag>] [--retries 1] [--junit <f>] [--bail]
uitp validate <files...>
uitp init [--dir uitests] [--base-url <url>]
```

## The loop

### 0. Preflight

1. Locate `uitests/uitp.config.json` in the app repo (it sets `baseUrl`). If absent, run `uitp init --base-url <ask or infer>`.
2. `uitp snapshot --url <baseUrl>` — if exit 3, the stack isn't running; stop and tell the user how to start it (check the app's README/AGENTS.md). Never heal infra errors.
3. Check `uitests/.env.example` for required secrets; ensure `uitests/.env` exists (ask the user, never invent credentials).

### 1. Plan scenarios

From the user's feature request ("test the login"), enumerate **3–6 scenarios**: the happy path, the important negatives (wrong input, empty input), and one edge (forgot password, validation, cancel). Present the list to the user briefly, then create one file per scenario at `uitests/scenarios/<feature>/<id>.json`.

### 2. Author incrementally — only from digests

**Hard rule: never invent a selector. Every selector in your JSON must come from a digest you actually read** (`uitp snapshot` or a `run` result). Each digest element carries pre-ranked `selectors` — copy them into the step's `target` (keep ≥2 candidates when available; prefer `testid`/`role`/`label`/`id` over `css`).

For flows that navigate (login redirects, wizards, modals):
1. Author the steps you can see on the current page.
2. `uitp run <file> --until-step N` (N = last authored step). The result's `digest` shows the NEXT page.
3. Append the next page's steps. Repeat until the flow is complete.

If a digest says `"truncated": true` or `dialogOpen`, re-snapshot with `--full` or `--frame` as needed.

### 3. Heal (exit 1)

Read the `failure` object in the run output:

- `errorType: selector_not_found` → `candidatesTried` shows what failed; `domDigest` shows what's actually on the page. Replace the target with selectors from that digest.
- `errorType: assertion_failed` → the message contains the actual value. Decide: is the expectation wrong, or did the flow diverge earlier? Check `page.url`.
- `errorType: timeout` / `navigation_error` → usually a missing `waitFor` after navigation; add one (`waitFor.url` glob or a selector of the next page).
- `errorType: env_missing` → ask the user for the variable; never hardcode secrets.
- Check `consoleErrors` and `failedRequests` — a 4xx/5xx there often means the app, not your JSON, is broken. If you believe the app itself is buggy, report it as a FINDING to the user instead of bending the test until it passes.

Discipline:
- **Fix only the failing step** (and steps after it if the flow diverged). Steps with `"status": "passed"` are untouchable.
- **Never delete or weaken an assertion just to make a test pass.**
- **Max 5 heal attempts per scenario.** Then stop and report honestly: failing step, error, screenshot path (`failure.screenshot`).

### 4. Scenario rules

- Credentials/secrets: always `${ENV_VAR}` in `value`, `"secret": true`, and declared in `env.required`. Never literal passwords in JSON.
- Every scenario ends with at least one `expect` on a user-visible outcome (text, visible element, URL).
- `description` on every step = your intent in plain words (future healers rely on it).
- Negative auth tests: prefer a **nonexistent username** over a wrong password for a real account — wrong-password loops can trigger brute-force lockout and poison the happy-path test.
- Seeding/setup beyond the UI: use the `http` step (runs with session cookies). Check the app's docs for seed endpoints.
- IDs are kebab-case and unique; group files as `uitests/scenarios/<feature>/<id>.json`.

### 5. Finish

1. `uitp validate uitests/scenarios/**/*.json` — fix errors, consider warnings.
2. Run every new scenario to green.
3. `uitp run-all uitests/scenarios` for the full regression.
4. Summarize to the user: a pass/fail table, new files created, any app bugs found.

## Regression mode (no authoring)

When the user asks to "run the UI tests / regression": just `uitp run-all uitests/scenarios [--junit .uitp/junit.xml]` and report the summary. If something fails that used to be green, inspect the failure report — if the app changed legitimately, heal the scenario (same discipline as above) and say what you changed; if it looks like a real regression, report it as a bug, not a test to fix.

## Scenario JSON reference

```jsonc
{
  "schemaVersion": 1,
  "id": "auth-login-happy",            // kebab-case, unique
  "title": "Seeker logs in with valid credentials",
  "feature": "auth/login",
  "tags": ["auth", "smoke"],
  "config": {                          // all optional
    "baseUrl": "${UITP_BASE_URL}",     // overrides uitp.config.json
    "viewport": { "width": 1280, "height": 800 },
    "storageState": "states/seeker.json",      // load before run
    "saveStorageState": "states/seeker.json"   // save on success
  },
  "env": { "required": ["APP_TEST_PASSWORD"] },
  "steps": [
    { "description": "intent in plain words",   // REQUIRED on every step
      "action": "goto|click|fill|select|check|uncheck|press|hover|upload|scrollIntoView|waitFor|http|expect",
      "target": [                       // 1–5 ranked candidates, runner tries in order
        { "strategy": "testid|id|role|label|placeholder|text|css", "value": "...", "name": "(role only)", "exact": true }
      ],
      "value": "text / path / key — supports ${ENV}",
      "secret": true,                   // redact in all reports
      "frame": "css-of-iframe",         // single-level iframe scope
      "timeoutMs": 10000,
      "waitFor": { "url": "**glob**", "selector": [/*target*/], "text": "...", "state": "visible|hidden|attached", "networkIdle": true },
      "http": { "method": "POST", "url": "/api/...", "headers": {}, "body": {}, "expectStatus": 200 },
      "expect": { "type": "visible|hidden|text|value|url|title|count|enabled|disabled", "value": "...", "negate": false }
    }
  ]
}
```

Notes: `waitFor` works on any step — the action runs first, then the wait (e.g. click "Save" + `waitFor` the "Saved" toast); with `action: "waitFor"` it is the whole step. All waits, including resolving `target` / `waitFor.selector`, use the step's `timeoutMs`. `select` matches by option label first, then by value. `expect.url` value is a glob over the absolute URL (`**localhost:8180/**`). `upload` value is a file path relative to the scenario file.
