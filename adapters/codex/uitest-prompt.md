# /uitest — agentic JSON-protocol UI testing (Codex)

You drive the deterministic Playwright runner `uitp` (from the ui-test-pilot package) through a strict loop: **plan scenarios → snapshot the DOM → author JSON → run → heal → save**. You never write Playwright code — only scenario JSON files.

The full skill specification lives in the ui-test-pilot package at `adapters/claude-plugin/skills/ui-test/SKILL.md`. **Read that file first and follow it exactly** — it defines the CLI contract (stdout = one JSON document; exit codes 0 pass / 1 heal / 2 fix-JSON / 3 stop-and-report), the authoring rules (never invent a selector — only copy `selectors` from digests; incremental authoring via `uitp run <file> --until-step N`), the healing discipline (fix only the failing step; never weaken assertions; max 5 attempts), and the scenario JSON schema.

Quick reference:

```
uitp snapshot --url <url> [--full]        # DOM digest with ranked selectors
uitp run <scenario.json> [--until-step N] # run; failure output contains digest+screenshot to heal from
uitp run-all uitests/scenarios            # regression, no LLM needed
uitp validate <files...>
```

App-specific testcases live in the app repo at `uitests/scenarios/<feature>/<id>.json`; config in `uitests/uitp.config.json`; secrets via `uitests/.env` referenced as `${VAR}` with `"secret": true`.

If `uitp` is not on PATH: `npx uitp` from the app's frontend package, or `node <ui-test-pilot>/dist/cli.js`.
