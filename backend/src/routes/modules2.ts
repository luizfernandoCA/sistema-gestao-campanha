import type { FastifyInstance } from 'fastify';
import { withScope } from '../core/db.js';
import { authenticate, requireRole, userToScope } from '../core/auth.js';
import { appendLedger } from '../core/audit.js';
import { sha256, randomToken, envelopeEncrypt } from '../core/crypto.js';
import { withIdempotency } from '../core/util.js';
import { aiExtract } from '../connectors/ai-anthropic.js';
import { connectorStatus } from '../connectors/index.js';

// Exceção em papel (10), offline-first (19), antifraude (20), IA/OCR (21).
export async function modules2(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  // ---------- Status dos connectors (auditável; revela só provedor + modo) ----------
  app.get('/api/connectors/status', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'AUDITOR', 'ADMINISTRADOR_CAMPANHA', 'SUPORTE_INTERNO'])) return;
    return connectorStatus();
  });

  // ---------- Exceção em papel: solicitar (gera QR único) ----------
  app.post('/api/papel/solicitar', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL', 'ADMINISTRADOR_CAMPANHA'])) return;
    const { documentId, justificativa } = (req.body as any) ?? {};
    if (!documentId) return reply.code(400).send({ erro: 'documentId obrigatório' });
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const doc = (await c.query('SELECT id, candidate_id, accounting_office_id FROM document_instance WHERE id=$1', [documentId])).rows[0];
      if (!doc) return reply.code(404).send({ erro: 'documento fora do escopo' });
      const qr = randomToken(18);
      const cs = (await c.query(
        `INSERT INTO paper_exception_case (accounting_office_id, candidate_id, document_id, justification, qr_token_hash)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [doc.accounting_office_id, doc.candidate_id, doc.id, justificativa ?? '', sha256(qr)])).rows[0];
      await appendLedger(c, { candidateId: doc.candidate_id, officeId: doc.accounting_office_id, resourceType: 'paper', resourceId: cs.id, eventType: 'PAPEL_SOLICITADO', actorUserId: user.sub, actorRole: user.role });
      return { caseId: cs.id, qrToken: qr, status: 'SOLICITADO' };
    });
  });

  // ---------- Exceção em papel: escanear (valida QR, OCR mock, sinal antifraude) ----------
  app.post('/api/papel/:caseId/escanear', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL', 'ADMINISTRADOR_CAMPANHA'])) return;
    const caseId = (req.params as any).caseId;
    const { qrToken, textoOcr } = (req.body as any) ?? {};
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const cs = (await c.query('SELECT id, candidate_id, accounting_office_id, qr_token_hash FROM paper_exception_case WHERE id=$1', [caseId])).rows[0];
      if (!cs) return reply.code(404).send({ erro: 'caso fora do escopo' });
      if (!qrToken || sha256(qrToken) !== cs.qr_token_hash) return reply.code(422).send({ erro: 'QR inválido para este documento' });
      const scan = (await c.query(
        `INSERT INTO paper_scan (accounting_office_id, candidate_id, paper_exception_case_id, ocr_text, ocr_confidence, status)
         VALUES ($1,$2,$3,$4,$5,'RECEBIDO') RETURNING id`,
        [cs.accounting_office_id, cs.candidate_id, cs.id, textoOcr ?? '(scan)', 0.92])).rows[0];
      await c.query("UPDATE paper_exception_case SET status='ESCANEADO' WHERE id=$1", [cs.id]);
      // Sinal antifraude: excesso de exceções em papel para o candidato.
      const n = (await c.query('SELECT count(*)::int t FROM paper_exception_case WHERE candidate_id=$1', [cs.candidate_id])).rows[0].t;
      if (n >= 3) await c.query(
        `INSERT INTO fraud_signal (accounting_office_id, candidate_id, signal_type, severity, detail)
         VALUES ($1,$2,'EXCESSO_PAPEL','MEDIA',$3)`, [cs.accounting_office_id, cs.candidate_id, `total exceções: ${n}`]);
      await appendLedger(c, { candidateId: cs.candidate_id, officeId: cs.accounting_office_id, resourceType: 'paper', resourceId: cs.id, eventType: 'PAPEL_ESCANEADO', actorUserId: user.sub, actorRole: user.role });
      return { scanId: scan.id, status: 'ESCANEADO', sinalAntifraude: n >= 3 };
    });
  });

  app.post('/api/papel/:caseId/revisar', async (req, reply) => {
    if (!requireRole(req, reply, ['JURIDICO', 'CONTADOR', 'ADMINISTRADOR_CAMPANHA'])) return;
    const caseId = (req.params as any).caseId;
    const aprovado = (req.body as any)?.aprovado === true;
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const cs = (await c.query('SELECT id, candidate_id, accounting_office_id FROM paper_exception_case WHERE id=$1', [caseId])).rows[0];
      if (!cs) return reply.code(404).send({ erro: 'caso fora do escopo' });
      const st = aprovado ? 'REVISADO_OK' : 'REJEITADO';
      await c.query('UPDATE paper_exception_case SET status=$1 WHERE id=$2', [st, cs.id]);
      await appendLedger(c, { candidateId: cs.candidate_id, officeId: cs.accounting_office_id, resourceType: 'paper', resourceId: cs.id, eventType: 'PAPEL_REVISADO', actorUserId: user.sub, actorRole: user.role, payload: { aprovado } });
      return { status: st };
    });
  });

  // ---------- Offline-first: gerar pacote cifrado ----------
  app.post('/api/offline/pacote', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL'])) return;
    const { candidateId } = (req.body as any) ?? {};
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const docs = (await c.query("SELECT id, status FROM document_instance WHERE candidate_id=$1 AND status='CONTRATO_GERADO' LIMIT 100", [candidateId])).rows;
      const payload = Buffer.from(JSON.stringify({ candidateId, docs, geradoEm: new Date().toISOString() }));
      const envEnc = envelopeEncrypt(payload);
      const stored = `${envEnc.encryptedDataKey}.${envEnc.ciphertext.toString('base64')}`;
      const pkg = (await c.query(
        `INSERT INTO offline_package (accounting_office_id, candidate_id, coordinator_local_id, payload_enc, item_count, expires_at)
         VALUES ($1,$2,$3,$4,$5, now() + interval '48 hours') RETURNING id, expires_at`,
        [user.officeId, candidateId, user.sub, stored, docs.length])).rows[0];
      await appendLedger(c, { candidateId, officeId: user.officeId, resourceType: 'offline', resourceId: pkg.id, eventType: 'OFFLINE_PACOTE', actorUserId: user.sub, actorRole: user.role, payload: { itens: docs.length } });
      return { packageId: pkg.id, itens: docs.length, expira_em: pkg.expires_at };
    });
  });

  // ---------- Offline-first: sync (rejeita expirado, idempotente) ----------
  app.post('/api/offline/sync', async (req, reply) => {
    if (!requireRole(req, reply, ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL'])) return;
    const { packageId } = (req.body as any) ?? {};
    if (!packageId) return reply.code(400).send({ erro: 'packageId obrigatório' });
    const user = req.user;
    const idem = (req.headers['idempotency-key'] as string) ?? `sync-${packageId}`;
    return withIdempotency(idem, user.sub, () => withScope(userToScope(user), async (c) => {
      const pkg = (await c.query('SELECT id, candidate_id, accounting_office_id, expires_at, status FROM offline_package WHERE id=$1', [packageId])).rows[0];
      if (!pkg) return { erro: 'pacote fora do escopo' };
      if (new Date(pkg.expires_at) < new Date()) {
        await c.query(`INSERT INTO offline_sync_event (accounting_office_id, candidate_id, package_id, status, detail) VALUES ($1,$2,$3,'EXPIRADO','pacote vencido')`, [pkg.accounting_office_id, pkg.candidate_id, pkg.id]);
        return { status: 'EXPIRADO' };
      }
      await c.query("UPDATE offline_package SET status='SINCRONIZADO' WHERE id=$1", [pkg.id]);
      await c.query(`INSERT INTO offline_sync_event (accounting_office_id, candidate_id, package_id, status) VALUES ($1,$2,$3,'OK')`, [pkg.accounting_office_id, pkg.candidate_id, pkg.id]);
      await appendLedger(c, { candidateId: pkg.candidate_id, officeId: pkg.accounting_office_id, resourceType: 'offline', resourceId: pkg.id, eventType: 'OFFLINE_SYNC', actorUserId: user.sub, actorRole: user.role });
      return { status: 'SINCRONIZADO' };
    }));
  });

  // ---------- Antifraude: avaliar risco + listar casos ----------
  app.post('/api/antifraude/avaliar', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'AUDITOR', 'ADMINISTRADOR_CAMPANHA'])) return;
    const { candidateId } = (req.body as any) ?? {};
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const sinais = (await c.query('SELECT count(*)::int t FROM fraud_signal WHERE candidate_id=$1', [candidateId])).rows[0].t;
      const semEvidencia = (await c.query(
        `SELECT count(*)::int t FROM document_instance d WHERE d.candidate_id=$1 AND d.status='FINALIZADO'
            AND NOT EXISTS (SELECT 1 FROM signature_evidence se WHERE se.document_id=d.id)`, [candidateId])).rows[0].t;
      const severidade = sinais >= 3 || semEvidencia > 0 ? 'ALTA' : sinais >= 1 ? 'MEDIA' : 'BAIXA';
      let casoId = null;
      if (severidade !== 'BAIXA') {
        casoId = (await c.query(
          `INSERT INTO fraud_case (accounting_office_id, candidate_id, severity, summary)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [user.officeId, candidateId, severidade, `sinais=${sinais}, finalizados_sem_evidencia=${semEvidencia}`])).rows[0].id;
        await appendLedger(c, { candidateId, officeId: user.officeId, resourceType: 'fraud', resourceId: casoId, eventType: 'FRAUDE_CASO_ABERTO', actorUserId: user.sub, actorRole: user.role, payload: { severidade } });
      }
      return { sinais, finalizados_sem_evidencia: semEvidencia, severidade, casoId };
    });
  });

  app.get('/api/antifraude/casos', async (req) => withScope(userToScope(req.user), async (c) => ({
    sinais: (await c.query('SELECT signal_type, severity, detail, created_at FROM fraud_signal ORDER BY created_at DESC LIMIT 100')).rows,
    casos: (await c.query('SELECT id, severity, status, summary, created_at FROM fraud_case ORDER BY created_at DESC LIMIT 100')).rows,
  })));

  // ---------- IA/OCR: processa via Anthropic (REAL se chave configurada, MOCK senão).
  // NÃO altera cadastro — apenas sinaliza divergência (arquitetura 21, regra técnica).
  app.post('/api/ocr/processar', async (req, reply) => {
    if (!requireRole(req, reply, ['CONTADOR', 'JURIDICO', 'COORDENADOR_LOCAL', 'COORDENADOR_GERAL', 'ADMINISTRADOR_CAMPANHA'])) return;
    const { documentId, candidateId, textoExtraido, tipoEsperado, camposEsperados } = (req.body as any) ?? {};
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const cand = candidateId ?? (await c.query('SELECT candidate_id FROM document_instance WHERE id=$1', [documentId])).rows[0]?.candidate_id;
      if (!cand) return reply.code(404).send({ erro: 'documento/candidato fora do escopo' });

      // Dados do banco para comparação (apenas referência — IA nunca decide).
      let nomeBanco = '';
      if (documentId) nomeBanco = (await c.query('SELECT w.name_plain FROM document_instance d JOIN worker w ON w.id=d.worker_id WHERE d.id=$1', [documentId])).rows[0]?.name_plain ?? '';

      const campos = Array.isArray(camposEsperados) && camposEsperados.length > 0
        ? camposEsperados
        : ['nome', 'cpf', 'data_assinatura', 'valor'];

      const result = await aiExtract({
        text: String(textoExtraido ?? ''),
        expectedFields: campos,
        expectedDocType: tipoEsperado ?? 'CONTRATO_FORMIGUINHA',
      });

      // Divergência de nome (heurística simples + sinal da IA).
      const nomeExtraido = (result.campos['nome'] ?? '').toLowerCase();
      const divergenteNome = !!nomeBanco
        && !nomeExtraido.includes(nomeBanco.toLowerCase().split(' ')[0]);
      const divergente = divergenteNome || result.divergencias.length > 0;

      const job = (await c.query(
        `INSERT INTO ai_ocr_job (accounting_office_id, candidate_id, document_id, status, result_json, divergence)
         VALUES ($1,$2,$3,'CONCLUIDO',$4,$5) RETURNING id`,
        [user.officeId, cand, documentId ?? null,
          JSON.stringify({ modo: result.modo, confianca: result.confianca, classificacao: result.classificacao,
            campos: result.campos, divergencias: result.divergencias, observacoes: result.observacoes,
            nomeBanco, custoUsd: result.custoUsd }), divergente])).rows[0];

      await appendLedger(c, { candidateId: cand, officeId: user.officeId, resourceType: 'ocr', resourceId: job.id,
        eventType: 'OCR_PROCESSADO', actorUserId: user.sub, actorRole: user.role,
        payload: { modo: result.modo, divergente, confianca: result.confianca } });

      return {
        jobId: job.id,
        modo: result.modo,
        classificacao: result.classificacao,
        confianca: result.confianca,
        campos: result.campos,
        divergencias: result.divergencias,
        divergente,
        observacao: 'IA não altera cadastro automaticamente; apenas sinaliza para revisão humana.',
        custoUsd: result.custoUsd,
      };
    });
  });
}
