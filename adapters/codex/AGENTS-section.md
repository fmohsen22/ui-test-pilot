# Paste-into-AGENTS.md block

Add the following section to the consuming app's `AGENTS.md` (adjust paths):

---

## Agentic UI tests (ui-test-pilot)

UI testcases are JSON scenario protocols under `uitests/scenarios/`, executed by the deterministic `uitp` runner (ui-test-pilot package). Any agent asked to "test the UI of <feature>" must follow the loop defined in the ui-test-pilot skill: `<path-to-ui-test-pilot>/adapters/claude-plugin/skills/ui-test/SKILL.md` — read it before authoring.

- Run one scenario: `uitp run uitests/scenarios/<feature>/<id>.json`
- Full regression (no LLM): `uitp run-all uitests/scenarios`
- Config: `uitests/uitp.config.json`; secrets in `uitests/.env` (see `.env.example`), referenced as `${VAR}`.
- The app stack must be running first (see Build, test, run).
