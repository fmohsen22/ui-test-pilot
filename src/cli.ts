#!/usr/bin/env node
/**
 * uitp — agent-driven JSON-protocol UI testing.
 *
 * Contract: stdout is ALWAYS exactly one JSON document; human/progress output
 * goes to stderr. Exit codes: 0 pass, 1 scenario failed (healable),
 * 2 invalid input/schema (fix the JSON), 3 infrastructure error (don't heal).
 */
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { discoverConfig } from './config.js';
import { validateScenario } from './schema/validate.js';
import { runScenario } from './runner/run.js';
import { openSession } from './runner/browser.js';
import { captureDigest } from './snapshot/digest.js';
import { toJUnitXml } from './report/junit.js';
import type { RunResult } from './report/result.js';

const EXIT_PASS = 0;
const EXIT_FAILED = 1;
const EXIT_INVALID = 2;
const EXIT_INFRA = 3;

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  emit({ error: `uitp requires Node >= 22, found ${process.versions.node}. Try: nvm use 22` });
  process.exit(EXIT_INFRA);
}

function emit(doc: unknown): void {
  process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
}

function status(msg: string): void {
  process.stderr.write(pc.dim(`[uitp] ${msg}`) + '\n');
}

function exitCodeFor(result: RunResult): number {
  switch (result.status) {
    case 'passed':
      return EXIT_PASS;
    case 'failed':
      return EXIT_FAILED;
    case 'invalid':
      return EXIT_INVALID;
    case 'error':
      return EXIT_INFRA;
  }
}

const program = new Command()
  .name('uitp')
  .description('Agent-driven JSON-protocol UI testing (deterministic Playwright runner)')
  .version('0.1.2');

program
  .command('snapshot')
  .description('Capture a compact DOM digest of a page (interactive elements + ranked selectors)')
  .requiredOption('--url <url>', 'page URL (absolute, or path relative to configured baseUrl)')
  .option('--storage-state <file>', 'load a storage state file before navigating')
  .option('--frame <css>', 'scope the digest to a single-level iframe')
  .option('--full', 'lift element caps and text truncation')
  .option('--headed', 'run with a visible browser')
  .action(async (opts) => {
    const config = discoverConfig();
    const url = /^https?:\/\//.test(opts.url) ? opts.url : new URL(opts.url, config.baseUrl).toString();
    let session;
    try {
      session = await openSession({ headed: opts.headed, storageStatePath: opts.storageState });
    } catch (e) {
      emit({ error: (e as Error).message });
      process.exit(EXIT_INFRA);
    }
    try {
      status(`navigating to ${url}`);
      await session.page.goto(url, { waitUntil: 'load', timeout: 20_000 });
      const digest = await captureDigest(session.page, { full: opts.full, frame: opts.frame });
      emit(digest);
      process.exit(EXIT_PASS);
    } catch (e) {
      emit({ error: `Cannot snapshot ${url}: ${(e as Error).message.split('\n')[0]}` });
      process.exit(EXIT_INFRA);
    } finally {
      await session.close();
    }
  });

program
  .command('run')
  .description('Run one scenario JSON; on failure the JSON output contains everything needed to heal it')
  .argument('<scenario>', 'path to scenario .json')
  .option('--until-step <n>', 'run steps 0..N inclusive, then output the digest of the resulting page', parseInt)
  .option('--headed', 'run with a visible browser')
  .option('--artifacts-dir <dir>', 'override artifacts directory')
  .action(async (scenarioFile, opts) => {
    const config = discoverConfig();
    status(`running ${scenarioFile}${opts.untilStep !== undefined ? ` (until step ${opts.untilStep})` : ''}`);
    const result = await runScenario({
      scenarioFile,
      baseUrl: config.baseUrl,
      artifactsRoot: opts.artifactsDir ? path.resolve(opts.artifactsDir) : config.artifactsDir,
      untilStep: opts.untilStep,
      headed: opts.headed,
    });
    emit(result);
    status(`${result.scenarioId}: ${result.status} (${result.durationMs}ms)`);
    process.exit(exitCodeFor(result));
  });

