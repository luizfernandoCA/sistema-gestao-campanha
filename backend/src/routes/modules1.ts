import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withScope } from '../core/db.js';
import { authenticate, requireRole, userToScope } from '../core/auth.js';
import { appendLedger } from '../core/audit.js';
import { sha256, hmac, encField, decFieldSafe } from '../core/crypto.js';
import { withIdempotency, mask } from '../core/util.js';
import { renderContractPdf, stripHtml } from '../core/pdf.js';
import { putEncrypted } from '../core/storage.js';

// Importação em massa (35), reemissão (34) e notificações (18).
export async function modules1(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  // ---------- Importação em massa: prévia ----------
  const previaSchema = z.object({
    candidateId: z.string().uuid(),
    linhas: z.array(z.object({ cpf: z.string().min(11), nome: z.string().min(1), telefone: z.string().optional() })).min(1).max(2000),
  });
  app.post('/api/importacao/previa', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL', 'ADMINISTRADOR_CAMPANHA'])) return;
    const p = previaSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ erro: 'payload inválido' });
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const cand = (await c.query('SELECT id, campaign_id FROM candidate WHERE id=$1', [p.data.candidateId])).rows[0];
      if (!cand) return reply.code(404).send({ erro: 'candidato fora do escopo' });
      const batch = (await c.query(
        `INSERT INTO bulk_import_batch (accounting_office_id, candidate_id, status, total, created_by)
         VALUES ($1,$2,'PREVIA',$3,$4) RETURNING id`,
        [user.officeId, cand.id, p.data.linhas.length, user.sub])).rows[0];
      let novos = 0, dups = 0;
      for (const l of p.data.linhas) {
        const ch = hmac(l.cpf.replace(/\D/g, ''));
        const existe = (await c.query('SELECT 1 FROM worker WHERE accounting_office_id=$1 AND cpf_hmac=$2', [user.officeId, ch])).rowCount;
        const st = existe ? 'DUPLICADO' : 'NOVO';
        if (existe) dups++; else novos++;
        // O nome é gravado CIFRADO na staging (a coluna name_plain passa a guardar
        // o envelope, não o texto puro) — sem nome em claro nem na importação.
        await c.query(
          `INSERT INTO bulk_import_row (batch_id, accounting_office_id, candidate_id, cpf_hmac, name_plain, status)
           VALUES ($1,$2,$3,$4,$5,$6)`, [batch.id, user.officeId, cand.id, ch, encField(l.nome), st]);
      }
      await c.query('UPDATE bulk_import_batch SET inserted=$1, duplicates=$2 WHERE id=$3', [novos, dups, batch.id]);
      await appendLedger(c, { candidateId: cand.id, officeId: user.officeId, resourceType: 'import', resourceId: batch.id, eventType: 'IMPORT_PREVIA', actorUserId: user.sub, actorRole: user.role, payload: { total: p.data.linhas.length, novos, dups } });
      return { batchId: batch.id, total: p.data.linhas.length, novos, duplicados: dups, status: 'PREVIA' };
    });
  });

  // ---------- Importação em massa: confirmar (idempotente) ----------
  app.post('/api/importacao/:batchId/confirmar', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL', 'ADMINISTRADOR_CAMPANHA'])) return;
    const batchId = (req.params as any).batchId;
    const idemKey = (req.headers['idempotency-key'] as string) ?? `import-${batchId}`;
    const user = req.user;
    return withIdempotency(idemKey, user.sub, () => withScope(userToScope(user), async (c) => {
      const batch = (await c.query('SELECT b.id, b.candidate_id, cc.campaign_id, b.status FROM bulk_import_batch b JOIN candidate cc ON cc.id=b.candidate_id WHERE b.id=$1', [batchId])).rows[0];
      if (!batch) return { erro: 'lote fora do escopo' };
      if (batch.status === 'COMITADO') return { jaComitado: true };
      const rows = (await c.query("SELECT id, cpf_hmac, name_plain FROM bulk_import_row WHERE batch_id=$1 AND status='NOVO'", [batchId])).rows;
      let criados = 0;
      for (const r of rows) {
        // r.name_plain já vem CIFRADO da staging -> vai direto p/ name_enc; name_plain fica NULL.
        const w = (await c.query(
          `INSERT INTO worker (accounting_office_id, cpf_hmac, name_enc) VALUES ($1,$2,$3)
           ON CONFLICT (accounting_office_id, cpf_hmac) DO NOTHING RETURNING id`,
          [user.officeId, r.cpf_hmac, r.name_plain])).rows[0];
        if (w) {
          await c.query(
            `INSERT INTO worker_assignment (accounting_office_id, campaign_id, candidate_id, coordinator_local_id, worker_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$4)`, [user.officeId, batch.campaign_id, batch.candidate_id, user.sub, w.id]);
          criados++;
          await c.query("UPDATE bulk_import_row SET status='CRIADO' WHERE id=$1", [r.id]);
        }
      }
      await c.query("UPDATE bulk_import_batch SET status='COMITADO' WHERE id=$1", [batchId]);
      await appendLedger(c, { candidateId: batch.candidate_id, officeId: user.officeId, resourceType: 'import', resourceId: batchId, eventType: 'IMPORT_COMITADO', actorUserId: user.sub, actorRole: user.role, payload: { criados } });
      return { batchId, criados, status: 'COMITADO' };
    }));
  });

  // ---------- Reemissão ----------
  app.post('/api/documentos/:id/reemitir', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL', 'ADMINISTRADOR_CAMPANHA'])) return;
    const id = (req.params as any).id;
    const motivo = (req.body as any)?.motivo ?? 'correção';
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const o = (await c.query(
        `SELECT d.*, w.name_enc, cc.name AS cand_name, v.content_html
           FROM document_instance d JOIN worker w ON w.id=d.worker_id
           JOIN candidate cc ON cc.id=d.candidate_id
           JOIN contract_template_version v ON v.id=d.contract_template_version_id
          WHERE d.id=$1`, [id])).rows[0];
      if (!o) return reply.code(404).send({ erro: 'documento fora do escopo' });
      const groupId = o.reissue_group_id ?? o.id;
      const novo = (await c.query(
        `INSERT INTO document_instance (accounting_office_id, campaign_id, candidate_id, municipality_id, coordinator_local_id,
           worker_id, contract_template_version_id, status, previous_document_id, reissue_group_id, version, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'CONTRATO_GERADO',$8,$9,$10,$11) RETURNING id`,
        [o.accounting_office_id, o.campaign_id, o.candidate_id, o.municipality_id, user.sub, o.worker_id,
         o.contract_template_version_id, o.id, groupId, (o.version ?? 1) + 1, user.sub])).rows[0];
      const pdf = await renderContractPdf({ title: 'Contrato de Prestação de Serviços de Campanha (Reemissão)', candidate: o.cand_name, worker: decFieldSafe(o.name_enc), bodyText: stripHtml(o.content_html) });
      const key = `office/${o.accounting_office_id}/cand/${o.candidate_id}/doc/${novo.id}/contrato.pdf`;
      const sf = await putEncrypted(key, pdf);
      const file = (await c.query(
        `INSERT INTO document_file (document_id, candidate_id, file_type, storage_bucket, storage_key, mime_type, size_bytes, sha256_hash, encryption_key_id, encrypted_data_key)
         VALUES ($1,$2,'PDF_CONTRATO',$3,$4,'application/pdf',$5,$6,$7,$8) RETURNING id`,
        [novo.id, o.candidate_id, sf.bucket, sf.key, sf.size, sf.sha256, sf.keyId, sf.encryptedDataKey])).rows[0];
      await c.query('UPDATE document_instance SET current_file_id=$1 WHERE id=$2', [file.id, novo.id]);
      await c.query(
        `INSERT INTO document_reissue (accounting_office_id, candidate_id, original_document_id, new_document_id, reissue_group_id, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`, [o.accounting_office_id, o.candidate_id, o.id, novo.id, groupId, motivo, user.sub]);
      await appendLedger(c, { candidateId: o.candidate_id, officeId: o.accounting_office_id, resourceType: 'document', resourceId: novo.id, eventType: 'REEMITIDO', actorUserId: user.sub, actorRole: user.role, payload: { original: o.id, motivo } });
      return { novoDocumentoId: novo.id, reissueGroupId: groupId, status: 'CONTRATO_GERADO' };
    });
  });

  // ---------- Notificações (idempotentes) ----------
  app.post('/api/notificacoes/enviar', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL', 'ADMINISTRADOR_CAMPANHA', 'CONTADOR'])) return;
    const b = (req.body as any) ?? {};
    if (!b.candidateId || !b.canal) return reply.code(400).send({ erro: 'candidateId e canal obrigatórios' });
    const user = req.user;
    const idemKey = b.idempotencyKey ?? `notif-${b.candidateId}-${b.canal}-${b.destino ?? ''}-${b.templateKey ?? ''}`;
    return withIdempotency(idemKey, user.sub, () => withScope(userToScope(user), async (c) => {
      const n = (await c.query(
        `INSERT INTO notification (accounting_office_id, candidate_id, channel, destination_masked, template_key, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
        [user.officeId, b.candidateId, b.canal, mask(String(b.destino ?? '')), b.templateKey ?? 'GENERICA', idemKey])).rows[0];
      await appendLedger(c, { candidateId: b.candidateId, officeId: user.officeId, resourceType: 'notification', resourceId: n?.id ?? idemKey, eventType: 'NOTIFICACAO_ENVIADA', actorUserId: user.sub, actorRole: user.role, payload: { canal: b.canal } });
      return { status: 'ENVIADA', id: n?.id ?? null, canal: b.canal, mock: true };
    }));
  });

  app.get('/api/notificacoes', async (req) => withScope(userToScope(req.user), async (c) =>
    (await c.query('SELECT id, channel, destination_masked, template_key, status, created_at FROM notification ORDER BY created_at DESC LIMIT 100')).rows));
}
