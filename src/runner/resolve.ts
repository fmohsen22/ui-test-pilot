import type { Locator, Page, Frame } from 'playwright';
import type { Target, TargetCandidate } from '../schema/scenario.js';
import type { CandidateAttempt } from '../report/result.js';

export function locatorFor(scope: Page | Frame, c: TargetCandidate): Locator {
  switch (c.strategy) {
    case 'testid':
      return scope.getByTestId(c.value);
    case 'id':
      return scope.locator(`#${cssEscape(c.value.replace(/^#/, ''))}`);
    case 'role':
      // Playwright's role types are a string union; scenario JSON can't enumerate them all.
      return scope.getByRole(c.value as Parameters<Page['getByRole']>[0], {
        name: c.name,
        exact: c.exact,
      });
    case 'label':
      return scope.getByLabel(c.value, { exact: c.exact });
    case 'placeholder':
      return scope.getByPlaceholder(c.value, { exact: c.exact });
    case 'text':
      return scope.getByText(c.value, { exact: c.exact });
    case 'css':
      return scope.locator(c.value);
  }
}

function cssEscape(s: string): string {
  return s.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

export class NoCandidateMatchedError extends Error {
  constructor(public readonly attempts: CandidateAttempt[]) {
    super(
      `No target candidate matched: ${attempts
        .map((a) => `${a.strategy}=${JSON.stringify(a.value)} (${a.error})`)
        .join('; ')}`,
    );
    this.name = 'NoCandidateMatchedError';
  }
}

/** Re-check interval once the initial ranked probe pass found nothing. */
const POLL_MS = 200;

export interface ResolvedTarget {
  locator: Locator;
  matched: TargetCandidate;
}

/**
 * Probe candidates in order with a short existence check each; return the
 * first that resolves to >= 1 element. If none matched and `timeoutMs` has not
 * elapsed yet, keep polling all candidates (still in rank order) until it has —
 * so an element that appears after a slow server round trip is still found.
 * Total budget ≈ max(probeMs per candidate, timeoutMs).
 */
export async function resolveTarget(
  scope: Page | Frame,
  target: Target,
  probeMs = 1500,
  timeoutMs = 0,
): Promise<ResolvedTarget> {
  const deadline = Date.now() + timeoutMs;
  for (const candidate of target) {
    const locator = locatorFor(scope, candidate).first();
    try {
      await locator.waitFor({ state: 'attached', timeout: probeMs });
      return { locator, matched: candidate };
    } catch {
      // Not attached within the probe — try the next candidate.
    }
  }
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, Math.max(deadline - Date.now(), 0))));
    for (const candidate of target) {
      const locator = locatorFor(scope, candidate).first();
      if ((await locator.count().catch(() => 0)) > 0) return { locator, matched: candidate };
    }
  }
  throw new NoCandidateMatchedError(
    target.map((candidate) => ({
      strategy: candidate.strategy,
      value: candidate.value,
      ...(candidate.name ? { name: candidate.name } : {}),
      error: '0 elements',
    })),
  );
}
