import type { Step } from '../schema/scenario.js';
import { looksSecret } from './env.js';

export const REDACTED = '«redacted»';

export function isSecretStep(step: Step): boolean {
  if (step.secret) return true;
  return step.value !== undefined && looksSecret(step.value);
}

/** Step as it may appear in reports: secret values masked. */
export function redactStep(step: Step): Step {
  if (!isSecretStep(step) || step.value === undefined) return step;
  return { ...step, value: REDACTED };
}

/** Mask every occurrence of the given secret strings inside free text (e.g. error messages). */
export function redactText(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s.length >= 3) out = out.split(s).join(REDACTED);
  }
  return out;
}
