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
    this.activeId = null;
    this.bounds = { x: 300, y: 110, width: 800, height: 500 };
    this.onEvent = onEvent;
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
  }

  profilePath(accountId) {
    return path.join(this.profileRoot, accountId);
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
    const language = account.environment?.acceptLanguage;
    if (language) {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['Accept-Language'] = language;
        if (account.environment?.doNotTrack) details.requestHeaders.DNT = '1';
        callback({ requestHeaders: details.requestHeaders });
      });
    } else if (account.environment?.doNotTrack) {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders.DNT = '1';
        callback({ requestHeaders: details.requestHeaders });
      });
    }

    ses.setPermissionCheckHandler((_webContents, permission) => {
      return !['media', 'geolocation', 'notifications', 'midiSysex', 'openExternal'].includes(permission);
    });
    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(!['media', 'geolocation', 'notifications', 'midiSysex', 'openExternal'].includes(permission));
    });

    const accountDownloadDir = path.join(this.downloadRoot, account.id);
    fs.mkdirSync(accountDownloadDir, { recursive: true });
    ses.on('will-download', (_event, item) => {
      const target = path.join(accountDownloadDir, safeFileName(item.getFilename()));
      item.setSavePath(target);
      this.emit('download-started', { accountId: account.id, filename: item.getFilename(), target });
    });
  }

  async start(accountId, options = {}) {
    const running = this.instances.get(accountId);
    if (running) {
      if (options.activate !== false) this.activate(accountId);
      return { accountId, status: 'running' };
    }
    const account = this.store.findAccount(accountId);
    if (!account) throw new Error('账户不存在');
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
    contents.on('render-process-gone', (_event, details) => {
      this.store.updateAccount(accountId, { status: 'crashed', lastError: details.reason }).catch(() => {});
      this.emit('crashed', { accountId, reason: details.reason });
    });
    contents.on('did-finish-load', () => this.tryAutoFill(accountId).catch(() => {}));

    this.mainWindow.contentView.addChildView(view);
    this.instances.set(accountId, { view, session: ses });
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
      if (id === accountId) instance.view.setBounds(this.bounds);
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
    const wasActive = this.activeId === accountId;
    try {
      const flushResult = instance.session.flushStorageData();
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
    await this.store.updateAccount(accountId, { status: 'stopped' });
    this.emit('stopped', { accountId });
    return { accountId, status: 'stopped' };
  }

  async stopAll() {
    for (const id of [...this.instances.keys()]) await this.stop(id);
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
