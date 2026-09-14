const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_SHORTCUTS, SettingsService, normalizeShortcuts } = require('../src/main/settings-service');

test('launch password is hashed, persisted and verified', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'profiledesk-settings-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const settings = new SettingsService(directory);
  await settings.init();
  await settings.update({
    launchPasswordEnabled: true,
    newPassword: 'strong-start-password',
    shortcuts: DEFAULT_SHORTCUTS,
  });
  assert.equal(settings.verifyPassword('strong-start-password'), true);
  assert.equal(settings.verifyPassword('wrong-password'), false);
  const raw = await fs.promises.readFile(path.join(directory, 'settings.json'), 'utf8');
  assert.equal(raw.includes('strong-start-password'), false);

  const reloaded = new SettingsService(directory);
  await reloaded.init();
  assert.equal(reloaded.isLockedOnLaunch(), true);
  assert.equal(reloaded.verifyPassword('strong-start-password'), true);
});

test('changing protected settings requires current password', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'profiledesk-settings-auth-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const settings = new SettingsService(directory);
  await settings.init();
  await settings.update({ launchPasswordEnabled: true, newPassword: 'first-password', shortcuts: DEFAULT_SHORTCUTS });
  await assert.rejects(() => settings.update({
    launchPasswordEnabled: false,
    currentPassword: 'incorrect',
    shortcuts: DEFAULT_SHORTCUTS,
  }), /当前启动密码不正确/);
  assert.equal(settings.isLockedOnLaunch(), true);
});

test('duplicate shortcuts are rejected', () => {
  assert.throws(() => normalizeShortcuts({
    ...DEFAULT_SHORTCUTS,
    nextAccount: DEFAULT_SHORTCUTS.showHide,
  }), /不能重复/);
});
