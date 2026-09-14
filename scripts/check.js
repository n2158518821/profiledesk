const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const targets = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile() && target.endsWith('.js')) targets.push(target);
  }
}

walk(path.join(root, 'src'));
walk(path.join(root, 'scripts'));
walk(path.join(root, 'test'));

let failed = false;
for (const file of targets.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) process.exitCode = 1;
else process.stdout.write(`Syntax check passed (${targets.length} files).\n`);
