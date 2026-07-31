import type { Step, TargetCandidate } from '../schema/scenario.js';
import type { DomDigest } from '../snapshot/digest.js';

export type RunStatus = 'passed' | 'failed' | 'invalid' | 'error';

export type ErrorType =
  | 'selector_not_found'
  | 'assertion_failed'
  | 'timeout'
  | 'navigation_error'
  | 'http_error'
  | 'env_missing';

export interface StepResult {
  index: number;
  action: string;
  description: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  matchedSelector: TargetCandidate | null;
}

export interface CandidateAttempt {
  strategy: string;
  value: string;
  name?: string;
  error: string;
}

export interface FailureReport {
  stepIndex: number;
  /** Verbatim failing step, secrets redacted. */
  step: Step;
  errorType: ErrorType;
  message: string;
  candidatesTried: CandidateAttempt[];
  page: { url: string; title: string } | null;
  domDigest: DomDigest | null;
  screenshot: string | null;
  consoleErrors: string[];
  failedRequests: { method: string; url: string; status: number }[];
}

export interface RunResult {
  schemaVersion: 1;
  scenarioId: string;
  scenarioFile: string;
  status: RunStatus;
  untilStep: number | null;
  startedAt: string;
  durationMs: number;
  steps: StepResult[];
  failure: FailureReport | null;
  /** DomDigest of the final page — only populated with --until-step (incremental authoring). */
  digest: DomDigest | null;
  storageStateSaved: string | null;
  artifactsDir: string | null;
  /** Screenshot of the final page state — captured on EVERY run (pass and fail). */
  finalScreenshot: string | null;
}
