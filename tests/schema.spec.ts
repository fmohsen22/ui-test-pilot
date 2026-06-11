import { describe, expect, it } from 'vitest';
import { validateScenario } from '../src/schema/validate.js';
import { interpolate, MissingEnvError, looksSecret } from '../src/util/env.js';
import { redactStep, REDACTED } from '../src/util/redact.js';
import type { Step } from '../src/schema/scenario.js';

const minimal = (steps: unknown[]) => ({
  schemaVersion: 1,
  id: 'test-scenario',
  title: 'Test',
  feature: 'test',
  steps,
});

describe('scenario schema', () => {
  it('accepts a minimal valid scenario', () => {
    const r = validateScenario(
      minimal([{ description: 'go home', action: 'goto', value: '/' }]),
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('rejects wrong schemaVersion and bad id', () => {
    const r = validateScenario({ ...minimal([{ description: 'x', action: 'goto', value: '/' }]), schemaVersion: 2, id: 'Bad_ID' });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects element action without target', () => {
    const r = validateScenario(minimal([{ description: 'click it', action: 'click' }]));
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toContain('requires "target"');
  });

  it('rejects expect without value where needed', () => {
    const r = validateScenario(
      minimal([{ description: 'check url', action: 'expect', expect: { type: 'url' } }]),
    );
    expect(r.valid).toBe(false);
  });

  it('warns on css-only targets and undeclared env refs', () => {
    const r = validateScenario(
      minimal([
        {
          description: 'fill user',
          action: 'fill',
          target: [{ strategy: 'css', value: '#user' }],
          value: '${SOME_VAR}',
        },
        { description: 'assert', action: 'expect', target: [{ strategy: 'id', value: 'x' }], expect: { type: 'visible' } },
      ]),
    );
    expect(r.valid).toBe(true);
    const messages = r.warnings.map((w) => w.message).join('\n');
    expect(messages).toContain('css');
    expect(messages).toContain('SOME_VAR');
  });

  it('warns when scenario has no expect step', () => {
    const r = validateScenario(minimal([{ description: 'go', action: 'goto', value: '/' }]));
    expect(r.warnings.some((w) => w.message.includes('no expect'))).toBe(true);
  });
});

describe('env interpolation + redaction', () => {
  it('interpolates ${VAR}', () => {
    process.env.UITP_TEST_VAR = 'hello';
    expect(interpolate('say ${UITP_TEST_VAR}!')).toBe('say hello!');
  });

  it('throws MissingEnvError listing missing vars', () => {
    expect(() => interpolate('${UITP_NOPE_A} ${UITP_NOPE_B}')).toThrowError(MissingEnvError);
  });

  it('treats PASS/SECRET/TOKEN vars as secret', () => {
    expect(looksSecret('${MY_PASSWORD}')).toBe(true);
    expect(looksSecret('${MY_USERNAME}')).toBe(false);
  });

  it('redacts secret step values', () => {
    const step: Step = {
      description: 'fill pw',
      action: 'fill',
      target: [{ strategy: 'id', value: 'password' }],
      value: 'super-secret',
      secret: true,
    };
    expect(redactStep(step).value).toBe(REDACTED);
  });
});
