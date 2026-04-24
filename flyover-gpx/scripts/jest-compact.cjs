#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const cwd = process.cwd();
const outDir = path.join(cwd, '.tmp');
const outFile = path.join(outDir, 'jest-results.json');

fs.mkdirSync(outDir, { recursive: true });

let jestBin;
try {
  jestBin = require.resolve('jest/bin/jest');
} catch (_) {
  console.error('Could not resolve Jest binary. Run npm install first.');
  process.exit(1);
}

const passthroughArgs = process.argv.slice(2);
const jestArgs = [
  jestBin,
  '--json',
  '--outputFile',
  outFile,
  '--testLocationInResults',
  '--colors=false',
  '--silent',
  ...passthroughArgs,
];

const run = spawnSync(process.execPath, jestArgs, {
  cwd,
  stdio: ['inherit', 'ignore', 'ignore'],
});

if (!fs.existsSync(outFile)) {
  console.error('Jest did not produce a JSON results file.');
  process.exit(typeof run.status === 'number' ? run.status : 1);
}

let results;
try {
  results = JSON.parse(fs.readFileSync(outFile, 'utf8'));
} catch (_) {
  console.error('Could not parse Jest JSON results.');
  process.exit(typeof run.status === 'number' ? run.status : 1);
}

const total = Number(results.numTotalTests || 0);
const passed = Number(results.numPassedTests || 0);
const failed = Number(results.numFailedTests || 0);
const skipped = Number(results.numPendingTests || 0);
const durationMs = Number(results.startTime && results.testResults
  ? Math.max(0, Date.now() - Number(results.startTime))
  : 0);

console.log('Jest compact summary');
console.log('Total: ' + total + ' | Passed: ' + passed + ' | Failed: ' + failed + ' | Skipped: ' + skipped + ' | Time: ' + durationMs + 'ms');

if (failed > 0) {
  console.log('');
  console.log('Failures:');

  for (const testFile of results.testResults || []) {
    const filePath = path.relative(cwd, testFile.name || '');
    const assertions = Array.isArray(testFile.assertionResults) ? testFile.assertionResults : [];

    for (const assertion of assertions) {
      if (assertion.status !== 'failed') continue;

      const location = assertion.location && Number.isFinite(assertion.location.line)
        ? filePath + ':' + assertion.location.line + ':' + (Number(assertion.location.column) || 1)
        : filePath;

      const title = assertion.fullName || assertion.title || 'Unnamed test';

      let message = 'Assertion failed';
      if (Array.isArray(assertion.failureMessages) && assertion.failureMessages.length > 0) {
        const first = String(assertion.failureMessages[0] || '');
        message = first.split('\n').map((line) => line.trim()).find((line) => line.length > 0) || message;
        message = message.replace(/^Error:\s*/, '');
      }

      console.log('- ' + location);
      console.log('  ' + title);
      console.log('  ' + message);
    }
  }
}

process.exit(typeof run.status === 'number' ? run.status : (failed > 0 ? 1 : 0));
