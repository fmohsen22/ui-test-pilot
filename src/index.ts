/** Library API — the v2 orchestrator (OpenRouter etc.) builds on these. */
export { runScenario, type RunOptions } from './runner/run.js';
export { captureDigest, waitForDomQuiet, type DomDigest, type DigestElement } from './snapshot/digest.js';
export { validateScenario, type ValidationResult } from './schema/validate.js';
export { Scenario, Step, TargetCandidate, SCHEMA_VERSION } from './schema/scenario.js';
export { openSession, type BrowserSession } from './runner/browser.js';
export { discoverConfig, type UitpConfig } from './config.js';
export type { RunResult, FailureReport, StepResult } from './report/result.js';
export { toJUnitXml } from './report/junit.js';
