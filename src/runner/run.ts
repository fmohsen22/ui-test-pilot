import fs from 'node:fs';
import path from 'node:path';
import type { Scenario, Step } from '../schema/scenario.js';
import { validateScenario } from '../schema/validate.js';
import { captureDigest, type DomDigest } from '../snapshot/digest.js';
import { openSession, InfrastructureError, type BrowserSession } from './browser.js';
import { executeStep, DEFAULT_STEP_TIMEOUT } from './steps.js';
import { NoCandidateMatchedError } from './resolve.js';
import { AssertionFailedError } from './asserts.js';
import { HttpStepError } from './http.js';
import { MissingEnvError, interpolate, findEnvRefs } from '../util/env.js';
import { redactStep, redactText, isSecretStep } from '../util/redact.js';
import type { ErrorType, FailureReport, RunResult, StepResult } from '../report/result.js';

export interface RunOptions {
  scenarioFile: string;
  baseUrl: string;
  artifactsRoot: string;
  untilStep?: number;
  headed?: boolean;
}

function classifyError(e: unknown): ErrorType {
  if (e instanceof NoCandidateMatchedError) return 'selector_not_found';
  if (e instanceof AssertionFailedError) return 'assertion_failed';
  if (e instanceof HttpStepError) return 'http_error';
  if (e instanceof MissingEnvError) return 'env_missing';
  const msg = (e as Error)?.message ?? '';
  if (/Timeout|timeout/.test(msg)) return 'timeout';
  if (/net::|NS_ERROR|Navigation|ERR_/.test(msg)) return 'navigation_error';
  return 'timeout';
}

function collectSecrets(scenario: Scenario): string[] {
  const secrets: string[] = [];
  for (const step of scenario.steps) {
    if (step.value !== undefined && isSecretStep(step)) {
      try {
        secrets.push(interpolate(step.value));
      } catch {
        // missing env var — nothing to redact
      }
      for (const ref of findEnvRefs(step.value)) {
        const v = process.env[ref];
        if (v) secrets.push(v);
      }
    }
  }
  return secrets;
}

