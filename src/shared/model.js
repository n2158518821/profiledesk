const { randomUUID } = require('node:crypto');

const DEFAULT_ENVIRONMENT = Object.freeze({
  preset: 'privacy',
  acceptLanguage: '',
  userAgent: '',
  doNotTrack: true,
  denyMediaPermissions: true,
});

const DEFAULT_PROXY = Object.freeze({
  mode: 'system',
  server: '',
  bypassRules: '<local>',
  username: '',
  secretRef: '',
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeUrl(input) {
  const value = String(input || '').trim();
  if (!value) return 'https://example.com/';
  const explicitScheme = value.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  if (explicitScheme && !['http', 'https'].includes(explicitScheme)) {
    throw new Error('仅允许 HTTP 或 HTTPS 地址');
  }
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('网址格式无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('仅允许 HTTP 或 HTTPS 地址');
  }
  return parsed.toString();
}

function normalizeProxy(value = {}) {
  const mode = ['system', 'direct', 'fixed_servers'].includes(value.mode)
    ? value.mode
    : 'system';
  return {
    ...DEFAULT_PROXY,
    ...value,
    mode,
    server: String(value.server || '').trim(),
    bypassRules: String(value.bypassRules || '<local>').trim(),
    username: String(value.username || '').trim(),
    secretRef: String(value.secretRef || '').trim(),
  };
}

function normalizeEnvironment(value = {}) {
  const acceptLanguage = String(value.acceptLanguage || '').trim();
  if (acceptLanguage && !/^[A-Za-z0-9,;=._* -]{1,200}$/.test(acceptLanguage)) {
    throw new Error('浏览器语言格式无效');
  }
  return {
    ...DEFAULT_ENVIRONMENT,
    preset: 'privacy',
    acceptLanguage,
    userAgent: String(value.userAgent || '').replace(/[\r\n]/g, '').trim().slice(0, 512),
    doNotTrack: value.doNotTrack !== false,
    denyMediaPermissions: value.denyMediaPermissions !== false,
  };
}

function normalizeAutoLogin(value = {}, startUrl) {
  const limited = (input) => String(input || '').trim().slice(0, 300);
  return {
    enabled: Boolean(value.enabled),
    loginUrl: value.loginUrl ? normalizeUrl(value.loginUrl) : startUrl,
    usernameSelector: limited(value.usernameSelector),
    passwordSelector: limited(value.passwordSelector),
    submitSelector: limited(value.submitSelector),
    submitAutomatically: false,
    secretRef: String(value.secretRef || '').trim(),
  };
}

function createSite(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('业务站名称不能为空');
  return {
    id: input.id || randomUUID(),
    name,
    homeUrl: normalizeUrl(input.homeUrl),
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    note: String(input.note || ''),
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function createAccount(input = {}, site) {
  if (!site) throw new Error('找不到所属业务站');
  const name = String(input.name || '').trim();
  if (!name) throw new Error('账户名称不能为空');
  const startUrl = normalizeUrl(input.startUrl || site.homeUrl);
  return {
    id: input.id || randomUUID(),
    siteId: site.id,
    name,
    username: String(input.username || '').trim(),
    startUrl,
    currentUrl: startUrl,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    note: String(input.note || ''),
    proxy: normalizeProxy(input.proxy),
    environment: normalizeEnvironment(input.environment),
    autoLogin: normalizeAutoLogin(input.autoLogin, startUrl),
    status: 'stopped',
    lastError: '',
    lastOpenedAt: null,
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function publicAccount(account) {
  return {
    ...account,
    proxy: { ...account.proxy, hasPassword: Boolean(account.proxy?.secretRef), secretRef: '' },
    autoLogin: {
      ...account.autoLogin,
      hasPassword: Boolean(account.autoLogin?.secretRef),
      secretRef: '',
    },
  };
}

module.exports = {
  DEFAULT_ENVIRONMENT,
  DEFAULT_PROXY,
  createAccount,
  createSite,
  normalizeAutoLogin,
  normalizeEnvironment,
  normalizeProxy,
  normalizeUrl,
  nowIso,
  publicAccount,
};
