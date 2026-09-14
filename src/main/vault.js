const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class SecretVault {
  constructor(rootDir, safeStorage) {
    this.file = path.join(rootDir, 'vault.json');
    this.safeStorage = safeStorage;
    this.data = { version: 1, secrets: {} };
  }

  async init() {
    try {
      this.data = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
  }

  available() {
    return this.safeStorage.isEncryptionAvailable();
  }

  async save() {
    const tmp = `${this.file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fs.promises.rename(tmp, this.file);
  }

  async set(secret, existingRef = '') {
    if (!this.available()) throw new Error('系统安全存储当前不可用，拒绝保存密码');
    const ref = existingRef || randomUUID();
    this.data.secrets[ref] = this.safeStorage.encryptString(String(secret)).toString('base64');
    await this.save();
    return ref;
  }

  get(ref) {
    if (!ref || !this.data.secrets[ref]) return '';
    if (!this.available()) throw new Error('系统安全存储当前不可用');
    return this.safeStorage.decryptString(Buffer.from(this.data.secrets[ref], 'base64'));
  }

  encryptPayload(value) {
    if (!this.available()) throw new Error('系统安全存储当前不可用');
    return this.safeStorage.encryptString(JSON.stringify(value));
  }

  decryptPayload(buffer) {
    if (!this.available()) throw new Error('系统安全存储当前不可用');
    return JSON.parse(this.safeStorage.decryptString(buffer));
  }

  async remove(ref) {
    if (!ref) return;
    delete this.data.secrets[ref];
    await this.save();
  }

  async removeMany(refs) {
    let changed = false;
    for (const ref of new Set(Array.isArray(refs) ? refs : [])) {
      if (!ref || !this.data.secrets[ref]) continue;
      delete this.data.secrets[ref];
      changed = true;
    }
    if (changed) await this.save();
  }
}

module.exports = { SecretVault };
