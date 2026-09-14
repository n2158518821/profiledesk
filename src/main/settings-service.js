const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SHORTCUTS = Object.freeze({
  showHide: 'CommandOrControl+Shift+P',
  nextAccount: 'CommandOrControl+Shift+Right',
  previousAccount: 'CommandOrControl+Shift+Left',
  toggleSidebar: 'CommandOrControl+Shift+B',
});

function derivePassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

function normalizeShortcuts(value = {}) {
  const result = {};
  for (const [name, fallback] of Object.entries(DEFAULT_SHORTCUTS)) {
    const accelerator = String(value[name] || fallback).trim().slice(0, 80);
    if (!accelerator) throw new Error(`快捷键 ${name} 不能为空`);
    result[name] = accelerator;
  }
  const normalized = Object.values(result).map((item) => item.toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error('快捷键不能重复');
  return result;
}

function integerInRange(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

class SettingsService {
  constructor(rootDir) {
    this.file = path.join(rootDir, 'settings.json');
    this.data = {
      version: 1,
      launchPassword: { enabled: false, salt: '', hash: '' },
      shortcuts: { ...DEFAULT_SHORTCUTS },
      maxRunningAccounts: 8,
      idleStopMinutes: 30,
      memoryLimitMb: 4096,
    };
  }

  async init() {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
      this.data = {
        version: 1,
        launchPassword: {
          enabled: Boolean(parsed.launchPassword?.enabled && parsed.launchPassword?.salt && parsed.launchPassword?.hash),
          salt: String(parsed.launchPassword?.salt || ''),
          hash: String(parsed.launchPassword?.hash || ''),
        },
        shortcuts: normalizeShortcuts(parsed.shortcuts),
        maxRunningAccounts: integerInRange(parsed.maxRunningAccounts, 8, 1, 30),
        idleStopMinutes: integerInRange(parsed.idleStopMinutes, 30, 0, 1440),
        memoryLimitMb: integerInRange(parsed.memoryLimitMb, 4096, 1024, 32768),
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        await fs.promises.copyFile(this.file, `${this.file}.invalid-${Date.now()}`).catch(() => {});
      }
      await this.save();
    }
    return this.publicSettings();
  }

  async save() {
    const temporary = `${this.file}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fs.promises.rename(temporary, this.file);
  }

  isLockedOnLaunch() {
    return this.data.launchPassword.enabled;
  }

  verifyPassword(password) {
    const lock = this.data.launchPassword;
    if (!lock.enabled) return true;
    try {
      const expected = Buffer.from(lock.hash, 'base64');
      const actual = derivePassword(password, Buffer.from(lock.salt, 'base64'));
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  publicSettings() {
    return {
      launchPasswordEnabled: this.data.launchPassword.enabled,
      shortcuts: { ...this.data.shortcuts },
      maxRunningAccounts: this.data.maxRunningAccounts,
      idleStopMinutes: this.data.idleStopMinutes,
      memoryLimitMb: this.data.memoryLimitMb,
    };
  }

  async update(input = {}) {
    const enablePassword = Boolean(input.launchPasswordEnabled);
    const currentPassword = String(input.currentPassword || '');
    const newPassword = String(input.newPassword || '');
    const shortcuts = normalizeShortcuts(input.shortcuts);
    if (this.data.launchPassword.enabled && !this.verifyPassword(currentPassword)) {
      throw new Error('当前启动密码不正确');
    }
    if (enablePassword && (!this.data.launchPassword.enabled || newPassword)) {
      if (newPassword.length < 8) throw new Error('新启动密码至少需要8个字符');
      const salt = crypto.randomBytes(16);
      this.data.launchPassword = {
        enabled: true,
        salt: salt.toString('base64'),
        hash: derivePassword(newPassword, salt).toString('base64'),
      };
    } else if (!enablePassword) {
      this.data.launchPassword = { enabled: false, salt: '', hash: '' };
    }
    this.data.shortcuts = shortcuts;
    this.data.maxRunningAccounts = integerInRange(input.maxRunningAccounts, this.data.maxRunningAccounts, 1, 30);
    this.data.idleStopMinutes = integerInRange(input.idleStopMinutes, this.data.idleStopMinutes, 0, 1440);
    this.data.memoryLimitMb = integerInRange(input.memoryLimitMb, this.data.memoryLimitMb, 1024, 32768);
    await this.save();
    return this.publicSettings();
  }
}

module.exports = { DEFAULT_SHORTCUTS, SettingsService, normalizeShortcuts };
