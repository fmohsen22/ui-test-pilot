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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uitp-heal-'));
  process.env.UITP_FIXTURE_PASS = 'fixture-pass';
});

afterAll(async () => {
  await server?.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('healing contract (failure report shape)', () => {
  it('broken selector → selector_not_found with candidatesTried, digest, screenshot', async () => {
    const file = path.join(workDir, 'broken.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        id: 'fixture-broken-selector',
        title: 'Broken selector heals',
        feature: 'auth/login',
        steps: [
          { description: 'open login page', action: 'goto', value: '/login.html' },
          {
            description: 'enter username',
            action: 'fill',
            target: [{ strategy: 'id', value: 'usernme' }], // typo on purpose
            value: 'testuser',
            timeoutMs: 2000,
          },
          { description: 'never reached', action: 'click', target: [{ strategy: 'id', value: 'kc-login' }] },
        ],
      }),
    );
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });

    expect(result.status).toBe('failed');
    expect(result.failure).not.toBeNull();
    const f = result.failure!;
    expect(f.stepIndex).toBe(1);
    expect(f.errorType).toBe('selector_not_found');
    expect(f.candidatesTried).toEqual([{ strategy: 'id', value: 'usernme', error: '0 elements' }]);
    // The digest at failure contains the CORRECT element to heal with.
    expect(f.domDigest).not.toBeNull();
    expect(f.domDigest!.interactive.some((e) => e.id === 'username')).toBe(true);
    expect(f.screenshot).not.toBeNull();
    expect(fs.existsSync(f.screenshot!)).toBe(true);
    // Per-step statuses: passed, failed, skipped.
    expect(result.steps.map((s) => s.status)).toEqual(['passed', 'failed', 'skipped']);
  });

  it('failed assertion → assertion_failed with actual value in message', async () => {
    const file = path.join(workDir, 'assert-fail.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        id: 'fixture-assert-fail',
        title: 'Assertion failure shape',
        feature: 'auth/login',
        steps: [
          { description: 'open login page', action: 'goto', value: '/login.html' },
          {
            description: 'wrong heading expected',
            action: 'expect',
            target: [{ strategy: 'css', value: 'h1' }],
            expect: { type: 'text', value: 'Welcome back' },
            timeoutMs: 1500,
          },
        ],
      }),
    );
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(result.status).toBe('failed');
    expect(result.failure!.errorType).toBe('assertion_failed');
    expect(result.failure!.message).toContain('Sign in'); // the actual text
  });

  it('secret values never leak into the failure report', async () => {
    const file = path.join(workDir, 'secret-fail.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        id: 'fixture-secret-fail',
        title: 'Secrets stay redacted',
        feature: 'auth/login',
        env: { required: ['UITP_FIXTURE_PASS'] },
        steps: [
          { description: 'open login page', action: 'goto', value: '/login.html' },
          {
            description: 'fill password into broken selector',
            action: 'fill',
            secret: true,
            target: [{ strategy: 'id', value: 'pasword-typo' }],
            value: '${UITP_FIXTURE_PASS}',
            timeoutMs: 1500,
          },
        ],
      }),
    );
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(result.status).toBe('failed');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('fixture-pass');
    expect(result.failure!.step.value).toBe('«redacted»');
  });

  it('invalid scenario JSON → status invalid (exit-code-2 territory)', async () => {
    const file = path.join(workDir, 'invalid.json');
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, id: 'x', steps: [] }));
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(result.status).toBe('invalid');
    expect(result.failure!.message).toContain('Schema validation failed');
  });

  it('missing required env var → env_missing', async () => {
    const file = path.join(workDir, 'env-missing.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        id: 'fixture-env-missing',
        title: 'Env missing',
        feature: 'auth',
        env: { required: ['UITP_DOES_NOT_EXIST'] },
        steps: [{ description: 'open', action: 'goto', value: '/' }],
      }),
    );
    const result = await runScenario({
      scenarioFile: file,
      baseUrl: server.baseUrl,
      artifactsRoot: path.join(workDir, '.uitp'),
    });
    expect(result.status).toBe('invalid');
    expect(result.failure!.errorType).toBe('env_missing');
    expect(result.failure!.message).toContain('UITP_DOES_NOT_EXIST');
  });
});
