const fs = require('node:fs');
const path = require('node:path');
const { app, session, WebContentsView } = require('electron');
const { normalizeProxy, normalizeUrl } = require('../shared/model');

function safeFileName(input) {
  return String(input || 'download')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .slice(0, 180);
}

class ProfileManager {
  constructor({ mainWindow, store, vault, rootDir, onEvent }) {
    this.mainWindow = mainWindow;
    this.store = store;
    this.vault = vault;
    this.rootDir = rootDir;
    this.profileRoot = path.join(rootDir, 'profiles');
    this.downloadRoot = path.join(rootDir, 'downloads');
    this.instances = new Map();
    this.configuredSessions = new WeakSet();
    this.activeId = null;
    this.bounds = { x: 300, y: 110, width: 800, height: 500 };
    this.onEvent = onEvent;
    this.maxRunningAccounts = 8;
    this.idleStopMinutes = 30;
    this.memoryLimitMb = 4096;
    this.startQueue = Promise.resolve();
    this.resourceTimer = null;
    this.acceptingStarts = true;
    this.blockedAccountIds = new Set();
    app.on('login', (event, webContents, _details, authInfo, callback) => {
      if (!authInfo.isProxy) return;
      const entry = [...this.instances.entries()]
        .find(([, instance]) => instance.view.webContents.id === webContents.id);
      if (!entry) return;
      const account = this.store.findAccount(entry[0]);
      if (!account?.proxy?.username || !account.proxy.secretRef) return;
      event.preventDefault();
      callback(account.proxy.username, this.vault.get(account.proxy.secretRef));
    });
  }

  async init() {
    await Promise.all([
      fs.promises.mkdir(this.profileRoot, { recursive: true }),
      fs.promises.mkdir(this.downloadRoot, { recursive: true }),
    ]);
    this.resourceTimer = setInterval(() => this.sweepResources().catch(() => {}), 60000);
    this.resourceTimer.unref?.();
  }

  profilePath(accountId) {
    return this.accountPath(this.profileRoot, accountId);
  }

  accountPath(parent, accountId) {
    const target = path.resolve(parent, String(accountId || ''));
    const relative = path.relative(parent, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('账户数据路径无效');
    return target;
  }

  getSession(accountId) {
    const existing = this.instances.get(accountId);
    if (existing) return existing.session;
    return session.fromPath(this.profilePath(accountId), { cache: true });
  }

  async applyProxy(accountId, proxyInput) {
    const proxy = normalizeProxy(proxyInput);
    if (proxy.mode === 'fixed_servers' && !proxy.server) {
      throw new Error('自定义代理地址不能为空');
    }
    const ses = this.getSession(accountId);
    if (proxy.mode === 'system') {
      await ses.setProxy({ mode: 'system' });
    } else if (proxy.mode === 'direct') {
      await ses.setProxy({ mode: 'direct' });
    } else {
      await ses.setProxy({
        mode: 'fixed_servers',
        proxyRules: proxy.server,
        proxyBypassRules: proxy.bypassRules || '<local>',
      });
    }
    await ses.closeAllConnections();
    await this.store.updateAccount(accountId, { proxy });
    return proxy;
  }

  configureSession(account, ses) {
    if (this.configuredSessions.has(ses)) return;
    this.configuredSessions.add(ses);
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const current = this.store.findAccount(account.id);
      const language = current?.environment?.acceptLanguage;
      if (language) details.requestHeaders['Accept-Language'] = language;
      if (current?.environment?.doNotTrack) details.requestHeaders.DNT = '1';
      callback({ requestHeaders: details.requestHeaders });
    });

