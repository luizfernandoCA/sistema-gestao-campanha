import crypto from 'node:crypto';
import { env } from './env.js';

const MASTER_KEY = Buffer.from(env.masterKeyB64, 'base64');
if (MASTER_KEY.length !== 32) {
  throw new Error('MASTER_KEY_B64 deve ser 32 bytes em base64');
}
export const MASTER_KEY_ID = 'kms-local-v1';

export function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function hmac(value: string): string {
  return crypto.createHmac('sha256', env.hmacKey).update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ---- Envelope encryption (AES-256-GCM) ----
// Gera uma data key aleatória, cifra o conteúdo com ela e "embrulha"
// (wrap) a data key com a chave mestra. Substituível por KMS/HSM real.
export interface Envelope {
  ciphertext: Buffer;     // iv(12) + tag(16) + dados
  encryptedDataKey: string; // base64: iv(12)+tag(16)+key cifrada
  keyId: string;
}

function gcmEncrypt(key: Buffer, plaintext: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

function gcmDecrypt(key: Buffer, blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const data = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function envelopeEncrypt(plaintext: Buffer): Envelope {
  const dataKey = crypto.randomBytes(32);
  const ciphertext = gcmEncrypt(dataKey, plaintext);
  const encryptedDataKey = gcmEncrypt(MASTER_KEY, dataKey).toString('base64');
  return { ciphertext, encryptedDataKey, keyId: MASTER_KEY_ID };
}

export function envelopeDecrypt(ciphertext: Buffer, encryptedDataKey: string): Buffer {
  const dataKey = gcmDecrypt(MASTER_KEY, Buffer.from(encryptedDataKey, 'base64'));
  return gcmDecrypt(dataKey, ciphertext);
}

// Cifra um campo de texto curto (CPF, telefone) para guardar no banco.
export function encField(plaintext: string): string {
  const dataKey = crypto.randomBytes(32);
  const ct = gcmEncrypt(dataKey, Buffer.from(plaintext, 'utf8')).toString('base64');
  const edk = gcmEncrypt(MASTER_KEY, dataKey).toString('base64');
  return `${edk}.${ct}`;
}

export function decField(stored: string): string {
  const [edk, ct] = stored.split('.');
  const dataKey = gcmDecrypt(MASTER_KEY, Buffer.from(edk, 'base64'));
  return gcmDecrypt(dataKey, Buffer.from(ct, 'base64')).toString('utf8');
}

// Versão tolerante p/ EXIBIÇÃO: nunca lança (campo nulo/legado/corrompido vira
// ''), evitando que uma única linha ruim derrube uma listagem inteira.
export function decFieldSafe(stored: string | null | undefined): string {
  if (!stored) return '';
  try { return decField(stored); } catch { return ''; }
}
