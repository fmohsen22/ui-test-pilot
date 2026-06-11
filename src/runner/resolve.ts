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

export interface ResolvedTarget {
  locator: Locator;
  matched: TargetCandidate;
}

/**
 * Probe candidates in order with a short existence check each; return the
 * first that resolves to >= 1 element. Total budget ≈ probeMs per candidate.
 */
export async function resolveTarget(
  scope: Page | Frame,
  target: Target,
  probeMs = 1500,
): Promise<ResolvedTarget> {
  const attempts: CandidateAttempt[] = [];
  for (const candidate of target) {
    const locator = locatorFor(scope, candidate).first();
    try {
      await locator.waitFor({ state: 'attached', timeout: probeMs });
      return { locator, matched: candidate };
    } catch {
      attempts.push({
        strategy: candidate.strategy,
        value: candidate.value,
        ...(candidate.name ? { name: candidate.name } : {}),
        error: '0 elements',
      });
    }
  }
  throw new NoCandidateMatchedError(attempts);
}
