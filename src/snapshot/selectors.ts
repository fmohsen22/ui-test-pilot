import type { TargetCandidate } from '../schema/scenario.js';
import type { RawElement } from './extract.js';

/**
 * Generate ranked selector candidates for one element:
 * testid > id > role+name > label > placeholder > text > css.
 * The agent copies these straight into a step's "target".
 */
export function candidatesFor(el: RawElement): TargetCandidate[] {
  const out: TargetCandidate[] = [];
  if (el.testid) out.push({ strategy: 'testid', value: el.testid });
  if (el.id) out.push({ strategy: 'id', value: el.id });
  if (el.role && el.name) out.push({ strategy: 'role', value: el.role, name: el.name });
  if (el.name && ['input', 'select', 'textarea'].includes(el.tag)) {
    out.push({ strategy: 'label', value: el.name });
  }
  if (el.placeholder) out.push({ strategy: 'placeholder', value: el.placeholder });
  if (el.text && el.text.length <= 50 && ['a', 'button', 'summary'].includes(el.tag)) {
    out.push({ strategy: 'text', value: el.text, exact: true });
  }
  if (out.length < 3 && el.cssPath) out.push({ strategy: 'css', value: el.cssPath });
  return out.slice(0, 4);
}

/** Dedupe key used to collapse repeated similar elements (feed cards etc.). */
export function dedupeKey(el: RawElement): string {
  return [el.tag, el.role ?? '', el.name ?? el.text ?? el.placeholder ?? ''].join('|');
}
