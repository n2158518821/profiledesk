const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('macOS package configuration supports signing and notarization', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const entitlements = fs.readFileSync(
    path.join(root, 'build/entitlements.mac.plist'),
    'utf8',
  );

  assert.equal(packageJson.build.mac.hardenedRuntime, true);
  assert.equal(packageJson.build.mac.notarize, true);
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);
});

test('GitHub macOS build accepts certificate and notarization secrets', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/build-desktop.yml'),
    'utf8',
  );

  assert.doesNotMatch(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s*["']?false/);
  assert.match(workflow, /CSC_LINK:\s*\$\{\{ secrets\.MAC_CSC_LINK \}\}/);
  assert.match(workflow, /APPLE_APP_SPECIFIC_PASSWORD:/);
  assert.match(workflow, /APPLE_TEAM_ID:/);
});

test('unsigned macOS build disables hardened runtime and notarization', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/build-mac.js'), 'utf8');

  assert.match(script, /-c\.mac\.identity=null/);
  assert.match(script, /-c\.mac\.hardenedRuntime=false/);
  assert.match(script, /-c\.mac\.notarize=false/);
});
