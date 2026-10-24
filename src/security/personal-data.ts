import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encryptionKey(): Buffer {
  const configured = env.personalDataEncryptionKey.trim();
  if (!configured) {
    throw new Error('A variável de ambiente PERSONAL_DATA_ENCRYPTION_KEY não foi configurada.');
  }
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error('PERSONAL_DATA_ENCRYPTION_KEY deve conter exatamente 32 bytes em hexadecimal ou Base64.');
  }
  return key;
}

export function assertPersonalDataEncryptionKey(): void {
  encryptionKey();
}

function additionalData(userId: string, field: string): Buffer {
  return Buffer.from(`sosplus:dados-pessoais:${userId}:${field}`, 'utf8');
}

export function fingerprintPersonalData(field: string, value: string): Buffer {
  const key = createHmac('sha256', encryptionKey()).update('sosplus:indice-dados-pessoais:v1').digest();
  return createHmac('sha256', key)
    .update(`sosplus:dados-pessoais:${field}:v1\0`, 'utf8')
    .update(value, 'utf8')
    .digest();
}

export function encryptPersonalData(userId: string, field: string, value: string | null): Buffer | null {
  if (value === null) return null;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(additionalData(userId, field));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), encrypted]);
}

export function decryptPersonalData(userId: string, field: string, value: Buffer | null): string | null {
  if (value === null) return null;
  if (value.length < 1 + IV_LENGTH + TAG_LENGTH || value[0] !== VERSION) {
    throw new Error(`Formato cifrado inválido para ${field}.`);
  }
  const ivStart = 1;
  const tagStart = ivStart + IV_LENGTH;
  const contentStart = tagStart + TAG_LENGTH;
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), value.subarray(ivStart, tagStart));
  decipher.setAAD(additionalData(userId, field));
  decipher.setAuthTag(value.subarray(tagStart, contentStart));
  return Buffer.concat([decipher.update(value.subarray(contentStart)), decipher.final()]).toString('utf8');
}
