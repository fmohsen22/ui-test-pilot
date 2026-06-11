import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const SelectorStrategy = z.enum([
  'testid',
  'id',
  'role',
  'label',
  'placeholder',
  'text',
  'css',
]);
export type SelectorStrategy = z.infer<typeof SelectorStrategy>;

export const TargetCandidate = z.object({
  strategy: SelectorStrategy,
  value: z.string().min(1),
  /** Accessible name, only meaningful for strategy "role". */
  name: z.string().optional(),
  exact: z.boolean().optional(),
});
export type TargetCandidate = z.infer<typeof TargetCandidate>;

export const Target = z.array(TargetCandidate).min(1).max(5);
export type Target = z.infer<typeof Target>;

export const WaitForSpec = z
  .object({
    /** URL glob over the absolute URL, e.g. "**localhost:4201/**" */
    url: z.string().optional(),
    selector: Target.optional(),
    text: z.string().optional(),
    state: z.enum(['visible', 'hidden', 'attached']).default('visible'),
    networkIdle: z.boolean().optional(),
  })
  .refine((w) => w.url || w.selector || w.text || w.networkIdle, {
    message: 'waitFor needs at least one of: url, selector, text, networkIdle',
  });
export type WaitForSpec = z.infer<typeof WaitForSpec>;

export const HttpSpec = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** Absolute, or relative to config.baseUrl. Supports ${ENV} interpolation. */
  url: z.string().min(1),
  headers: z.record(z.string()).optional(),
  /** JSON body; string values support ${ENV} interpolation. */
  body: z.unknown().optional(),
  expectStatus: z.number().int().optional(),
});
export type HttpSpec = z.infer<typeof HttpSpec>;

export const ExpectType = z.enum([
  'visible',
  'hidden',
  'text',
  'value',
  'url',
  'title',
  'count',
  'enabled',
  'disabled',
]);

export const ExpectSpec = z.object({
  type: ExpectType,
  /** Expected text/value/glob/count depending on type. */
  value: z.union([z.string(), z.number()]).optional(),
  negate: z.boolean().optional(),
});
export type ExpectSpec = z.infer<typeof ExpectSpec>;

export const Action = z.enum([
  'goto',
  'click',
  'fill',
  'select',
  'check',
  'uncheck',
  'press',
  'hover',
  'upload',
  'scrollIntoView',
  'waitFor',
  'http',
  'expect',
]);
export type Action = z.infer<typeof Action>;

export const Step = z
  .object({
    /** The agent's intent in plain words — critical for healing. */
    description: z.string().min(1),
    action: Action,
    target: Target.optional(),
    /** fill/select/press text, goto path, upload file path. Supports ${ENV}. */
    value: z.string().optional(),
    /** Redact value in all reports and digests. */
    secret: z.boolean().optional(),
    /** Scope element lookup to a single-level iframe (css selector for the iframe element). */
    frame: z.string().optional(),
    timeoutMs: z.number().int().min(100).max(120_000).optional(),
    waitFor: WaitForSpec.optional(),
    http: HttpSpec.optional(),
    expect: ExpectSpec.optional(),
  })
  .superRefine((s, ctx) => {
    const needsTarget: Action[] = [
      'click',
      'fill',
      'select',
      'check',
      'uncheck',
      'hover',
      'upload',
      'scrollIntoView',
    ];
    if (needsTarget.includes(s.action) && !s.target) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action "${s.action}" requires "target"` });
    }
    const needsValue: Action[] = ['goto', 'fill', 'select', 'press', 'upload'];
    if (needsValue.includes(s.action) && s.value === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `action "${s.action}" requires "value"` });
    }
    if (s.action === 'waitFor' && !s.waitFor) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'action "waitFor" requires "waitFor"' });
    }
    if (s.action === 'http' && !s.http) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'action "http" requires "http"' });
    }
    if (s.action === 'expect') {
      if (!s.expect) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'action "expect" requires "expect"' });
      } else {
        const needsTargetExpect = ['visible', 'hidden', 'text', 'value', 'count', 'enabled', 'disabled'];
        if (needsTargetExpect.includes(s.expect.type) && !s.target) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `expect type "${s.expect.type}" requires "target"`,
          });
        }
        const needsExpectValue = ['text', 'value', 'url', 'title', 'count'];
        if (needsExpectValue.includes(s.expect.type) && s.expect.value === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `expect type "${s.expect.type}" requires "expect.value"`,
          });
        }
      }
    }
  });
export type Step = z.infer<typeof Step>;

export const ScenarioConfig = z.object({
  /** Overrides uitp.config.json baseUrl. Supports ${ENV}. */
  baseUrl: z.string().optional(),
  viewport: z.object({ width: z.number().int(), height: z.number().int() }).optional(),
  /** Path (relative to the scenario file's uitests dir) of a storage state to load before the run. */
  storageState: z.string().optional(),
  /** Path to save the storage state to after a successful run. */
  saveStorageState: z.string().optional(),
});
export type ScenarioConfig = z.infer<typeof ScenarioConfig>;

export const Scenario = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be kebab-case ([a-z0-9-])'),
  title: z.string().min(1),
  /** Concept grouping, e.g. "auth/login". */
  feature: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  config: ScenarioConfig.optional(),
  env: z.object({ required: z.array(z.string()).default([]) }).optional(),
  steps: z.array(Step).min(1),
});
export type Scenario = z.infer<typeof Scenario>;