program
  .command('run-all')
  .description('Regression mode: run every scenario JSON in a directory (recursive), no LLM involved')
  .argument('<dir>', 'directory containing scenario .json files')
  .option('--grep <tag>', 'only scenarios whose tags include <tag>')
  .option('--bail', 'stop at first failure')
  .option('--retries <n>', 'retry failed scenarios n times', parseInt, 0)
  .option('--junit <file>', 'write a JUnit XML report')
  .option('--json <file>', 'write the full JSON report to a file as well')
  .option('--headed', 'run with a visible browser')
  .action(async (dir, opts) => {
    const config = discoverConfig();
    const files = collectScenarioFiles(path.resolve(dir));
    if (files.length === 0) {
      emit({ error: `No scenario .json files found under ${dir}` });
      process.exit(EXIT_INVALID);
    }
    const results: RunResult[] = [];
    for (const file of files) {
      if (opts.grep) {
        try {
          const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (!Array.isArray(raw.tags) || !raw.tags.includes(opts.grep)) continue;
        } catch {
          // unparseable file — let runScenario report it as invalid
        }
      }
      let result = await runScenario({
        scenarioFile: file,
        baseUrl: config.baseUrl,
        artifactsRoot: config.artifactsDir,
        headed: opts.headed,
      });
      for (let attempt = 0; result.status === 'failed' && attempt < (opts.retries ?? 0); attempt++) {
        status(`retrying ${result.scenarioId} (attempt ${attempt + 2})`);
        result = await runScenario({
          scenarioFile: file,
          baseUrl: config.baseUrl,
          artifactsRoot: config.artifactsDir,
          headed: opts.headed,
        });
      }
      results.push(result);
      const mark = result.status === 'passed' ? pc.green('✓') : pc.red('✗');
      status(`${mark} ${result.scenarioId} (${result.durationMs}ms)`);
      if (opts.bail && result.status !== 'passed') break;
    }
    const summary = {
      total: results.length,
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status !== 'passed').length,
      results: results.map((r) => ({
        id: r.scenarioId,
        file: r.scenarioFile,
        status: r.status,
        durationMs: r.durationMs,
        ...(r.failure ? { failure: `${r.failure.errorType}: ${r.failure.message}` } : {}),
      })),
    };
    if (opts.junit) fs.writeFileSync(path.resolve(opts.junit), toJUnitXml(results));
    if (opts.json) fs.writeFileSync(path.resolve(opts.json), JSON.stringify(results, null, 2));
    emit(summary);
    process.exit(summary.failed === 0 ? EXIT_PASS : EXIT_FAILED);
  });

program
  .command('validate')
  .description('Validate scenario JSON files against the schema (errors + lint warnings)')
  .argument('<files...>', 'scenario .json files')
  .action((files: string[]) => {
    const reports = files.map((file) => {
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        return { file, valid: false, errors: [{ path: '(file)', message: (e as Error).message }], warnings: [] };
      }
      const r = validateScenario(raw);
      return { file, valid: r.valid, errors: r.errors, warnings: r.warnings };
    });
    emit({ allValid: reports.every((r) => r.valid), reports });
    process.exit(reports.every((r) => r.valid) ? EXIT_PASS : EXIT_INVALID);
  });

program
  .command('init')
  .description('Scaffold a uitests/ folder in a consuming app repo')
  .option('--dir <dir>', 'target directory', 'uitests')
  .option('--base-url <url>', 'app base URL', 'http://localhost:3000')
  .action((opts) => {
    const dir = path.resolve(opts.dir);
    fs.mkdirSync(path.join(dir, 'scenarios'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'states'), { recursive: true });
    const write = (rel: string, content: string) => {
      const p = path.join(dir, rel);
      if (!fs.existsSync(p)) fs.writeFileSync(p, content);
    };
    write('uitp.config.json', JSON.stringify({ baseUrl: opts.baseUrl, artifactsDir: '.uitp' }, null, 2) + '\n');
    write('.env.example', '# Secrets referenced by scenarios via ${VAR}\n# MY_TEST_PASSWORD=...\n');
    write(
      'README.md',
      '# UI tests (ui-test-pilot)\n\nScenario JSONs live in `scenarios/`. Run one: `uitp run scenarios/<file>.json`.\nRegression: `uitp run-all scenarios`.\n',
    );
    write('.gitignore', '.uitp/\n.env\nstates/\n');
    emit({ created: dir, files: ['uitp.config.json', '.env.example', 'README.md', '.gitignore', 'scenarios/', 'states/'] });
  });

function collectScenarioFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

program.parseAsync().catch((e) => {
  emit({ error: (e as Error).message });
  process.exit(EXIT_INFRA);
});
