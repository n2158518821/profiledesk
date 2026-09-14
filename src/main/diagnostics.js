const dns = require('node:dns').promises;
const net = require('node:net');
const tls = require('node:tls');

function duration(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1e6);
}

async function timed(label, task) {
  const start = process.hrtime.bigint();
  try {
    const detail = await task();
    return { label, ok: true, durationMs: duration(start), detail };
  } catch (error) {
    return { label, ok: false, durationMs: duration(start), error: error.message };
  }
}

function tcping(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const finish = (error) => {
      socket.destroy();
      error ? reject(error) : resolve(`${host}:${port}`);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error('连接超时')));
    socket.once('connect', () => finish());
    socket.once('error', finish);
  });
}

function tlsCheck(host, port = 443, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true });
    const finish = (error, value) => {
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error('TLS握手超时')));
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      finish(null, {
        protocol: socket.getProtocol(),
        subject: certificate.subject?.CN || '',
        issuer: certificate.issuer?.CN || '',
        validTo: certificate.valid_to || '',
      });
    });
    socket.once('error', (error) => finish(error));
  });
}

async function resolveDns(hostname) {
  const [a, aaaa, cname] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
    dns.resolveCname(hostname),
  ]);
  return {
    A: a.status === 'fulfilled' ? a.value : [],
    AAAA: aaaa.status === 'fulfilled' ? aaaa.value : [],
    CNAME: cname.status === 'fulfilled' ? cname.value : [],
  };
}

async function runDiagnostics(rawUrl, session) {
  const url = new URL(rawUrl);
  const host = url.hostname;
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const checks = [];
  checks.push(await timed('DNS解析', () => resolveDns(host)));
  checks.push(await timed(`TCP ${port}`, () => tcping(host, port)));
  if (url.protocol === 'https:') checks.push(await timed('TLS证书', () => tlsCheck(host, port)));
  checks.push(await timed('浏览器线路HTTP', async () => {
    const response = await session.fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
    });
    await response.body?.cancel().catch(() => {});
    return {
      status: response.status,
      statusText: response.statusText,
      location: response.headers.get('location') || '',
    };
  }));
  return { url: url.toString(), host, port, checkedAt: new Date().toISOString(), checks };
}

module.exports = { resolveDns, runDiagnostics, tcping, tlsCheck, timed };
