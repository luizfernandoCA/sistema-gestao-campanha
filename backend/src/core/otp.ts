import Redis from 'ioredis';
import { env } from './env.js';

// Store de OTP em Redis (antes era um Map em memória — perdia OTPs em restart e
// não funcionava com mais de uma instância). Cada desafio é um hash Redis com
// TTL: a expiração é feita pelo próprio Redis (não há mais campo "exp").
//   chave  -> otp:<sha256(token)>
//   campos -> otp (código), tentativas (contador)
const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 3,
  // Não derruba o processo se o Redis ainda não subiu; ioredis reconecta sozinho.
  lazyConnect: false,
});
redis.on('error', (e) => { console.error('redis: erro de conexão:', e.message); });

const k = (hash: string) => `otp:${hash}`;

export interface OtpChallenge { otp: string; tentativas: number; }

// Cria/sobrescreve o desafio com TTL (ms).
export async function otpSet(hash: string, otp: string, ttlMs: number): Promise<void> {
  const key = k(hash);
  await redis.hset(key, { otp, tentativas: '0' });
  await redis.pexpire(key, ttlMs);
}

// Lê o desafio; null se inexistente/expirado (TTL do Redis cuida da expiração).
export async function otpGet(hash: string): Promise<OtpChallenge | null> {
  const h = await redis.hgetall(k(hash));
  if (!h || !h.otp) return null;
  return { otp: h.otp, tentativas: Number(h.tentativas ?? 0) };
}

// Incrementa o contador de tentativas e devolve o novo valor (preserva o TTL).
export async function otpIncrTentativas(hash: string): Promise<number> {
  return redis.hincrby(k(hash), 'tentativas', 1);
}

export async function otpDel(hash: string): Promise<void> {
  await redis.del(k(hash));
}
