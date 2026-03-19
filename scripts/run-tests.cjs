const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function collectTests(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath));
      continue;
    }
    if (/.test.(cjs|js)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

const testFiles = collectTests(path.join(process.cwd(), 'tests'));
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--experimental-test-isolation=none', ...testFiles], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