export async function runScenario(opts: RunOptions): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const scenarioFile = path.resolve(opts.scenarioFile);

  const base: RunResult = {
    schemaVersion: 1,
    scenarioId: path.basename(scenarioFile, '.json'),
    scenarioFile,
    status: 'invalid',
    untilStep: opts.untilStep ?? null,
    startedAt,
    durationMs: 0,
    steps: [],
    failure: null,
    digest: null,
    storageStateSaved: null,
    artifactsDir: null,
    finalScreenshot: null,
  };

  // Parse + validate (exit-code-2 territory).
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));
  } catch (e) {
    base.failure = invalidFailure(`Cannot read/parse JSON: ${(e as Error).message}`);
    base.durationMs = Date.now() - t0;
    return base;
  }
  const validation = validateScenario(raw);
  if (!validation.valid || !validation.scenario) {
    base.failure = invalidFailure(
      'Schema validation failed: ' +
        validation.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
    );
    base.durationMs = Date.now() - t0;
    return base;
  }
  const scenario = validation.scenario;
  base.scenarioId = scenario.id;

  // Required env vars present?
  const missing = (scenario.env?.required ?? []).filter((v) => process.env[v] === undefined);
  if (missing.length > 0) {
    base.failure = {
      ...invalidFailure(`Missing required environment variable(s): ${missing.join(', ')}`),
      errorType: 'env_missing',
    };
    base.durationMs = Date.now() - t0;
    return base;
  }

  const artifactsDir = path.join(opts.artifactsRoot, scenario.id);
  fs.mkdirSync(artifactsDir, { recursive: true });
  base.artifactsDir = artifactsDir;

  const scenarioDir = path.dirname(scenarioFile);
  const baseUrl = scenario.config?.baseUrl ? interpolate(scenario.config.baseUrl) : opts.baseUrl;
  const storageStatePath = scenario.config?.storageState
    ? path.resolve(scenarioDir, scenario.config.storageState)
    : undefined;

  let session: BrowserSession;
  try {
    session = await openSession({
      headed: opts.headed,
      viewport: scenario.config?.viewport,
      storageStatePath,
    });
  } catch (e) {
    base.status = 'error';
    base.failure = invalidFailure((e as InfrastructureError).message);
    base.durationMs = Date.now() - t0;
    return base;
  }

  const secrets = collectSecrets(scenario);
  const lastIndex =
    opts.untilStep !== undefined
      ? Math.min(opts.untilStep, scenario.steps.length - 1)
      : scenario.steps.length - 1;

  try {
    for (let i = 0; i <= lastIndex; i++) {
      const step: Step = scenario.steps[i];
      const stepStart = Date.now();
      try {
        const matched = await executeStep(
          { session, baseUrl, scenarioDir },
          step,
        );
        base.steps.push({
          index: i,
          action: step.action,
          description: step.description,
          status: 'passed',
          durationMs: Date.now() - stepStart,
          matchedSelector: matched,
        });
      } catch (e) {
        base.steps.push({
          index: i,
          action: step.action,
          description: step.description,
          status: 'failed',
          durationMs: Date.now() - stepStart,
          matchedSelector: null,
        });
        // Remaining steps are skipped.
        for (let j = i + 1; j <= lastIndex; j++) {
          const s = scenario.steps[j];
          base.steps.push({
            index: j,
            action: s.action,
            description: s.description,
            status: 'skipped',
            durationMs: 0,
            matchedSelector: null,
          });
        }
        base.status = 'failed';
        base.failure = await buildFailure(session, step, i, e, artifactsDir, secrets);
        base.finalScreenshot = await captureFinal(session, artifactsDir);
        base.durationMs = Date.now() - t0;
        writeResult(artifactsDir, base);
        return base;
      }
    }

    // All requested steps passed.
    base.status = 'passed';
    if (opts.untilStep !== undefined) {
      base.digest = await captureDigest(session.page);
    }
    if (scenario.config?.saveStorageState && opts.untilStep === undefined) {
      const out = path.resolve(scenarioDir, scenario.config.saveStorageState);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await session.context.storageState({ path: out });
      base.storageStateSaved = out;
    }
    base.finalScreenshot = await captureFinal(session, artifactsDir);
    base.durationMs = Date.now() - t0;
    writeResult(artifactsDir, base);
    return base;
  } finally {
    await session.close();
  }
}

async function captureFinal(session: BrowserSession, artifactsDir: string): Promise<string | null> {
  try {
    const p = path.join(artifactsDir, 'final.png');
    await session.page.screenshot({ path: p, fullPage: false });
    return p;
  } catch {
    return null;
  }
}

function invalidFailure(message: string): FailureReport {
  return {
    stepIndex: -1,
    step: { description: '(scenario-level)', action: 'expect' } as unknown as Step,
    errorType: 'env_missing',
    message,
    candidatesTried: [],
    page: null,
    domDigest: null,
    screenshot: null,
    consoleErrors: [],
    failedRequests: [],
  };
}

async function buildFailure(
  session: BrowserSession,
  step: Step,
  stepIndex: number,
  error: unknown,
  artifactsDir: string,
  secrets: string[],
): Promise<FailureReport> {
  const { page } = session;
  let domDigest: DomDigest | null = null;
  let pageInfo: { url: string; title: string } | null = null;
  let screenshot: string | null = null;
  try {
    pageInfo = { url: page.url(), title: await page.title() };
    domDigest = await captureDigest(page);
  } catch {
    // Page may be gone (browser crash) — keep what we have.
  }
  try {
    screenshot = path.join(artifactsDir, `fail-step-${stepIndex}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
  } catch {
    screenshot = null;
  }
  const rawMessage = (error as Error)?.message ?? String(error);
  return {
    stepIndex,
    step: redactStep(step),
    errorType: classifyError(error),
    message: redactText(rawMessage.split('\n').slice(0, 4).join(' '), secrets),
    candidatesTried: error instanceof NoCandidateMatchedError ? error.attempts : [],
    page: pageInfo,
    domDigest,
    screenshot,
    consoleErrors: [...session.consoleErrors],
    failedRequests: [...session.failedRequests],
  };
}

function writeResult(artifactsDir: string, result: RunResult): void {
  try {
    fs.writeFileSync(path.join(artifactsDir, 'result.json'), JSON.stringify(result, null, 2));
  } catch {
    // Artifacts are best-effort.
  }
}
