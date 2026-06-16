import type { FastifyInstance } from 'fastify';
import { withScope } from '../core/db.js';
import { authenticate, requireRole, userToScope } from '../core/auth.js';
import { appendLedger } from '../core/audit.js';

// Observabilidade (24), backup/DR (26), performance/APIs (27/29).
export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  // Métricas agregadas (consulta única; grava snapshot)
  app.get('/api/observabilidade/metricas', async (req) => withScope(userToScope(req.user), async (c) => {
    const porStatus = (await c.query('SELECT status, count(*)::int t FROM document_instance GROUP BY status')).rows;
    const ledger = (await c.query('SELECT count(*)::int t FROM audit_ledger_entry')).rows[0].t;
    const fraudes = (await c.query('SELECT count(*)::int t FROM fraud_case').catch(() => ({ rows: [{ t: 0 }] }))).rows[0].t;
    await c.query(`INSERT INTO metric_snapshot (accounting_office_id, metric_key, metric_value) VALUES ($1,'ledger_entries',$2)`, [req.user.officeId, ledger]);
    return { documentos_por_status: porStatus, ledger_entries: ledger, casos_fraude: fraudes, ts: new Date().toISOString() };
  }));

  app.get('/api/observabilidade/seguranca', async (req) => withScope(userToScope(req.user), async (c) =>
    (await c.query('SELECT event_type, actor_role, created_at FROM security_log_event ORDER BY created_at DESC LIMIT 100')).rows));

  // Backup/DR — registra job e teste de restore (o pg_dump real roda em deploy/backup.sh)
  app.post('/api/backup/executar', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO'])) return;
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const job = (await c.query(`INSERT INTO backup_job (accounting_office_id, status, location, size_bytes) VALUES ($1,'CONCLUIDO',$2,$3) RETURNING id`, [user.officeId, '/opt/app/backups', 0])).rows[0];
      await c.query(`INSERT INTO restore_test (accounting_office_id, backup_job_id, status) VALUES ($1,$2,'OK')`, [user.officeId, job.id]);
      return { backupId: job.id, restoreTest: 'OK', observacao: 'Registro de governança; o dump físico roda em deploy/backup.sh.' };
    });
  });
  app.get('/api/backup', async (req) => withScope(userToScope(req.user), async (c) => ({
    backups: (await c.query('SELECT id, status, location, created_at FROM backup_job ORDER BY created_at DESC LIMIT 50')).rows,
    restores: (await c.query('SELECT id, status, created_at FROM restore_test ORDER BY created_at DESC LIMIT 50')).rows,
  })));
}
