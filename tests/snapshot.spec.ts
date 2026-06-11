import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from './fixtures/server.js';
import { openSession, type BrowserSession } from '../src/runner/browser.js';
import { captureDigest } from '../src/snapshot/digest.js';

let server: FixtureServer;
let session: BrowserSession;

beforeAll(async () => {
  server = await startFixtureServer();
  session = await openSession();
});

afterAll(async () => {
  await session?.close();
  await server?.close();
});

describe('DOM digest', () => {
  it('extracts ranked selectors from the login page', async () => {
    await session.page.goto(`${server.baseUrl}/login.html`);
    const digest = await captureDigest(session.page);

    expect(digest.url).toContain('/login.html');
    expect(digest.title).toBe('Fixture Login');
    expect(digest.dialogOpen).toBe(false);
    expect(digest.headings[0]).toEqual({ level: 1, text: 'Sign in' });

    const username = digest.interactive.find((e) => e.id === 'username');
    expect(username).toBeDefined();
    expect(username!.selectors[0]).toEqual({ strategy: 'id', value: 'username' });
    expect(username!.selectors.some((s) => s.strategy === 'label')).toBe(true);
    expect(username!.placeholder).toBe('you@example.com');

    const loginBtn = digest.interactive.find((e) => e.id === 'kc-login');
    expect(loginBtn).toBeDefined();
    expect(loginBtn!.selectors.some((s) => s.strategy === 'role' && s.name === 'Sign In')).toBe(true);

    const select = digest.interactive.find((e) => e.tag === 'select');
    expect(select!.options).toEqual(['English', 'Deutsch']);
  });

  it('collapses repeated similar elements', async () => {
    await session.page.goto(`${server.baseUrl}/index.html`);
    const digest = await captureDigest(session.page);
    const repeat = digest.interactive.find((e) => e.text === 'Repeat');
    expect(repeat).toBeDefined();
    expect(repeat!.similarCount).toBe(4);
  });

  it('scopes the digest to an open dialog', async () => {
    await session.page.goto(`${server.baseUrl}/modal.html`);
    let digest = await captureDigest(session.page);
    expect(digest.dialogOpen).toBe(false);

    await session.page.click('#open-modal');
    digest = await captureDigest(session.page);
    expect(digest.dialogOpen).toBe(true);
    const ids = digest.interactive.map((e) => e.id);
    expect(ids).toContain('confirm-btn');
    expect(ids).not.toContain('open-modal'); // outside the dialog
  });
});
