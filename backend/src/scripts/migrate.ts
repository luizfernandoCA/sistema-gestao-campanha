import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Roda como OWNER (ADMIN_DATABASE_URL) para criar schema, RLS e o papel app_rw.
const adminUrl = process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error('ADMIN_DATABASE_URL ausente');
const appPassword = process.env.APP_DB_PASSWORD;

const dbDir = process.env.DB_DIR ?? path.resolve(process.cwd(), '../db');
const files = ['001_schema.sql', '002_hardening.sql', '003_modules.sql'];

async function main() {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const c = await pool.connect();
  try {
    for (const f of files) {
      await c.query(fs.readFileSync(path.join(dbDir, f), 'utf8'));
      console.log(`Aplicado: ${f}`);
    }
    if (appPassword) {
      await c.query(`ALTER ROLE app_rw LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}'`);
      console.log('Senha do papel app_rw atualizada a partir de APP_DB_PASSWORD.');
    }
    console.log('Migration aplicada com sucesso.');
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error('Falha na migration:', e.message); process.exit(1); });
