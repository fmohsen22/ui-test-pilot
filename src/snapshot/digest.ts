import type { Page, Frame } from 'playwright';
import type { TargetCandidate } from '../schema/scenario.js';
import { extractInPage, type RawSnapshot } from './extract.js';
import { candidatesFor, dedupeKey } from './selectors.js';

export interface DigestElement {
  tag: string;
  role: string | null;
  name: string | null;
  id: string | null;
  testid: string | null;
  placeholder: string | null;
  type: string | null;
  text: string | null;
  href: string | null;
  disabled: boolean;
  checked: boolean | null;
  options: string[] | null;
  /** "× N similar" collapsing of repeated siblings. */
  similarCount?: number;
  selectors: TargetCandidate[];
}

export interface DomDigest {
  /** FINAL url after redirects. */
  url: string;
  title: string;
  dialogOpen: boolean;
  interactive: DigestElement[];
  headings: { level: number; text: string }[];
  texts: string[];
  frames: string[];
  truncated: boolean;
}

export interface DigestOptions {
  /** Lift element caps and text truncation. */
  full?: boolean;
  /** Scope to a single-level iframe (css selector of the iframe element). */
  frame?: string;
}

const MAX_ELEMENTS = 60;
const MAX_TEXT = 80;

/** Wait until the DOM is quiet (~no mutations for `quietMs`) — settles SPA redirects/renders. */
export async function waitForDomQuiet(page: Page, quietMs = 500, timeoutMs = 8000): Promise<void> {
  try {
    await page.waitForFunction(
      (quiet: number) => {
        const w = window as unknown as { __uitpLastMutation?: number; __uitpObserver?: MutationObserver };
        if (!w.__uitpObserver) {
          w.__uitpLastMutation = Date.now();
          w.__uitpObserver = new MutationObserver(() => {
            w.__uitpLastMutation = Date.now();
          });
          w.__uitpObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
          });
        }
        return Date.now() - (w.__uitpLastMutation ?? 0) > quiet;
      },
      quietMs,
      { timeout: timeoutMs },
    );
  } catch {
    // Page never went quiet (animations, polling) — proceed with what we have.
  }
}

export async function captureDigest(page: Page, opts: DigestOptions = {}): Promise<DomDigest> {
  await waitForDomQuiet(page);

  let context: Page | Frame = page;
  if (opts.frame) {
    const handle = await page.$(opts.frame);
    const frame = handle ? await handle.contentFrame() : null;
    if (!frame) throw new Error(`iframe not found for selector: ${opts.frame}`);
    context = frame;
  }

  const raw: RawSnapshot = await context.evaluate(extractInPage, opts.full ? 400 : MAX_TEXT);

  // Collapse repeated similar elements, cap the list.
  const groups = new Map<string, { el: DigestElement; count: number }>();
  for (const rawEl of raw.elements) {
    const key = dedupeKey(rawEl);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(key, {
      count: 1,
      el: {
        tag: rawEl.tag,
        role: rawEl.role,
        name: rawEl.name,
        id: rawEl.id,
        testid: rawEl.testid,
        placeholder: rawEl.placeholder,
        type: rawEl.type,
        text: rawEl.text,
        href: rawEl.href,
        disabled: rawEl.disabled,
        checked: rawEl.checked,
        options: rawEl.options,
        selectors: candidatesFor(rawEl),
      },
    });
  }

  let interactive = [...groups.values()].map(({ el, count }) =>
    count > 1 ? { ...el, similarCount: count } : el,
  );
  const cap = opts.full ? 500 : MAX_ELEMENTS;
  const truncated = interactive.length > cap;
  if (truncated) interactive = interactive.slice(0, cap);

  return {
    url: page.url(),
    title: raw.title,
    dialogOpen: raw.dialogOpen,
    interactive,
    headings: raw.headings,
    texts: raw.texts,
    frames: raw.frames,
    truncated,
  };
}
