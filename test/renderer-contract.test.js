const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('renderer JavaScript only references element IDs present in HTML', () => {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const referenced = new Set([...script.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map((match) => match[1]));
  const missing = [...referenced].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, []);
});

test('every preload invoke channel has a main-process handler', () => {
  const preload = fs.readFileSync(path.join(root, 'src/preload/preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
  const invoked = new Set([...preload.matchAll(/invoke\('([^']+)'/g)].map((match) => match[1]));
  const handled = new Set([
    ...[...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((match) => match[1]),
    ...[...main.matchAll(/handleUnlocked\('([^']+)'/g)].map((match) => match[1]),
  ]);
  assert.deepEqual([...invoked].filter((channel) => !handled.has(channel)), []);
});
