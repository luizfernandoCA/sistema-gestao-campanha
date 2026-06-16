import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Bootstrap idempotente para o container: espera o banco, aplica schema+seed
// apenas na primeira vez e garante a senha do papel app_rw. Preserva dados em restart.
const ADMIN = process.env.ADMIN_DATABASE_URL;
if (!ADMIN) throw new Error('ADMIN_DATABASE_URL ausente');
const appPassword = process.env.APP_DB_PASSWORD ?? '';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitDb(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try { const p = new pg.Pool({ connectionString: ADMIN, max: 1 }); await p.query('SELECT 1'); await p.end(); return; }
    catch { console.log('aguardando banco…'); await sleep(2000); }
  }
  throw new Error('banco indisponível');
}

async function main() {
  await waitDb();
  const pool = new pg.Pool({ connectionString: ADMIN, max: 1 });
  const exists = (await pool.query("SELECT to_regclass('public.accounting_office') AS t")).rows[0].t;
  if (!exists) {
    console.log('Primeira inicialização: aplicando schema e seed…');
    execSync('npm run migrate', { stdio: 'inherit' });
    execSync('npm run seed', { stdio: 'inherit' });
  } else {
    console.log('Schema já existe; aplicando 002 (endurecimento) e 003 (módulos) idempotentes e senha do app_rw.');
    for (const f of ['002_hardening.sql', '003_modules.sql']) {
      await pool.query(fs.readFileSync(path.resolve(process.cwd(), '../db', f), 'utf8'));
    }
    if (appPassword) await pool.query(`ALTER ROLE app_rw LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}'`);
  }
  await pool.end();
  console.log('Bootstrap concluído.');
}
main().catch((e) => { console.error('Bootstrap falhou:', e.message); process.exit(1); });
