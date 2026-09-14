const crypto = require('node:crypto');

const MAGIC = 'PROFILEDESK_PACKAGE_V1';

function encryptPackage(value, password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('导出密码至少需要8个字符');
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(MAGIC));
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), 'utf8')),
    cipher.final(),
  ]);
  return Buffer.from(JSON.stringify({
    magic: MAGIC,
    kdf: 'scrypt-N32768-r8-p1',
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  }), 'utf8');
}

function decryptPackage(buffer, password) {
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(buffer).toString('utf8'));
  } catch {
    throw new Error('导入文件格式无效');
  }
  if (envelope.magic !== MAGIC) throw new Error('不是受支持的ProfileDesk文件');
  try {
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const key = crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(MAGIC));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw new Error('密码错误或导入文件已损坏');
  }
}

module.exports = { MAGIC, decryptPackage, encryptPackage };
