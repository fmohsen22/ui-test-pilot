import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFixtureServer, type FixtureServer } from './fixtures/server.js';
import { runScenario } from '../src/runner/run.js';

let server: FixtureServer;
let workDir: string;

beforeAll(async () => {
  server = await startFixtureServer();
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uitp-test-'));
  process.env.UITP_FIXTURE_PASS = 'fixture-pass';
});

afterAll(async () => {
  await server?.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

function writeScenario(name: string, scenario: unknown): string {
  const file = path.join(workDir, name);
  fs.writeFileSync(file, JSON.stringify(scenario, null, 2));
  return file;
}

const loginScenario = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: 'fixture-login-happy',
  title: 'Login works on the fixture site',
  feature: 'auth/login',
  tags: ['auth'],
  env: { required: ['UITP_FIXTURE_PASS'] },
  steps: [
    { description: 'open login page', action: 'goto', value: '/login.html' },
    {
      description: 'enter username',
      action: 'fill',
      target: [
        { strategy: 'id', value: 'username' },
        { strategy: 'label', value: 'Username or email' },
      ],
      value: 'testuser',
    },
    {
      description: 'enter password',
      action: 'fill',
      secret: true,
      target: [{ strategy: 'id', value: 'password' }],
      value: '${UITP_FIXTURE_PASS}',
    },
    {
      description: 'submit',
      action: 'click',
      target: [
        { strategy: 'id', value: 'kc-login' },
        { strategy: 'role', value: 'button', name: 'Sign In' },
      ],
    },
    { description: 'arrive on dashboard', action: 'waitFor', waitFor: { url: '**/dashboard.html' } },
    {
      description: 'greeting visible',
      action: 'expect',
      target: [{ strategy: 'testid', value: 'greeting' }],
      expect: { type: 'text', value: 'Hello, testuser' },
    },
  ],
  ...overrides,
});

describe('runner', () => {
  it('runs the happy-path login scenario green', async () => {
    const file = writeScenario('login-happy.json', loginScenario());
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(result.status).toBe('passed');
    expect(result.steps).toHaveLength(6);
    expect(result.steps.every((s) => s.status === 'passed')).toBe(true);
    // The matched selector is recorded.
    expect(result.steps[1].matchedSelector).toEqual({ strategy: 'id', value: 'username' });
    // result.json artifact exists.
    expect(fs.existsSync(path.join(result.artifactsDir!, 'result.json'))).toBe(true);
  });

  it('falls back to later candidates when the first is wrong', async () => {
    const scenario = loginScenario({ id: 'fixture-login-fallback' });
    (scenario.steps[1] as { target: unknown[] }).target = [
      { strategy: 'id', value: 'usernme-typo' },
      { strategy: 'label', value: 'Username or email' },
    ];
    const file = writeScenario('login-fallback.json', scenario);
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(result.status).toBe('passed');
    expect(result.steps[1].matchedSelector).toEqual({
      strategy: 'label',
      value: 'Username or email',
    });
  });

  it('negative scenario: wrong password shows the error', async () => {
    const file = writeScenario('login-wrong.json', {
      schemaVersion: 1,
      id: 'fixture-login-wrong-password',
      title: 'Wrong password rejected',
      feature: 'auth/login',
      steps: [
        { description: 'open login page', action: 'goto', value: '/login.html' },
        { description: 'enter username', action: 'fill', target: [{ strategy: 'id', value: 'username' }], value: 'testuser' },
        { description: 'enter wrong password', action: 'fill', secret: true, target: [{ strategy: 'id', value: 'password' }], value: 'wrong' },
        { description: 'submit', action: 'click', target: [{ strategy: 'id', value: 'kc-login' }] },
        {
          description: 'error message shown',
          action: 'expect',
          target: [{ strategy: 'id', value: 'error' }],
          expect: { type: 'visible' },
        },
        { description: 'still on login page', action: 'expect', expect: { type: 'url', value: '**/login.html*' } },
      ],
    });
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(result.status).toBe('passed');
  });

  it('--until-step returns a digest of the resulting page', async () => {
    const file = writeScenario('login-until.json', loginScenario({ id: 'fixture-login-until' }));
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
      untilStep: 4, // through waitFor dashboard
    });
    expect(result.status).toBe('passed');
    expect(result.digest).not.toBeNull();
    expect(result.digest!.url).toContain('/dashboard.html');
    expect(result.digest!.interactive.some((e) => e.testid === 'logout')).toBe(true);
  });

  it('saves and reuses storage state', async () => {
    const stateRel = 'states/fixture.json';
    const file = writeScenario(
      'login-save-state.json',
      loginScenario({
        id: 'fixture-login-save-state',
        config: { saveStorageState: stateRel },
      }),
    );
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(result.status).toBe('passed');
    const statePath = path.join(workDir, stateRel);
    expect(result.storageStateSaved).toBe(statePath);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(JSON.stringify(state)).toContain('fixture-session');

    const reuse = writeScenario('reuse-state.json', {
      schemaVersion: 1,
      id: 'fixture-reuse-state',
      title: 'Reuses session storage state',
      feature: 'auth/session',
      config: { storageState: stateRel },
      steps: [
        { description: 'open dashboard directly', action: 'goto', value: '/dashboard.html' },
        {
          description: 'logout button visible',
          action: 'expect',
          target: [{ strategy: 'testid', value: 'logout' }],
          expect: { type: 'visible' },
        },
      ],
    });
    const reuseResult = await runScenario({
      scenarioFile: reuse,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(reuseResult.status).toBe('passed');
  });

  it('http step hits the fixture seed endpoint', async () => {
    const file = writeScenario('http-step.json', {
      schemaVersion: 1,
      id: 'fixture-http-step',
      title: 'http step works',
      feature: 'seed',
      steps: [
        {
          description: 'seed via API',
          action: 'http',
          http: { method: 'POST', url: '/api/seed', body: { kind: 'demo' }, expectStatus: 200 },
        },
        { description: 'open home', action: 'goto', value: '/' },
        { description: 'home heading', action: 'expect', target: [{ strategy: 'text', value: 'Fixture App' }], expect: { type: 'visible' } },
      ],
    });
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(result.status).toBe('passed');
  });

  it('modal overlay flow works', async () => {
    const file = writeScenario('modal.json', {
      schemaVersion: 1,
      id: 'fixture-modal',
      title: 'Dialog confirm flow',
      feature: 'modal',
      steps: [
        { description: 'open modal page', action: 'goto', value: '/modal.html' },
        { description: 'open the dialog', action: 'click', target: [{ strategy: 'id', value: 'open-modal' }] },
        { description: 'type confirmation', action: 'fill', target: [{ strategy: 'placeholder', value: 'Type CONFIRM' }], value: 'CONFIRM' },
        { description: 'confirm', action: 'click', target: [{ strategy: 'id', value: 'confirm-btn' }] },
        { description: 'lands on dashboard', action: 'waitFor', waitFor: { url: '**/dashboard.html' } },
        { description: 'greeting shown', action: 'expect', target: [{ strategy: 'testid', value: 'greeting' }], expect: { type: 'visible' } },
      ],
    });
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(result.status).toBe('passed');
  });
});
