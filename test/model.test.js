const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccount, createSite, normalizeProxy, normalizeUrl, publicAccount } = require('../src/shared/model');

test('normalizes web URLs and rejects unsafe schemes', () => {
  assert.equal(normalizeUrl('example.com/login'), 'https://example.com/login');
  assert.throws(() => normalizeUrl('file:///tmp/private'), /仅允许/);
  assert.throws(() => normalizeUrl('javascript:alert(1)'), /仅允许/);
});

test('creates an isolated account model with safe defaults', () => {
  const site = createSite({ name: 'Demo', homeUrl: 'https://example.com' });
  const account = createAccount({ name: 'Account A', username: 'alice' }, site);
  assert.equal(account.siteId, site.id);
  assert.equal(account.proxy.mode, 'system');
  assert.equal(account.autoLogin.submitAutomatically, false);
  assert.equal(account.environment.doNotTrack, true);
});

test('public account never exposes secret references', () => {
  const site = createSite({ name: 'Demo', homeUrl: 'https://example.com' });
  const account = createAccount({
    name: 'Account A',
    proxy: { secretRef: 'proxy-secret' },
    autoLogin: { secretRef: 'login-secret' },
  }, site);
  const result = publicAccount(account);
  assert.equal(result.proxy.secretRef, '');
  assert.equal(result.autoLogin.secretRef, '');
  assert.equal(result.proxy.hasPassword, true);
  assert.equal(result.autoLogin.hasPassword, true);
});

test('normalizes unsupported proxy modes to system', () => {
  assert.deepEqual(normalizeProxy({ mode: 'pac_script', server: 'x' }).mode, 'system');
});
