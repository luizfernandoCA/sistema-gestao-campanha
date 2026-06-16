import { appPool } from './db.js';

// Idempotência de POSTs críticos. Reexecução com a mesma chave devolve o
// primeiro resultado, sem duplicar efeito (a tabela idempotency_record não tem RLS).
export async function withIdempotency<T>(key: string | undefined, userId: string, fn: () => Promise<T>): Promise<T> {
  if (!key) return fn();
  // A chave é escopada pelo usuário: ninguém envenena a resposta de outro
  // forjando uma chave previsível.
  const scoped = `${userId}:${key}`;
  const ex = await appPool.query('SELECT response_json FROM idempotency_record WHERE key = $1', [scoped]);
  if (ex.rowCount) return ex.rows[0].response_json as T;
  const res = await fn();
  await appPool.query(
    'INSERT INTO idempotency_record (key, user_id, response_json) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING',
    [scoped, userId, JSON.stringify(res)],
  );
  return res;
}

// Mascara dados sensíveis para exibição/log (mantém só o final).
export function mask(value: string, keep = 2): string {
  if (!value) return '';
  const v = String(value);
  return v.length <= keep ? '*'.repeat(v.length) : '*'.repeat(v.length - keep) + v.slice(-keep);
}

// Rate limiter simples em memória (janela deslizante por IP+rota).
const buckets = new Map<string, number[]>();
export function rateLimit(id: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(id, arr); return false; }
  arr.push(now); buckets.set(id, arr); return true;
}
