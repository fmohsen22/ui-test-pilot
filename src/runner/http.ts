import type { BrowserContext } from 'playwright';
import type { HttpSpec } from '../schema/scenario.js';
import { interpolate } from '../util/env.js';

export class HttpStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpStepError';
  }
}

function interpolateBody(body: unknown): unknown {
  if (typeof body === 'string') return interpolate(body);
  if (Array.isArray(body)) return body.map(interpolateBody);
  if (body && typeof body === 'object') {
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, interpolateBody(v)]),
    );
  }
  return body;
}

/** Runs via context.request so session cookies apply (e.g. seed endpoints behind auth). */
export async function runHttpStep(
  context: BrowserContext,
  spec: HttpSpec,
  baseUrl: string,
): Promise<void> {
  const rawUrl = interpolate(spec.url);
  const url = /^https?:\/\//.test(rawUrl) ? rawUrl : new URL(rawUrl, baseUrl).toString();
  const headers = spec.headers
    ? Object.fromEntries(Object.entries(spec.headers).map(([k, v]) => [k, interpolate(v)]))
    : undefined;

  const response = await context.request.fetch(url, {
    method: spec.method,
    headers,
    ...(spec.body !== undefined ? { data: interpolateBody(spec.body) } : {}),
  });

  const expected = spec.expectStatus;
  if (expected !== undefined ? response.status() !== expected : response.status() >= 400) {
    const text = (await response.text().catch(() => '')).slice(0, 300);
    throw new HttpStepError(
      `${spec.method} ${url} → ${response.status()}${expected !== undefined ? ` (expected ${expected})` : ''}${text ? `: ${text}` : ''}`,
    );
  }
}
