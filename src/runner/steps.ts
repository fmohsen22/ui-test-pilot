import type { Frame, Page } from 'playwright';
import path from 'node:path';
import type { Step, TargetCandidate, WaitForSpec } from '../schema/scenario.js';
import { interpolate } from '../util/env.js';
import { resolveTarget, locatorFor } from './resolve.js';
import { runExpect, urlGlobToRegExp } from './asserts.js';
import { runHttpStep } from './http.js';
import { waitForDomQuiet } from '../snapshot/digest.js';
import type { BrowserSession } from './browser.js';

export const DEFAULT_STEP_TIMEOUT = 10_000;

export interface StepContext {
  session: BrowserSession;
  baseUrl: string;
  /** Directory scenario-relative paths (upload files) resolve against. */
  scenarioDir: string;
}

async function scopeFor(page: Page, step: Step): Promise<Page | Frame> {
  if (!step.frame) return page;
  const handle = await page.$(step.frame);
  const frame = handle ? await handle.contentFrame() : null;
  if (!frame) throw new Error(`iframe not found for selector: ${step.frame}`);
  return frame;
}

/**
 * Execute one step. Returns the matched selector for element actions.
 *
 * A `waitFor` block is honoured on every step, not only on `action: "waitFor"`:
 * the action runs first, then the wait (e.g. click "Save" → wait for "Saved").
 */
export async function executeStep(ctx: StepContext, step: Step): Promise<TargetCandidate | null> {
  const timeout = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT;
  const matched = await performAction(ctx, step, timeout);
  if (step.waitFor) {
    try {
      await waitForCondition(ctx.session.page, step, step.waitFor, timeout);
    } catch (e) {
      // Tell the healer the action itself succeeded and only the wait failed.
      if (step.action !== 'waitFor' && e instanceof Error) {
        e.message = `waitFor after ${step.action}: ${e.message}`;
      }
      throw e;
    }
  }
  return matched;
}

async function waitForCondition(
  page: Page,
  step: Step,
  w: WaitForSpec,
  timeout: number,
): Promise<void> {
  if (w.url) {
    await page.waitForURL(urlGlobToRegExp(interpolate(w.url)), { timeout });
  }
  if (w.selector) {
    const scope = await scopeFor(page, step);
    if (w.state === 'hidden') {
      // A detached element counts as hidden — don't require it to resolve first.
      // Every candidate must be hidden, so a stale candidate can't pass early.
      await Promise.all(
        w.selector.map((c) => locatorFor(scope, c).first().waitFor({ state: 'hidden', timeout })),
      );
    } else {
      // Attachment gets the full step timeout too (not just the 1.5 s probe):
      // the element often appears only after a server round trip.
      const { locator } = await resolveTarget(scope, w.selector, undefined, timeout);
      await locator.waitFor({ state: w.state, timeout });
    }
  }
  if (w.text) {
    await page
      .getByText(interpolate(w.text))
      .first()
      .waitFor({ state: w.state, timeout });
  }
  if (w.networkIdle) {
    await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  }
  await waitForDomQuiet(page);
}

async function performAction(
  ctx: StepContext,
  step: Step,
  timeout: number,
): Promise<TargetCandidate | null> {
  const { page } = ctx.session;
  const value = step.value !== undefined ? interpolate(step.value) : undefined;

  switch (step.action) {
    case 'goto': {
      const url = /^https?:\/\//.test(value!) ? value! : new URL(value!, ctx.baseUrl).toString();
      await page.goto(url, { waitUntil: 'load', timeout: Math.max(timeout, 15_000) });
      await waitForDomQuiet(page);
      return null;
    }
    case 'http': {
      await runHttpStep(ctx.session.context, step.http!, ctx.baseUrl);
      return null;
    }
    case 'press': {
      await page.keyboard.press(value!);
      return null;
    }
    case 'waitFor': {
      // The wait itself runs in executeStep, same as for every other action.
      return null;
    }
    case 'expect': {
      const scope = await scopeFor(page, step);
      let locator = null;
      let matched: TargetCandidate | null = null;
      if (step.target) {
        if (step.expect!.type === 'hidden' || step.expect!.negate) {
          // Element may legitimately be absent — don't fail on resolution.
          locator = locatorFor(scope, step.target[0]);
          matched = step.target[0];
        } else if (step.expect!.type === 'count') {
          locator = locatorFor(scope, step.target[0]);
          matched = step.target[0];
        } else {
          const resolved = await resolveTarget(scope, step.target, undefined, timeout);
          locator = resolved.locator;
          matched = resolved.matched;
        }
      }
      await runExpect(page, step.expect!, locator, timeout);
      return matched;
    }
    default: {
      // Element actions.
      const scope = await scopeFor(page, step);
      const { locator, matched } = await resolveTarget(scope, step.target!, undefined, timeout);
      switch (step.action) {
        case 'click':
          if (step.force) {
            // Escape hatch for elements a normal click can't reach: persistent
            // CSS animations that never settle actionability, or an overlay that
            // intercepts the pointer. Dispatch the click event straight at the
            // element (bypasses actionability + hit-testing entirely).
            await locator.dispatchEvent('click', {}, { timeout });
          } else {
            await locator.click({ timeout });
          }
          await waitForDomQuiet(page);
          break;
        case 'fill':
          await locator.fill(value!, { timeout });
          break;
        case 'select':
          await locator.selectOption({ label: value! }, { timeout }).catch(async () => {
            await locator.selectOption(value!, { timeout });
          });
          break;
        case 'check':
          await locator.check({ timeout });
          break;
        case 'uncheck':
          await locator.uncheck({ timeout });
          break;
        case 'hover':
          await locator.hover({ timeout });
          break;
        case 'upload':
          await locator.setInputFiles(path.resolve(ctx.scenarioDir, value!), { timeout });
          break;
        case 'scrollIntoView':
          await locator.scrollIntoViewIfNeeded({ timeout });
          break;
      }
      return matched;
    }
  }
}
