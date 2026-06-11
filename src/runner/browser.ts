import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export class InfrastructureError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'InfrastructureError';
  }
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  consoleErrors: string[];
  failedRequests: { method: string; url: string; status: number }[];
  close(): Promise<void>;
}

export interface BrowserOptions {
  headed?: boolean;
  viewport?: { width: number; height: number };
  /** Absolute path of a storage state file to load. */
  storageStatePath?: string;
}

export async function openSession(opts: BrowserOptions = {}): Promise<BrowserSession> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: !opts.headed });
  } catch (e) {
    throw new InfrastructureError(
      `Failed to launch chromium — run "npx playwright install chromium". ${(e as Error).message.split('\n')[0]}`,
      e,
    );
  }
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1280, height: 800 },
    locale: 'de-AT',
    ...(opts.storageStatePath ? { storageState: opts.storageStatePath } : {}),
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const failedRequests: { method: string; url: string; status: number }[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text().slice(0, 300));
      if (consoleErrors.length > 10) consoleErrors.shift();
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push({ method: res.request().method(), url: res.url(), status: res.status() });
      if (failedRequests.length > 10) failedRequests.shift();
    }
  });

  return {
    browser,
    context,
    page,
    consoleErrors,
    failedRequests,
    close: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
