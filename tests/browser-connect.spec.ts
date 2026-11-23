import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakePage = { on: vi.fn() };
const fakeContext = { newPage: vi.fn(async () => fakePage), close: vi.fn(async () => {}) };
const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn(async () => {}) };
const engine = {
  launch: vi.fn(async () => fakeBrowser),
  connect: vi.fn(async () => fakeBrowser),
};

vi.mock('playwright', () => ({ chromium: engine, firefox: engine, webkit: engine }));

const { openSession, InfrastructureError } = await import('../src/runner/browser.js');

describe('openSession: local launch or a remote Playwright server', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.UITP_CONNECT_WS_ENDPOINT;
    delete process.env.UITP_CONNECT_EXPOSE_NETWORK;
    delete process.env.UITP_BROWSER;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('launches locally when UITP_CONNECT_WS_ENDPOINT is not set', async () => {
    await openSession({ headed: false });
    expect(engine.launch).toHaveBeenCalledWith({ headless: true });
    expect(engine.connect).not.toHaveBeenCalled();
  });

  it('connects to the endpoint with loopback exposed, and does not launch', async () => {
    process.env.UITP_CONNECT_WS_ENDPOINT = 'ws://127.0.0.1:3000/';
    await openSession();
    expect(engine.connect).toHaveBeenCalledWith('ws://127.0.0.1:3000/', { exposeNetwork: '<loopback>' });
    expect(engine.launch).not.toHaveBeenCalled();
  });

  it('passes UITP_CONNECT_EXPOSE_NETWORK through', async () => {
    process.env.UITP_CONNECT_WS_ENDPOINT = 'ws://pw:3000/';
    process.env.UITP_CONNECT_EXPOSE_NETWORK = 'localhost,*.test';
    await openSession();
    expect(engine.connect).toHaveBeenCalledWith('ws://pw:3000/', { exposeNetwork: 'localhost,*.test' });
  });

  it('names the endpoint when the connection fails', async () => {
    process.env.UITP_CONNECT_WS_ENDPOINT = 'ws://pw:3000/';
    engine.connect.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const err = await openSession().catch((e) => e);
    expect(err).toBeInstanceOf(InfrastructureError);
    expect(err.message).toContain('ws://pw:3000/');
    expect(engine.launch).not.toHaveBeenCalled();
  });
});
