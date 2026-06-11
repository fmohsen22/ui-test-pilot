import { Scenario, type Step } from './scenario.js';
import { findEnvRefs, looksSecret } from '../util/env.js';

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  /** Lint-style, non-fatal. */
  warnings: ValidationIssue[];
  scenario?: Scenario;
}

export function validateScenario(raw: unknown): ValidationResult {
  const parsed = Scenario.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      })),
      warnings: [],
    };
  }
  const scenario = parsed.data;
  const warnings: ValidationIssue[] = [];
  const declared = new Set(scenario.env?.required ?? []);

  scenario.steps.forEach((step: Step, i: number) => {
    const at = `steps.${i}`;
    if (step.target && step.target.every((c) => c.strategy === 'css')) {
      warnings.push({
        path: at,
        message: 'all target candidates are css — add a semantic fallback (role/label/testid/id)',
      });
    }
    if (step.value !== undefined) {
      for (const ref of findEnvRefs(step.value)) {
        if (!declared.has(ref)) {
          warnings.push({ path: at, message: `\${${ref}} used but not declared in env.required` });
        }
      }
      const fillsPasswordField =
        step.action === 'fill' &&
        step.target?.some((c) => /pass(word)?/i.test(`${c.value} ${c.name ?? ''}`));
      if (fillsPasswordField && !step.secret && !looksSecret(step.value)) {
        warnings.push({
          path: at,
          message: 'fill into a password-looking field without "secret": true and without ${ENV} value',
        });
      }
    }
  });

  const last = scenario.steps[scenario.steps.length - 1];
  if (last.action !== 'expect' && !scenario.steps.some((s) => s.action === 'expect')) {
    warnings.push({
      path: 'steps',
      message: 'scenario has no expect step — it asserts nothing user-visible',
    });
  }

  return { valid: true, errors: [], warnings, scenario };
}
