const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class SnapshotService {
  constructor(rootDir, store, vault) {
    this.rootDir = path.join(rootDir, 'snapshots');
    this.store = store;
    this.vault = vault;
  }

  async init() {
    await fs.promises.mkdir(this.rootDir, { recursive: true });
  }

  async create(account, browserSession, label = '') {
    await browserSession.flushStorageData();
    const cookies = await browserSession.cookies.get({});
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const payload = {
      format: 1,
      account: {
        name: account.name,
        username: account.username,
        startUrl: account.startUrl,
        currentUrl: account.currentUrl,
        proxy: account.proxy,
        environment: account.environment,
      },
      cookies,
      createdAt,
    };
    const file = path.join(this.rootDir, `${id}.snapshot`);
    await fs.promises.writeFile(file, this.vault.encryptPayload(payload), { mode: 0o600 });
    const metadata = {
      id,
      accountId: account.id,
      label: String(label || `快照 ${new Date().toLocaleString()}`),
      kind: 'logical',
      createdAt,
      file,
    };
    await this.store.addSnapshot(metadata);
    return metadata;
  }

  async restore(metadata, account, browserSession) {
    const payload = this.vault.decryptPayload(await fs.promises.readFile(metadata.file));
    await browserSession.clearStorageData();
    for (const cookie of payload.cookies || []) {
      const domain = String(cookie.domain || '').replace(/^\./, '');
      if (!domain) continue;
      const url = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`;
      const normalized = {
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
      };
      if (cookie.expirationDate) normalized.expirationDate = cookie.expirationDate;
      if (cookie.sameSite && cookie.sameSite !== 'unspecified') normalized.sameSite = cookie.sameSite;
      await browserSession.cookies.set(normalized).catch(() => {});
    }
    await browserSession.flushStorageData();
    return payload;
  }
}

module.exports = { SnapshotService };
