import type { RunResult } from './result.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toJUnitXml(results: RunResult[], suiteName = 'uitp'): string {
  const failures = results.filter((r) => r.status !== 'passed').length;
  const totalMs = results.reduce((acc, r) => acc + r.durationMs, 0);
  const cases = results
    .map((r) => {
      const time = (r.durationMs / 1000).toFixed(2);
      if (r.status === 'passed') {
        return `    <testcase name="${esc(r.scenarioId)}" time="${time}"/>`;
      }
      const message = r.failure ? esc(`${r.failure.errorType}: ${r.failure.message}`) : r.status;
      return [
        `    <testcase name="${esc(r.scenarioId)}" time="${time}">`,
        `      <failure message="${message}">step ${r.failure?.stepIndex ?? '?'}: ${esc(
          r.failure?.step.description ?? '',
        )}</failure>`,
        '    </testcase>',
      ].join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${esc(suiteName)}" tests="${results.length}" failures="${failures}" time="${(
      totalMs / 1000
    ).toFixed(2)}">`,
    cases,
    '</testsuite>',
    '',
  ].join('\n');
}
