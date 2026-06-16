import type { FastifyInstance } from 'fastify';
import { withScope } from '../core/db.js';
import { authenticate, requireRole, userToScope } from '../core/auth.js';
import { appendLedger } from '../core/audit.js';
import { sha256 } from '../core/crypto.js';
import { mask } from '../core/util.js';

// LGPD (22), suporte seguro (23), incidente (25), auditoria externa (28).
export async function modules3(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  // ================= LGPD / privacidade =================
  app.post('/api/lgpd/solicitacao', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'SUPORTE_INTERNO'])) return;
    const b = (req.body as any) ?? {}; const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const r = (await c.query(`INSERT INTO data_subject_request (accounting_office_id, subject_ref, request_type) VALUES ($1,$2,$3) RETURNING id`, [user.officeId, mask(String(b.subjectRef ?? '')), b.tipo ?? 'ACESSO'])).rows[0];
      return { id: r.id, status: 'RECEBIDO' };
    });
  });
  app.get('/api/lgpd/solicitacoes', async (req) => withScope(userToScope(req.user), async (c) =>
    (await c.query('SELECT id, request_type, status, created_at FROM data_subject_request ORDER BY created_at DESC LIMIT 100')).rows));

  app.post('/api/lgpd/retencao', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO'])) return;
    const b = (req.body as any) ?? {}; const user = req.user;
    return withScope(userToScope(user), async (c) =>
      (await c.query(`INSERT INTO retention_policy (accounting_office_id, name, retention_days) VALUES ($1,$2,$3) RETURNING id, name, retention_days`, [user.officeId, b.nome ?? 'Padrão', Number(b.dias ?? 1825)])).rows[0]);
  });

  app.post('/api/lgpd/legal-hold', async (req, reply) => {
    if (!requireRole(req, reply, ['JURIDICO', 'CONTADOR'])) return;
    const b = (req.body as any) ?? {}; const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const r = (await c.query(`INSERT INTO legal_hold (accounting_office_id, candidate_id, reason) VALUES ($1,$2,$3) RETURNING id`, [user.officeId, b.candidateId, b.motivo ?? ''])).rows[0];
      await appendLedger(c, { candidateId: b.candidateId, officeId: user.officeId, resourceType: 'legal_hold', resourceId: r.id, eventType: 'LEGAL_HOLD_ATIVADO', actorUserId: user.sub, actorRole: user.role });
      return { id: r.id, ativo: true };
    });
  });

  // Descarte: legal hold ativo BLOQUEIA o descarte.
  app.post('/api/lgpd/descarte', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO'])) return;
    const b = (req.body as any) ?? {}; const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const hold = (await c.query("SELECT 1 FROM legal_hold WHERE candidate_id=$1 AND active=true LIMIT 1", [b.candidateId])).rowCount;
      const status = hold ? 'BLOQUEADO' : 'EXECUTADO';
      const r = (await c.query(`INSERT INTO disposal_job (accounting_office_id, candidate_id, status, blocked_by_hold) VALUES ($1,$2,$3,$4) RETURNING id`, [user.officeId, b.candidateId, status, !!hold])).rows[0];
      await appendLedger(c, { candidateId: b.candidateId, officeId: user.officeId, resourceType: 'disposal', resourceId: r.id, eventType: 'DESCARTE', actorUserId: user.sub, actorRole: user.role, payload: { status } });
      return { id: r.id, status, bloqueadoPorLegalHold: !!hold };
    });
  });

  // ================= Suporte seguro (acesso just-in-time, mascarado) =================
  app.post('/api/suporte/acesso/solicitar', async (req, reply) => {
    if (!requireRole(req, reply, ['SUPORTE_INTERNO'])) return;
    const b = (req.body as any) ?? {}; const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const r = (await c.query(`INSERT INTO support_access_request (accounting_office_id, candidate_id, requester_user_id, reason, expires_at) VALUES ($1,$2,$3,$4, now() + interval '2 hours') RETURNING id`, [user.officeId, b.candidateId, user.sub, b.motivo ?? ''])).rows[0];
      return { requestId: r.id, status: 'PENDENTE' };
    });
  });
  app.post('/api/suporte/acesso/:reqId/aprovar', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'ADMINISTRADOR_CAMPANHA'])) return;
    const reqId = (req.params as any).reqId; const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const ar = (await c.query("SELECT id, candidate_id, accounting_office_id FROM support_access_request WHERE id=$1 AND status='PENDENTE'", [reqId])).rows[0];
      if (!ar) return reply.code(404).send({ erro: 'pedido não encontrado/pendente no escopo' });
      await c.query("UPDATE support_access_request SET status='APROVADA', approved_by=$2 WHERE id=$1", [reqId, user.sub]);
      const s = (await c.query(`INSERT INTO support_access_session (accounting_office_id, candidate_id, request_id, expires_at) VALUES ($1,$2,$3, now() + interval '1 hour') RETURNING id`, [ar.accounting_office_id, ar.candidate_id, reqId])).rows[0];
      await appendLedger(c, { candidateId: ar.candidate_id, officeId: ar.accounting_office_id, resourceType: 'support', resourceId: s.id, eventType: 'SUPORTE_ACESSO_APROVADO', actorUserId: user.sub, actorRole: user.role });
      return { sessionId: s.id, status: 'APROVADA' };
    });
  });
  // Dados só com sessão ATIVA e válida; sem aprovação -> 403.
  app.get('/api/suporte/acesso/:reqId/dados', async (req, reply) => {
    if (!requireRole(req, reply, ['SUPORTE_INTERNO'])) return;
    const reqId = (req.params as any).reqId; const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const s = (await c.query("SELECT id, candidate_id FROM support_access_session WHERE request_id=$1 AND status='ATIVA' AND expires_at > now()", [reqId])).rows[0];
      if (!s) return reply.code(403).send({ erro: 'sem sessão de suporte aprovada/ativa' });
      await c.query(`INSERT INTO support_action_log (accounting_office_id, session_id, action) VALUES ($1,$2,'LEITURA_DADOS')`, [user.officeId, s.id]);
      const ws = (await c.query('SELECT name_plain FROM worker w JOIN worker_assignment wa ON wa.worker_id=w.id WHERE wa.candidate_id=$1 LIMIT 20', [s.candidate_id])).rows;
      return { candidato: s.candidate_id, dados_mascarados: ws.map((w: any) => mask(w.name_plain ?? '', 3)) };
    });
  });

  // ================= Incidente =================
  app.post('/api/incidentes', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'SUPORTE_INTERNO', 'ADMINISTRADOR_CAMPANHA'])) return;
    const b = (req.body as any) ?? {}; const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const inc = (await c.query(`INSERT INTO security_incident (accounting_office_id, severity, summary) VALUES ($1,$2,$3) RETURNING id`, [user.officeId, b.severidade ?? 'MEDIA', b.resumo ?? ''])).rows[0];
      await c.query(`INSERT INTO incident_timeline_event (accounting_office_id, incident_id, description) VALUES ($1,$2,'Incidente aberto')`, [user.officeId, inc.id]);
      return { incidentId: inc.id, status: 'ABERTO' };
    });
  });
  app.post('/api/incidentes/:id/evento', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'SUPORTE_INTERNO', 'ADMINISTRADOR_CAMPANHA'])) return;
    const id = (req.params as any).id; const b = (req.body as any) ?? {}; const user = req.user;
    return withScope(userToScope(user), async (c) => {
      await c.query(`INSERT INTO incident_timeline_event (accounting_office_id, incident_id, description) VALUES ($1,$2,$3)`, [user.officeId, id, b.descricao ?? '']);
      return { ok: true };
    });
  });
  app.get('/api/incidentes/:id', async (req) => {
    const id = (req.params as any).id;
    return withScope(userToScope(req.user), async (c) => ({
      incidente: (await c.query('SELECT id, severity, status, summary, created_at FROM security_incident WHERE id=$1', [id])).rows[0],
      timeline: (await c.query('SELECT description, created_at FROM incident_timeline_event WHERE incident_id=$1 ORDER BY created_at', [id])).rows,
    }));
  });

  // ================= Auditoria externa (pacote com manifesto e hash) =================
  app.post('/api/auditoria-externa/:candidateId/pacote', async (req, reply) => {
    if (!requireRole(req, reply, ['AUDITOR', 'CONTADOR', 'JURIDICO'])) return;
    const candidateId = (req.params as any).candidateId; const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const ledger = (await c.query('SELECT count(*)::int n, max(entry_hash) AS ultimo FROM audit_ledger_entry WHERE candidate_id=$1', [candidateId])).rows[0];
      const docs = (await c.query("SELECT count(*)::int n FROM document_instance WHERE candidate_id=$1 AND status='FINALIZADO'", [candidateId])).rows[0].n;
      const cand = (await c.query('SELECT name FROM candidate WHERE id=$1', [candidateId])).rows[0];
      if (!cand) return reply.code(404).send({ erro: 'candidato fora do escopo' });
      const manifest = { candidato: cand.name, candidate_id: candidateId, entradas_ledger: ledger.n, ultimo_hash_ledger: ledger.ultimo, documentos_finalizados: docs, gerado_em: new Date().toISOString() };
      const manifestHash = sha256(JSON.stringify(manifest));
      const pkg = (await c.query(`INSERT INTO external_audit_package (accounting_office_id, candidate_id, manifest_json, manifest_hash) VALUES ($1,$2,$3,$4) RETURNING id`, [user.officeId, candidateId, JSON.stringify(manifest), manifestHash])).rows[0];
      await appendLedger(c, { candidateId, officeId: user.officeId, resourceType: 'external_audit', resourceId: pkg.id, eventType: 'AUDITORIA_EXTERNA_PACOTE', actorUserId: user.sub, actorRole: user.role, payload: { manifestHash } });
      return { pacoteId: pkg.id, manifestHash, manifest };
    });
  });
  app.get('/api/auditoria-externa/:id', async (req) => {
    const id = (req.params as any).id;
    return withScope(userToScope(req.user), async (c) =>
      (await c.query('SELECT manifest_json, manifest_hash FROM external_audit_package WHERE id=$1', [id])).rows[0] ?? { erro: 'não encontrado' });
  });
}
