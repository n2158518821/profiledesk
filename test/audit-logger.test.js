const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AuditLogger } = require('../src/main/audit-logger');

test('audit logger appends structured local operation records', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'profiledesk-audit-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const logger = new AuditLogger(root);
  await logger.init();
  await logger.log('account.added', { accountId: 'one', name: 'Demo' });
  const files = await fs.promises.readdir(logger.directory);
  const entry = JSON.parse((await fs.promises.readFile(path.join(logger.directory, files[0]), 'utf8')).trim());
  assert.equal(entry.action, 'account.added');
  assert.equal(entry.details.accountId, 'one');
  assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T/);
});
