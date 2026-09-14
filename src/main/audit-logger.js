const fs = require('node:fs');
const path = require('node:path');

class AuditLogger {
  constructor(rootDir) {
    this.directory = path.join(rootDir, 'logs');
    this.retentionDays = 90;
    this.maxFileBytes = 5 * 1024 * 1024;
  }

  async init() {
    await fs.promises.mkdir(this.directory, { recursive: true });
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const entries = await fs.promises.readdir(this.directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !/^audit-\d{4}-\d{2}(?:-\d+)?\.jsonl$/.test(entry.name)) continue;
      const file = path.join(this.directory, entry.name);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fs.promises.rm(file, { force: true }).catch(() => {});
    }
  }

  async currentFile() {
    const month = new Date().toISOString().slice(0, 7);
    const base = path.join(this.directory, `audit-${month}.jsonl`);
    const stat = await fs.promises.stat(base).catch(() => null);
    if (!stat || stat.size < this.maxFileBytes) return base;
    for (let index = 1; index < 100; index += 1) {
      const candidate = path.join(this.directory, `audit-${month}-${index}.jsonl`);
      const candidateStat = await fs.promises.stat(candidate).catch(() => null);
      if (!candidateStat || candidateStat.size < this.maxFileBytes) return candidate;
    }
    throw new Error('审计日志文件数量达到上限');
  }

  async log(action, details = {}) {
    const safeDetails = JSON.parse(JSON.stringify(details, (_key, value) => {
      if (typeof value === 'string') return value.slice(0, 500);
      return value;
    }));
    const entry = JSON.stringify({ at: new Date().toISOString(), action: String(action).slice(0, 100), details: safeDetails });
    await fs.promises.appendFile(await this.currentFile(), `${entry}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

module.exports = { AuditLogger };
