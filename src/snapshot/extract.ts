/**
 * In-page extraction script. Runs inside the browser via page.evaluate —
 * must be self-contained (no imports used inside the function body).
 */

export interface RawElement {
  tag: string;
  type: string | null;
  role: string | null;
  name: string | null; // accessible-ish name (aria-label, label[for], alt, text)
  id: string | null;
  testid: string | null;
  placeholder: string | null;
  text: string | null;
  href: string | null;
  disabled: boolean;
  checked: boolean | null;
  options: string[] | null; // for <select>
  inDialog: boolean;
  cssPath: string;
}

export interface RawSnapshot {
  title: string;
  dialogOpen: boolean;
  elements: RawElement[];
  headings: { level: number; text: string }[];
  texts: string[];
  frames: string[];
}

export function extractInPage(maxTextLen: number): RawSnapshot {
  const TRUNC = (s: string | null | undefined): string | null => {
    if (!s) return null;
    const t = s.replace(/\s+/g, ' ').trim();
    if (!t) return null;
    return t.length > maxTextLen ? t.slice(0, maxTextLen) + '…' : t;
  };

  const isVisible = (el: Element): boolean => {
    const he = el as HTMLElement;
    if (!he.getClientRects || he.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(he);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };

  const cssPath = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 5) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  };

  const implicitRole = (el: Element): string | null => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      return 'textbox';
    }
    return null;
  };

  const accessibleName = (el: Element): string | null => {
    const aria = el.getAttribute('aria-label');
    if (aria) return TRUNC(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ref = document.getElementById(labelledBy.split(/\s+/)[0]);
      if (ref) return TRUNC(ref.textContent);
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return TRUNC(label.textContent);
    }
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) return TRUNC(wrappingLabel.textContent);
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const val = (el as HTMLInputElement).value;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type) && val) return TRUNC(val);
    }
    if (['button', 'a', 'summary'].includes(tag) || el.getAttribute('role')) {
      return TRUNC(el.textContent);
    }
    const img = el.querySelector('img[alt]');
    if (img) return TRUNC(img.getAttribute('alt'));
    return null;
  };

  // Topmost open dialog/modal, if any.
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]'),
  ).filter(isVisible);
  const dialog = dialogs.length > 0 ? dialogs[dialogs.length - 1] : null;
  const root: Element = dialog ?? document.body;

  const INTERACTIVE =
    'a[href], button, input, select, textarea, summary, ' +
    '[role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], ' +
    '[role="menuitem"], [role="combobox"], [role="switch"], [role="option"], [onclick], [tabindex]';

  const seen = new Set<Element>();
  const elements: RawElement[] = [];
  for (const el of Array.from(root.querySelectorAll(INTERACTIVE))) {
    if (seen.has(el) || !isVisible(el)) continue;
    seen.add(el);
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') continue;
    const select = tag === 'select' ? (el as HTMLSelectElement) : null;
    const checkable =
      tag === 'input' && ['checkbox', 'radio'].includes((el.getAttribute('type') || '').toLowerCase());
    elements.push({
      tag,
      type: el.getAttribute('type'),
      role: implicitRole(el),
      name: accessibleName(el),
      id: el.id || null,
      testid: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || null,
      placeholder: TRUNC(el.getAttribute('placeholder')),
      text: TRUNC(el.textContent),
      href: tag === 'a' ? TRUNC(el.getAttribute('href')) : null,
      disabled: (el as HTMLInputElement).disabled === true,
      checked: checkable ? (el as HTMLInputElement).checked : null,
      options: select ? Array.from(select.options).slice(0, 20).map((o) => o.text.trim()) : null,
      inDialog: dialog ? dialog.contains(el) : false,
      cssPath: cssPath(el),
    });
  }

  const headings = Array.from(root.querySelectorAll('h1, h2, h3'))
    .filter(isVisible)
    .slice(0, 12)
    .map((h) => ({ level: Number(h.tagName[1]), text: TRUNC(h.textContent) || '' }))
    .filter((h) => h.text);

  // Short visible standalone texts: alerts, errors, paragraphs, list items.
  const texts: string[] = [];
  const TEXTY = '[role="alert"], [role="status"], .error, .alert, p, li, span.kc-feedback-text';
  for (const el of Array.from(root.querySelectorAll(TEXTY))) {
    if (texts.length >= 20) break;
    if (!isVisible(el)) continue;
    // Skip wrappers — only leaf-ish nodes.
    if (el.children.length > 2) continue;
    const t = TRUNC(el.textContent);
    if (t && t.length > 2 && !texts.includes(t)) texts.push(t);
  }

  const frames = Array.from(document.querySelectorAll('iframe'))
    .filter(isVisible)
    .slice(0, 5)
    .map((f) => f.getAttribute('src') || '(no src)');

  return {
    title: document.title,
    dialogOpen: dialog !== null,
    elements,
    headings,
    texts,
    frames,
  };
}
