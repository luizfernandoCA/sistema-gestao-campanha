import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import archiver from 'archiver';
import { withScope } from '../core/db.js';
import { authenticate, requireRole, userToScope } from '../core/auth.js';
import { appendLedger, verifyChain } from '../core/audit.js';
import { transition, WorkflowConflict } from '../core/workflow.js';
import { putEncrypted, getDecrypted } from '../core/storage.js';
import { renderContractPdf, stripHtml } from '../core/pdf.js';
import { sha256, hmac, randomToken, encField } from '../core/crypto.js';

export async function appRoutes(app: FastifyInstance): Promise<void> {
  // Todas as rotas deste plugin exigem autenticação.
  app.addHook('onRequest', authenticate);

  // ---------------- Consultas em escopo (RLS) ----------------
  app.get('/api/candidatos', async (req) =>
    withScope(userToScope(req.user), async (c) =>
      (await c.query('SELECT id, name, candidate_number, party, status FROM candidate ORDER BY name')).rows));

  app.get('/api/dashboard', async (req) =>
    withScope(userToScope(req.user), async (c) => {
      // Agregado em UMA query (sem N+1).
      const porStatus = (await c.query(
        `SELECT candidate_id, status, count(*)::int AS total
           FROM document_instance GROUP BY candidate_id, status`)).rows;
      const cands = (await c.query('SELECT id, name FROM candidate')).rows;
      return { candidatos: cands, documentos_por_status: porStatus };
    }));

  app.get('/api/documentos', async (req) =>
    withScope(userToScope(req.user), async (c) =>
      (await c.query(
        `SELECT d.id, d.status, d.candidate_id, c.name AS candidato, w.name_plain AS formiguinha,
                d.created_at
           FROM document_instance d
           JOIN candidate c ON c.id = d.candidate_id
           JOIN worker w ON w.id = d.worker_id
          ORDER BY d.created_at DESC LIMIT 200`)).rows));

  app.get('/api/documentos/:id/timeline', async (req) => {
    const id = (req.params as any).id;
    return withScope(userToScope(req.user), async (c) =>
      (await c.query(
        `SELECT event_type, actor_role, created_at FROM document_event
          WHERE document_id = $1 ORDER BY created_at ASC`, [id])).rows);
  });

  // Verificação do ledger (cadeia de custódia) por candidato
  app.get('/api/auditoria/:candidateId/verificar', async (req) => {
    const candidateId = (req.params as any).candidateId;
    return withScope(userToScope(req.user), async (c) => verifyChain(c, candidateId));
  });

  app.get('/api/templates', async (req) =>
    withScope(userToScope(req.user), async (c) =>
      (await c.query(
        `SELECT v.id, t.name, v.version_number, v.status
           FROM contract_template_version v
           JOIN contract_template t ON t.id = v.template_id
          WHERE v.status = 'PUBLICADO' ORDER BY t.name, v.version_number`)).rows));

  app.get('/api/atribuicoes', async (req) =>
    withScope(userToScope(req.user), async (c) =>
      (await c.query(
        `SELECT wa.id, wa.candidate_id, c.name AS candidato, w.name_plain AS formiguinha
           FROM worker_assignment wa
           JOIN candidate c ON c.id = wa.candidate_id
           JOIN worker w ON w.id = wa.worker_id
          WHERE wa.status = 'ATIVO' ORDER BY c.name LIMIT 500`)).rows));

  // ---------------- Geração de documento ----------------
  const gerarSchema = z.object({ workerAssignmentId: z.string().uuid(), templateVersionId: z.string().uuid() });
  app.post('/api/documentos/gerar', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL', 'ADMINISTRADOR_CAMPANHA'])) return;
    const p = gerarSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ erro: 'payload inválido' });
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const wa = (await c.query(
        `SELECT wa.*, w.name_plain, c.name AS cand_name
           FROM worker_assignment wa JOIN worker w ON w.id = wa.worker_id
           JOIN candidate c ON c.id = wa.candidate_id WHERE wa.id = $1`, [p.data.workerAssignmentId])).rows[0];
      if (!wa) return reply.code(404).send({ erro: 'atribuição não encontrada no seu escopo' });
      const tv = (await c.query(
        `SELECT v.*, t.accounting_office_id FROM contract_template_version v
           JOIN contract_template t ON t.id = v.template_id WHERE v.id = $1`, [p.data.templateVersionId])).rows[0];
      if (!tv) return reply.code(404).send({ erro: 'template não encontrado' });

      const snapshot = { formiguinha: wa.name_plain, candidato: wa.cand_name, template_versao: tv.version_number };
      const snapshotHash = sha256(JSON.stringify(snapshot));

      const doc = (await c.query(
        `INSERT INTO document_instance
           (accounting_office_id, campaign_id, candidate_id, municipality_id, coordinator_local_id,
            worker_id, contract_template_version_id, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'CONTRATO_GERADO',$8) RETURNING id`,
        [wa.accounting_office_id, wa.campaign_id, wa.candidate_id, wa.municipality_id,
         user.sub, wa.worker_id, tv.id, user.sub])).rows[0];

      await c.query(
        `INSERT INTO document_data_snapshot (document_id, candidate_id, snapshot_json, snapshot_hash)
         VALUES ($1,$2,$3,$4)`, [doc.id, wa.candidate_id, JSON.stringify(snapshot), snapshotHash]);

      const pdf = await renderContractPdf({
        title: 'Contrato de Prestação de Serviços de Campanha',
        candidate: wa.cand_name, worker: wa.name_plain, bodyText: stripHtml(tv.content_html),
      });
      const key = `office/${wa.accounting_office_id}/cand/${wa.candidate_id}/doc/${doc.id}/contrato.pdf`;
      const sf = await putEncrypted(key, pdf);
      const file = (await c.query(
        `INSERT INTO document_file
           (document_id, candidate_id, file_type, storage_bucket, storage_key, mime_type,
            size_bytes, sha256_hash, encryption_key_id, encrypted_data_key)
         VALUES ($1,$2,'PDF_CONTRATO',$3,$4,'application/pdf',$5,$6,$7,$8) RETURNING id`,
        [doc.id, wa.candidate_id, sf.bucket, sf.key, sf.size, sf.sha256, sf.keyId, sf.encryptedDataKey])).rows[0];
      await c.query('UPDATE document_instance SET current_file_id = $1 WHERE id = $2', [file.id, doc.id]);

      await c.query(
        `INSERT INTO document_status_history (document_id, candidate_id, to_status, actor_user_id, actor_role)
         VALUES ($1,$2,'CONTRATO_GERADO',$3,$4)`, [doc.id, wa.candidate_id, user.sub, user.role]);
      await appendLedger(c, {
        candidateId: wa.candidate_id, officeId: wa.accounting_office_id, resourceType: 'document',
        resourceId: doc.id, eventType: 'DOCUMENTO_GERADO', actorUserId: user.sub, actorRole: user.role,
        payload: { snapshotHash, sha256: sf.sha256 },
      });
      return { id: doc.id, status: 'CONTRATO_GERADO', sha256: sf.sha256 };
    });
  });

  // ---------------- Assinatura assistida ----------------
  app.post('/api/assinatura/assistida/iniciar', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL'])) return;
    const { documentId } = (req.body as any) ?? {};
    if (!documentId) return reply.code(400).send({ erro: 'documentId obrigatório' });
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const doc = (await c.query('SELECT id, candidate_id, accounting_office_id, worker_id, status FROM document_instance WHERE id = $1', [documentId])).rows[0];
      if (!doc) return reply.code(404).send({ erro: 'documento fora do escopo' });
      try {
        await transition(c, { id: doc.id, candidateId: doc.candidate_id, officeId: doc.accounting_office_id },
          ['CONTRATO_GERADO', 'ENVIADO_PARA_ASSINATURA'], 'EM_ASSINATURA_ASSISTIDA', user,
          'ASSISTIDA_INICIADA');
      } catch (e) {
        if (e instanceof WorkflowConflict) return reply.code(409).send({ erro: e.message });
        throw e;
      }
      const sess = (await c.query(
        `INSERT INTO signature_session (document_id, candidate_id, worker_id, session_type, started_by_user_id, ip_hash)
         VALUES ($1,$2,$3,'ASSISTIDA',$4,$5) RETURNING id`,
        [doc.id, doc.candidate_id, doc.worker_id, user.sub, hmac(req.ip)])).rows[0];
      return { sessionId: sess.id, status: 'EM_ASSINATURA_ASSISTIDA' };
    });
  });

  const assinarSchema = z.object({
    documentId: z.string().uuid(),
    confirmacoes: z.object({ identidade: z.boolean(), leitura: z.boolean(), livre_vontade: z.boolean() }),
    assinaturaBase64: z.string().min(10),
  });
  app.post('/api/assinatura/assistida/assinar', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL'])) return;
    const p = assinarSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ erro: 'payload inválido' });
    const { confirmacoes } = p.data;
    if (!confirmacoes.identidade || !confirmacoes.leitura || !confirmacoes.livre_vontade)
      return reply.code(422).send({ erro: 'aceites obrigatórios não confirmados' });
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const doc = (await c.query(
        `SELECT d.id, d.candidate_id, d.accounting_office_id, d.worker_id, d.current_file_id,
                f.sha256_hash, f.storage_key, c.name AS cand, w.name_plain AS worker, v.content_html
           FROM document_instance d
           JOIN document_file f ON f.id = d.current_file_id
           JOIN candidate c ON c.id = d.candidate_id
           JOIN worker w ON w.id = d.worker_id
           JOIN contract_template_version v ON v.id = d.contract_template_version_id
          WHERE d.id = $1`, [p.data.documentId])).rows[0];
      if (!doc) return reply.code(404).send({ erro: 'documento fora do escopo' });
      const hashBefore: string = doc.sha256_hash;

      // Sela um novo PDF com a assinatura e evidências.
      const signedAt = new Date().toISOString();
      const sealedPdf = await renderContractPdf({
        title: 'Contrato de Prestação de Serviços de Campanha', candidate: doc.cand, worker: doc.worker,
        bodyText: stripHtml(doc.content_html),
        signatures: [{ who: `Formiguinha (${doc.worker})`, at: signedAt, hash: hashBefore }],
      });
      const key = `office/${doc.accounting_office_id}/cand/${doc.candidate_id}/doc/${doc.id}/contrato-assinado.pdf`;
      const sf = await putEncrypted(key, sealedPdf);
      const hashAfter = sf.sha256;
      const newFile = (await c.query(
        `INSERT INTO document_file
           (document_id, candidate_id, file_type, file_role, storage_bucket, storage_key, mime_type,
            size_bytes, sha256_hash, encryption_key_id, encrypted_data_key)
         VALUES ($1,$2,'PDF_CONTRATO','ASSINADO_FORMIGUINHA',$3,$4,'application/pdf',$5,$6,$7,$8) RETURNING id`,
        [doc.id, doc.candidate_id, sf.bucket, sf.key, sf.size, hashAfter, sf.keyId, sf.encryptedDataKey])).rows[0];

      const acceptanceHash = sha256(JSON.stringify({ ...confirmacoes, op: user.sub, ts: signedAt }));
      const sig = (await c.query(
        `INSERT INTO signature
           (document_id, candidate_id, signer_type, signer_id, signature_type, signature_image_file_id,
            document_hash_before, document_hash_after)
         VALUES ($1,$2,'FORMIGUINHA',$3,'ELETRONICA_EVIDENCIADA',$4,$5,$6) RETURNING id`,
        [doc.id, doc.candidate_id, doc.worker_id, newFile.id, hashBefore, hashAfter])).rows[0];
      await c.query(
        `INSERT INTO signature_evidence
           (signature_id, document_id, candidate_id, signer_type, operator_user_id, ip_hash, user_agent,
            acceptance_hash, document_hash_before, document_hash_after)
         VALUES ($1,$2,$3,'FORMIGUINHA',$4,$5,$6,$7,$8,$9)`,
        [sig.id, doc.id, doc.candidate_id, user.sub, hmac(req.ip),
         String(req.headers['user-agent'] ?? ''), acceptanceHash, hashBefore, hashAfter]);

      await c.query('UPDATE document_instance SET current_file_id = $1 WHERE id = $2', [newFile.id, doc.id]);
      await c.query("UPDATE signature_session SET status='CONCLUIDA', completed_at=now() WHERE document_id=$1 AND status='ABERTA'", [doc.id]);
      try {
        await transition(c, { id: doc.id, candidateId: doc.candidate_id, officeId: doc.accounting_office_id },
          ['EM_ASSINATURA_ASSISTIDA'], 'AGUARDANDO_ADMINISTRADOR', user, 'ASSINADA_FORMIGUINHA',
          { hashBefore, hashAfter });
      } catch (e) {
        if (e instanceof WorkflowConflict) return reply.code(409).send({ erro: e.message });
        throw e;
      }
      return { status: 'AGUARDANDO_ADMINISTRADOR', hashBefore, hashAfter, evidencia: acceptanceHash };
    });
  });

  // ---------------- Assinatura remota (link + token) ----------------
  app.post('/api/assinatura/remota/criar', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL'])) return;
    const { documentId } = (req.body as any) ?? {};
    if (!documentId) return reply.code(400).send({ erro: 'documentId obrigatório' });
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const doc = (await c.query('SELECT id, candidate_id, accounting_office_id, worker_id, status FROM document_instance WHERE id=$1', [documentId])).rows[0];
      if (!doc) return reply.code(404).send({ erro: 'documento fora do escopo' });
      const token = randomToken();
      const expires = new Date(Date.now() + 72 * 3600 * 1000);
      await c.query(
        `INSERT INTO signature_request (document_id, candidate_id, worker_id, request_type, delivery_channel, token_hash, expires_at)
         VALUES ($1,$2,$3,'REMOTA','MOCK',$4,$5)`,
        [doc.id, doc.candidate_id, doc.worker_id, sha256(token), expires]);
      try {
        await transition(c, { id: doc.id, candidateId: doc.candidate_id, officeId: doc.accounting_office_id },
          ['CONTRATO_GERADO', 'ENVIADO_PARA_ASSINATURA'], 'ENVIADO_PARA_ASSINATURA', user, 'REMOTA_ENVIADA');
      } catch { /* já enviado, segue */ }
      // O token bruto é retornado UMA vez (em produção iria por canal seguro).
      return { link: `/assinar/${token}`, expira_em: expires.toISOString() };
    });
  });

  // ---------------- Assinatura do administrador ----------------
  app.post('/api/documentos/:id/assinar-admin', async (req, reply) => {
    if (!requireRole(req, reply, ['ADMINISTRADOR_CAMPANHA'])) return;
    const id = (req.params as any).id;
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const doc = (await c.query(
        `SELECT d.id, d.candidate_id, d.accounting_office_id, f.sha256_hash
           FROM document_instance d JOIN document_file f ON f.id = d.current_file_id
          WHERE d.id = $1`, [id])).rows[0];
      if (!doc) return reply.code(404).send({ erro: 'documento fora do escopo' });
      const hashBefore = doc.sha256_hash;
      const sig = (await c.query(
        `INSERT INTO signature (document_id, candidate_id, signer_type, signer_id, signature_type, document_hash_before, document_hash_after)
         VALUES ($1,$2,'ADMINISTRADOR',$3,'ELETRONICA_EVIDENCIADA',$4,$4) RETURNING id`,
        [doc.id, doc.candidate_id, user.sub, hashBefore])).rows[0];
      await c.query(
        `INSERT INTO signature_evidence (signature_id, document_id, candidate_id, signer_type, operator_user_id, ip_hash, acceptance_hash, document_hash_before, document_hash_after)
         VALUES ($1,$2,$3,'ADMINISTRADOR',$4,$5,$6,$7,$7)`,
        [sig.id, doc.id, doc.candidate_id, user.sub, hmac(req.ip), sha256('admin-aceite-' + sig.id), hashBefore]);
      try {
        await transition(c, { id: doc.id, candidateId: doc.candidate_id, officeId: doc.accounting_office_id },
          ['AGUARDANDO_ADMINISTRADOR', 'ASSINADO_PELA_FORMIGUINHA'], 'FINALIZADO', user, 'FINALIZADO');
      } catch (e) {
        if (e instanceof WorkflowConflict) return reply.code(409).send({ erro: e.message });
        throw e;
      }
      return { status: 'FINALIZADO' };
    });
  });

  // ---------------- Contestação (congela exportação) ----------------
  app.post('/api/documentos/:id/contestar', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'ADMINISTRADOR_CAMPANHA', 'COORDENADOR_LOCAL', 'COORDENADOR_GERAL'])) return;
    const id = (req.params as any).id;
    const { motivo } = (req.body as any) ?? {};
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const doc = (await c.query('SELECT id, candidate_id, accounting_office_id FROM document_instance WHERE id=$1', [id])).rows[0];
      if (!doc) return reply.code(404).send({ erro: 'documento fora do escopo' });
      await c.query('INSERT INTO contestation (document_id, candidate_id, reason) VALUES ($1,$2,$3)',
        [doc.id, doc.candidate_id, motivo ?? 'sem motivo']);
      await appendLedger(c, { candidateId: doc.candidate_id, officeId: doc.accounting_office_id,
        resourceType: 'document', resourceId: doc.id, eventType: 'CONTESTACAO_ABERTA',
        actorUserId: user.sub, actorRole: user.role, payload: { motivo } });
      return { status: 'CONTESTADO' };
    });
  });

  // ---------------- Exportação contábil (dossiê + manifesto) ----------------
  app.post('/api/exportacao/candidato/:candidateId', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'AUDITOR'])) return;
    const candidateId = (req.params as any).candidateId;
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      // RLS garante: só candidatos no escopo. Documentos contestados não entram.
      const docs = (await c.query(
        `SELECT d.id, f.sha256_hash, f.storage_key
           FROM document_instance d
           JOIN document_file f ON f.id = d.current_file_id
          WHERE d.candidate_id = $1 AND d.status = 'FINALIZADO'
            AND NOT EXISTS (SELECT 1 FROM contestation ct WHERE ct.document_id = d.id AND ct.status='ABERTA')`,
        [candidateId])).rows;
      if (docs.length === 0) return reply.code(404).send({ erro: 'nenhum documento finalizado e regular para este candidato no seu escopo' });
      const cand = (await c.query('SELECT name FROM candidate WHERE id=$1', [candidateId])).rows[0];
      const manifest = {
        candidato: cand?.name, candidate_id: candidateId, gerado_em: new Date().toISOString(),
        total: docs.length,
        documentos: docs.map((d: any) => ({ document_id: d.id, sha256: d.sha256_hash, arquivo: d.storage_key })),
      };
      const manifestHash = sha256(JSON.stringify(manifest));
      const batch = (await c.query(
        `INSERT INTO export_batch (candidate_id, accounting_office_id, manifest_json, manifest_hash, document_count, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [candidateId, user.officeId, JSON.stringify(manifest), manifestHash, docs.length, user.sub])).rows[0];
      await appendLedger(c, { candidateId, officeId: user.officeId, resourceType: 'export',
        resourceId: batch.id, eventType: 'DOSSIE_EXPORTADO', actorUserId: user.sub, actorRole: user.role,
        payload: { manifestHash, total: docs.length } });
      return { exportId: batch.id, manifestHash, total: docs.length };
    });
  });

  app.get('/api/exportacao/:id/manifesto', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'AUDITOR'])) return;
    const id = (req.params as any).id;
    return withScope(userToScope(req.user), async (c) =>
      (await c.query('SELECT manifest_json, manifest_hash, document_count FROM export_batch WHERE id=$1', [id])).rows[0] ?? { erro: 'não encontrado' });
  });

  // Download do dossiê em ZIP (manifesto + PDFs decifrados)
  app.get('/api/exportacao/:id/download', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'AUDITOR'])) return;
    const id = (req.params as any).id;
    return withScope(userToScope(req.user), async (c) => {
      const batch = (await c.query('SELECT candidate_id, manifest_json FROM export_batch WHERE id=$1', [id])).rows[0];
      if (!batch) return reply.code(404).send({ erro: 'não encontrado' });
      // Exclui documentos contestados também no download (não só na geração).
      const files = (await c.query(
        `SELECT f.storage_key, f.encrypted_data_key, f.document_id
           FROM document_instance d JOIN document_file f ON f.id = d.current_file_id
          WHERE d.candidate_id = $1 AND d.status='FINALIZADO'
            AND NOT EXISTS (SELECT 1 FROM contestation ct WHERE ct.document_id = d.id AND ct.status='ABERTA')`,
        [batch.candidate_id])).rows;
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="dossie-${id}.zip"`);
      const zip = archiver('zip', { zlib: { level: 9 } });
      zip.append(JSON.stringify(batch.manifest_json, null, 2), { name: 'manifesto.json' });
      for (const f of files) {
        const buf = await getDecrypted(f.storage_key, f.encrypted_data_key);
        zip.append(buf, { name: `documentos/${f.document_id}.pdf` });
      }
      zip.finalize();
      return reply.send(zip);
    });
  });
}