    ses.setPermissionCheckHandler((_webContents, permission) => {
      return !['media', 'geolocation', 'notifications', 'midiSysex', 'openExternal'].includes(permission);
    });
    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(!['media', 'geolocation', 'notifications', 'midiSysex', 'openExternal'].includes(permission));
    });

    const accountDownloadDir = this.accountPath(this.downloadRoot, account.id);
    fs.mkdirSync(accountDownloadDir, { recursive: true });
    ses.on('will-download', (_event, item) => {
      const target = path.join(accountDownloadDir, safeFileName(item.getFilename()));
      item.setSavePath(target);
      this.emit('download-started', { accountId: account.id, filename: item.getFilename(), target });
    });
  }

  start(accountId, options = {}) {
    if (!this.acceptingStarts || this.blockedAccountIds.has(accountId)) return Promise.reject(new Error('账户正在关闭或删除'));
    const result = this.startQueue.then(() => this.startInternal(accountId, options));
    this.startQueue = result.catch(() => {});
    return result;
  }

  async startInternal(accountId, options = {}) {
    const running = this.instances.get(accountId);
    if (running) {
      if (options.activate !== false) this.activate(accountId);
      return { accountId, status: 'running' };
    }
    const account = this.store.findAccount(accountId);
    if (!account) throw new Error('账户不存在');
    await this.enforceCapacity(accountId);
    const ses = session.fromPath(this.profilePath(accountId), { cache: true });
    this.configureSession(account, ses);
    await this.applyProxy(accountId, account.proxy);

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
      },
    });
    view.setBackgroundColor('#0c111d');
    view.setBounds(this.bounds);
    view.setVisible(false);
    const contents = view.webContents;
    contents.setBackgroundThrottling(true);
    if (account.environment?.userAgent) contents.setUserAgent(account.environment.userAgent);

    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) contents.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault();
    });
    contents.on('did-navigate', (_event, url) => this.handleNavigation(accountId, url));
    contents.on('did-navigate-in-page', (_event, url) => this.handleNavigation(accountId, url));
    contents.on('page-title-updated', (_event, title) => this.emit('title', { accountId, title }));
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) {
        this.store.updateAccount(accountId, { lastError: `${description} (${code})` }).catch(() => {});
        this.emit('load-error', { accountId, code, description, url });
      }
    });
    contents.on('render-process-gone', (_event, details) => this.handleCrash(accountId, details).catch(() => {}));
    contents.on('did-finish-load', () => this.tryAutoFill(accountId).catch(() => {}));

    this.mainWindow.contentView.addChildView(view);
    this.instances.set(accountId, { view, session: ses, lastActiveAt: Date.now() });
    await this.store.updateAccount(accountId, {
      status: 'running',
      lastOpenedAt: new Date().toISOString(),
      lastError: '',
    });
    await contents.loadURL(normalizeUrl(account.currentUrl || account.startUrl));
    if (options.activate !== false) this.activate(accountId);
    this.emit('started', { accountId });
    return { accountId, status: 'running' };
  }

  async handleNavigation(accountId, url) {
    await this.store.updateAccount(accountId, { currentUrl: url, lastError: '' }).catch(() => {});
    this.emit('navigation', {
      accountId,
      url,
      canGoBack: this.instances.get(accountId)?.view.webContents.canGoBack() || false,
      canGoForward: this.instances.get(accountId)?.view.webContents.canGoForward() || false,
    });
  }

  async tryAutoFill(accountId) {
    const account = this.store.findAccount(accountId);
    const instance = this.instances.get(accountId);
    if (!account?.autoLogin?.enabled || !instance || !account.autoLogin.secretRef) return;
    const current = new URL(instance.view.webContents.getURL());
    const login = new URL(account.autoLogin.loginUrl);
    if (current.origin !== login.origin) return;
    if (current.protocol !== 'https:' && current.hostname !== 'localhost') return;
    const usernameSelector = account.autoLogin.usernameSelector;
    const passwordSelector = account.autoLogin.passwordSelector;
    if (!usernameSelector || !passwordSelector) return;
    const password = this.vault.get(account.autoLogin.secretRef);
    const script = `(() => {
      const setValue = (selector, value) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter ? setter.call(element, value) : (element.value = value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      return {
        username: setValue(${JSON.stringify(usernameSelector)}, ${JSON.stringify(account.username)}),
        password: setValue(${JSON.stringify(passwordSelector)}, ${JSON.stringify(password)})
      };
    })()`;
    await instance.view.webContents.executeJavaScript(script, true);
    this.emit('credentials-filled', { accountId });
  }

  activate(accountId) {
    if (!this.instances.has(accountId)) return false;
    for (const [id, instance] of this.instances) {
      instance.view.setVisible(id === accountId);
      if (id === accountId) {
        instance.view.setBounds(this.bounds);
        instance.lastActiveAt = Date.now();
      }
    }
    this.activeId = accountId;
    this.emit('activated', { accountId });
    return true;
  }

  setBounds(bounds) {
    const next = {
      x: Math.max(0, Math.round(bounds.x || 0)),
      y: Math.max(0, Math.round(bounds.y || 0)),
      width: Math.max(1, Math.round(bounds.width || 1)),
      height: Math.max(1, Math.round(bounds.height || 1)),
    };
    this.bounds = next;
    if (this.activeId) this.instances.get(this.activeId)?.view.setBounds(next);
  }

  async stop(accountId) {
    const instance = this.instances.get(accountId);
    if (!instance) return { accountId, status: 'stopped' };
    await this.disposeInstance(accountId, true);
    await this.store.updateAccount(accountId, { status: 'stopped' });
    this.emit('stopped', { accountId });
    return { accountId, status: 'stopped' };
  }

  async disposeInstance(accountId, flush) {
    const instance = this.instances.get(accountId);
    if (!instance) return;
    const wasActive = this.activeId === accountId;
    try {
      const flushResult = flush ? instance.session.flushStorageData() : null;
      if (flushResult && typeof flushResult.then === 'function') await flushResult;
    } catch {
      // Closing the isolated view remains safe even if Chromium cannot flush a damaged profile.
    }
    try { instance.view.setVisible(false); } catch {}
    try { this.mainWindow.contentView.removeChildView(instance.view); } catch {}
    try {
      if (!instance.view.webContents.isDestroyed()) instance.view.webContents.close();
    } catch {}
    this.instances.delete(accountId);
    if (wasActive) {
      this.activeId = null;
      const nextId = this.instances.keys().next().value;
      if (nextId) this.activate(nextId);
    }
  }

  async stopAll() {
    for (const id of [...this.instances.keys()]) await this.stop(id);
  }

  async handleCrash(accountId, details) {
    await this.disposeInstance(accountId, false);
    await this.store.updateAccount(accountId, { status: 'crashed', lastError: details.reason });
    this.emit('crashed', { accountId, reason: details.reason });
  }

  updateResourceLimits({ maxRunningAccounts, idleStopMinutes, memoryLimitMb } = {}) {
    this.maxRunningAccounts = Math.min(30, Math.max(1, Number.parseInt(maxRunningAccounts, 10) || 8));
    this.idleStopMinutes = Math.min(1440, Math.max(0, Number.parseInt(idleStopMinutes, 10) || 0));
    this.memoryLimitMb = Math.min(32768, Math.max(1024, Number.parseInt(memoryLimitMb, 10) || 4096));
    return this.trimToLimit();
  }

  async enforceCapacity(incomingId) {
    while (!this.instances.has(incomingId) && this.instances.size >= this.maxRunningAccounts) {
      const candidate = [...this.instances.entries()]
        .filter(([id]) => id !== incomingId)
        .sort((left, right) => left[1].lastActiveAt - right[1].lastActiveAt)
        .find(([id]) => id !== this.activeId) || [...this.instances.entries()][0];
      if (!candidate) break;
      await this.stop(candidate[0]);
      this.emit('resource-released', { accountId: candidate[0], reason: 'limit' });
    }
  }

  async trimToLimit() {
    while (this.instances.size > this.maxRunningAccounts) {
      const candidate = [...this.instances.entries()]
        .sort((left, right) => left[1].lastActiveAt - right[1].lastActiveAt)
        .find(([id]) => id !== this.activeId) || [...this.instances.entries()][0];
      if (!candidate) break;
      await this.stop(candidate[0]);
      this.emit('resource-released', { accountId: candidate[0], reason: 'limit' });
    }
  }

  async stopIdleInstances() {
    if (!this.idleStopMinutes) return;
    const cutoff = Date.now() - this.idleStopMinutes * 60 * 1000;
    const idleIds = [...this.instances.entries()]
      .filter(([id, instance]) => id !== this.activeId && instance.lastActiveAt < cutoff)
      .map(([id]) => id);
    for (const id of idleIds) {
      await this.stop(id);
      this.emit('resource-released', { accountId: id, reason: 'idle' });
    }
  }

  workingSetMb() {
    try {
      const totalKb = app.getAppMetrics().reduce((total, metric) => total + Number(metric.memory?.workingSetSize || 0), 0);
      return totalKb / 1024;
    } catch {
      return 0;
    }
  }

  async releaseForMemoryPressure() {
    const candidates = [...this.instances.entries()]
      .filter(([id]) => id !== this.activeId)
      .sort((left, right) => left[1].lastActiveAt - right[1].lastActiveAt)
      .map(([id]) => id);
    for (const id of candidates) {
      if (this.workingSetMb() <= this.memoryLimitMb) break;
      await this.stop(id);
      this.emit('resource-released', { accountId: id, reason: 'memory' });
    }
  }

  async sweepResources() {
    await this.stopIdleInstances();
    await this.releaseForMemoryPressure();
  }

  async removeAccountData(accountId) {
    this.blockedAccountIds.add(accountId);
    await this.startQueue.catch(() => {});
    const browserSession = this.getSession(accountId);
    await Promise.all([
      browserSession.clearCache().catch(() => {}),
      browserSession.clearStorageData().catch(() => {}),
      browserSession.closeAllConnections().catch(() => {}),
    ]);
    await this.stop(accountId);
    const targets = [this.profilePath(accountId), this.accountPath(this.downloadRoot, accountId)];
    const pendingPaths = [];
    for (const target of targets) {
      try {
        await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      } catch {
        pendingPaths.push(target);
      }
    }
    return { pendingPaths };
  }

  async shutdown() {
    this.acceptingStarts = false;
    await this.startQueue.catch(() => {});
    if (this.resourceTimer) clearInterval(this.resourceTimer);
    this.resourceTimer = null;
    await this.stopAll();
  }

  async navigate(accountId, url) {
    if (!this.instances.has(accountId)) await this.start(accountId);
    const target = normalizeUrl(url);
    await this.instances.get(accountId).view.webContents.loadURL(target);
    return target;
  }

  command(accountId, command) {
    const contents = this.instances.get(accountId)?.view.webContents;
    if (!contents) throw new Error('账户窗口尚未启动');
    if (command === 'back' && contents.canGoBack()) contents.goBack();
    else if (command === 'forward' && contents.canGoForward()) contents.goForward();
    else if (command === 'reload') contents.reload();
    else if (command === 'home') {
      const account = this.store.findAccount(accountId);
      contents.loadURL(account.startUrl).catch(() => {});
    }
  }

  async clear(accountId, mode, origin = '') {
    const ses = this.getSession(accountId);
    if (mode === 'cache') {
      await ses.clearCache();
    } else if (mode === 'history') {
      await Promise.all([ses.clearCache(), ses.clearStorageData({ storages: ['indexdb', 'serviceworkers', 'cachestorage'] })]);
    } else if (mode === 'site') {
      if (!origin) throw new Error('无法确定当前站点');
      await ses.clearStorageData({ origin, storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    } else if (mode === 'all') {
      await Promise.all([ses.clearCache(), ses.clearStorageData()]);
    } else {
      throw new Error('未知清理模式');
    }
    this.emit('cleared', { accountId, mode });
    return true;
  }

  currentUrl(accountId) {
    return this.instances.get(accountId)?.view.webContents.getURL()
      || this.store.findAccount(accountId)?.currentUrl
      || '';
  }

  isRunning(accountId) {
    return this.instances.has(accountId);
  }

  emit(type, payload) {
    this.onEvent?.({ type, ...payload });
  }
}

module.exports = { ProfileManager };
