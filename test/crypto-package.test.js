const test = require('node:test');
const assert = require('node:assert/strict');
const { decryptPackage, encryptPackage } = require('../src/main/crypto-package');

test('encrypted export round-trips and hides plaintext', () => {
  const payload = { format: 1, account: 'sensitive-user', cookies: [{ name: 'session', value: 'token' }] };
  const encrypted = encryptPackage(payload, 'correct horse battery staple');
  assert.equal(encrypted.includes(Buffer.from('sensitive-user')), false);
  assert.deepEqual(decryptPackage(encrypted, 'correct horse battery staple'), payload);
});

test('encrypted export rejects wrong password and weak password', () => {
  assert.throws(() => encryptPackage({}, 'short'), /至少需要8个/);
  const encrypted = encryptPackage({ ok: true }, 'long-enough-password');
  assert.throws(() => decryptPackage(encrypted, 'wrong-password'), /密码错误/);
});
