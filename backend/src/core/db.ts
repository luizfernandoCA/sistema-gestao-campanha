import pg from 'pg';
import { env } from './env.js';

// Dois pools, por design de segurança:
//  - adminPool: conecta como owner (BYPASS RLS). SÓ para autenticação e migrations.
//  - appPool:  conecta como app_rw (RLS aplicado). Para TODA query de negócio.
export const adminPool = new pg.Pool({ connectionString: env.adminDatabaseUrl, max: 5 });
export const appPool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });

export interface Scope {
  userId: string;
  role: string;
  officeId: string;
  candidateIds: string[]; // candidatos que o usuário pode acessar
}

// Executa uma função dentro de uma transação com o escopo do usuário
// aplicado via SET LOCAL. As políticas de RLS leem esses GUCs.
export async function withScope<T>(scope: Scope, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.office_id', $1, true)", [scope.officeId]);
    await client.query("SELECT set_config('app.candidate_ids', $1, true)", [scope.candidateIds.join(',')]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [scope.userId]);
    await client.query("SELECT set_config('app.role', $1, true)", [scope.role]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
