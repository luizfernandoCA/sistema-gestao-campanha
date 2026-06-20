import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminPool, withScope, type Scope } from '../core/db.js';
import { appendLedger } from '../core/audit.js';
import { transition, WorkflowConflict } from '../core/workflow.js';
import { sha256, hmac, encField, decField } from '../core/crypto.js';
import { putEncrypted } from '../core/storage.js';
import { renderContractPdf, stripHtml } from '../core/pdf.js';

// Decifra um campo curto, tolerando valor ausente/legado (não quebra a página).
function safeDec(v: string | null): string {
  if (!v) return '';
  try { return decField(v); } catch { return ''; }
}
// Escopo da formiguinha (signatário sem login): travado em 1 candidato.
function formiguinhaScope(sr: { worker_id: string; accounting_office_id: string; candidate_id: string }): Scope {
  return { userId: sr.worker_id, role: 'FORMIGUINHA', officeId: sr.accounting_office_id, candidateIds: [sr.candidate_id] };
}
const formiguinhaUser = (sr: { accounting_office_id: string; candidate_id: string }) =>
  ({ sub: null as unknown as string, name: 'formiguinha', role: 'FORMIGUINHA', officeId: sr.accounting_office_id, candidateIds: [sr.candidate_id] });

// OTP mock em memória (canal de entrega é simulado). token_hash -> {otp, exp, tentativas}
const otpStore = new Map<string, { otp: string; exp: number; tentativas: number }>();
const OTP_MAX_TENTATIVAS = 5;

// Rotas PÚBLICAS (sem login): a posse do token de assinatura remota autoriza
// apenas o documento daquele token. Resolve escopo via pool admin e opera com RLS.
export async function publicRoutes(app: FastifyInstance): Promise<void> {
  async function resolveReq(token: string) {
    const th = sha256(token);
    return (await adminPool.query(
      `SELECT sr.id, sr.document_id, sr.candidate_id, sr.worker_id, sr.status, sr.expires_at,
              d.accounting_office_id
         FROM signature_request sr JOIN document_instance d ON d.id = sr.document_id
        WHERE sr.token_hash = $1 AND sr.request_type='REMOTA'`, [th])).rows[0];
  }

  // ---------- Carrega o contexto de assinatura pelo token (sem login) ----------
  // Devolve o contrato p/ leitura e os dados atuais da pessoa p/ conferência,
  // e marca o documento como VISUALIZADO_PELA_FORMIGUINHA (best-effort).
  app.get('/api/publico/assinatura/:token', async (req, reply) => {
    const token = (req.params as any).token;
    const sr = await resolveReq(token);
    if (!sr || sr.status !== 'PENDENTE' || new Date(sr.expires_at) < new Date())
      return reply.code(404).send({ erro: 'link inválido ou expirado' });
    return withScope(formiguinhaScope(sr), async (c) => {
      const row = (await c.query(
        `SELECT d.status, cc.name AS candidato, w.name_enc, w.cpf_enc, w.phone_enc, w.email_enc, v.content_html
           FROM document_instance d
           JOIN candidate cc ON cc.id = d.candidate_id
           JOIN worker w ON w.id = d.worker_id
           JOIN contract_template_version v ON v.id = d.contract_template_version_id
          WHERE d.id = $1`, [sr.document_id])).rows[0];
      if (!row) return reply.code(404).send({ erro: 'documento indisponível' });
      try {
        await transition(c, { id: sr.document_id, candidateId: sr.candidate_id, officeId: sr.accounting_office_id },
          ['CONTRATO_GERADO', 'ENVIADO_PARA_ASSINATURA'], 'VISUALIZADO_PELA_FORMIGUINHA',
          formiguinhaUser(sr), 'VISUALIZADO_FORMIGUINHA');
      } catch (e) { if (!(e instanceof WorkflowConflict)) throw e; }
      return {
        candidato: row.candidato,
        contratoHtml: row.content_html,
        dados: { nome: safeDec(row.name_enc), cpf: safeDec(row.cpf_enc), telefone: safeDec(row.phone_enc), email: safeDec(row.email_enc) },
        expira_em: sr.expires_at,
      };
    });
  });

  // ---------- A formiguinha preenche/confere os PRÓPRIOS dados ----------
  const dadosSchema = z.object({
    nome: z.string().min(1).max(160),
    cpf: z.string().min(11).max(20),
    telefone: z.string().max(40).optional().default(''),
    email: z.string().email().max(160).optional().or(z.literal('')).default(''),
  });
  app.post('/api/publico/assinatura/:token/dados', async (req, reply) => {
    const token = (req.params as any).token;
    const sr = await resolveReq(token);
    if (!sr || sr.status !== 'PENDENTE' || new Date(sr.expires_at) < new Date())
      return reply.code(404).send({ erro: 'link inválido ou expirado' });
    const p = dadosSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ erro: 'dados inválidos', detalhe: p.error.issues.map((i) => i.path.join('.') + ': ' + i.message) });
    const cpf = p.data.cpf.replace(/\D/g, '');
    if (cpf.length !== 11) return reply.code(400).send({ erro: 'CPF deve ter 11 dígitos' });
    try {
      return await withScope(formiguinhaScope(sr), async (c) => {
        // WHERE travado no worker do token — não dá p/ tocar em outra pessoa.
        // Grava só cifrado; name_plain=NULL zera qualquer claro legado da linha.
        await c.query(
          `UPDATE worker SET name_enc=$1, name_plain=NULL, cpf_hmac=$2, cpf_enc=$3, phone_enc=$4, email_enc=$5 WHERE id=$6`,
          [encField(p.data.nome), hmac(cpf), encField(cpf),
           p.data.telefone ? encField(p.data.telefone) : null,
           p.data.email ? encField(p.data.email) : null, sr.worker_id]);
        await appendLedger(c, { candidateId: sr.candidate_id, officeId: sr.accounting_office_id,
          resourceType: 'worker', resourceId: sr.worker_id, eventType: 'DADOS_FORMIGUINHA_PREENCHIDOS',
          actorRole: 'FORMIGUINHA', payload: { campos: ['nome', 'cpf', 'telefone', 'email'] } });
        return { ok: true };
      });
    } catch (e: any) {
      if (e?.code === '23505') return reply.code(409).send({ erro: 'CPF já cadastrado para outra pessoa neste escritório' });
      throw e;
    }
  });

  app.post('/api/publico/assinatura/remota/otp', async (req, reply) => {
    const token = (req.body as any)?.token;
    if (!token) return reply.code(400).send({ erro: 'token obrigatório' });
    const sr = await resolveReq(token);
    if (!sr || sr.status !== 'PENDENTE' || new Date(sr.expires_at) < new Date())
      return reply.code(404).send({ erro: 'token inválido ou expirado' });
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(sha256(token), { otp, exp: Date.now() + 10 * 60 * 1000, tentativas: 0 });
    // Em produção, enviaria por SMS/WhatsApp; aqui é mock e retorna no corpo.
    return { enviado: true, canal: 'MOCK', otp_mock: otp };
  });

  app.post('/api/publico/assinatura/remota/concluir', async (req, reply) => {
    const { token, otp, assinaturaBase64 } = (req.body as any) ?? {};
    if (!token || !otp || !assinaturaBase64) return reply.code(400).send({ erro: 'token, otp e assinatura obrigatórios' });
    const chal = otpStore.get(sha256(token));
    if (!chal || chal.exp < Date.now()) return reply.code(401).send({ erro: 'OTP inválido ou expirado' });
    if (chal.tentativas >= OTP_MAX_TENTATIVAS) { otpStore.delete(sha256(token)); return reply.code(429).send({ erro: 'muitas tentativas de OTP; solicite novo código' }); }
    if (chal.otp !== String(otp)) { chal.tentativas++; return reply.code(401).send({ erro: 'OTP inválido' }); }
    const sr = await resolveReq(token);
    if (!sr || sr.status !== 'PENDENTE') return reply.code(404).send({ erro: 'token inválido' });

    const scope: Scope = { userId: sr.worker_id, role: 'FORMIGUINHA', officeId: sr.accounting_office_id, candidateIds: [sr.candidate_id] };
    try {
      return await withScope(scope, async (c) => {
        const doc = (await c.query(
          `SELECT d.id, d.candidate_id, d.accounting_office_id, d.worker_id, f.sha256_hash,
                  cc.name AS cand, w.name_enc AS worker_enc, v.content_html
             FROM document_instance d JOIN document_file f ON f.id=d.current_file_id
             JOIN candidate cc ON cc.id=d.candidate_id JOIN worker w ON w.id=d.worker_id
             JOIN contract_template_version v ON v.id=d.contract_template_version_id
            WHERE d.id=$1`, [sr.document_id])).rows[0];
        if (!doc) return reply.code(404).send({ erro: 'documento indisponível' });
        const workerNome = safeDec(doc.worker_enc);
        const hashBefore = doc.sha256_hash;
        const signedAt = new Date().toISOString();
        const sealed = await renderContractPdf({ title: 'Contrato de Prestação de Serviços de Campanha', candidate: doc.cand, worker: workerNome, bodyText: stripHtml(doc.content_html), signatures: [{ who: `Formiguinha (remota) ${workerNome}`, at: signedAt, hash: hashBefore }] });
        const key = `office/${doc.accounting_office_id}/cand/${doc.candidate_id}/doc/${doc.id}/contrato-assinado-remota.pdf`;
        const sf = await putEncrypted(key, sealed);
        const nf = (await c.query(
          `INSERT INTO document_file (document_id, candidate_id, file_type, file_role, storage_bucket, storage_key, mime_type, size_bytes, sha256_hash, encryption_key_id, encrypted_data_key)
           VALUES ($1,$2,'PDF_CONTRATO','ASSINADO_FORMIGUINHA_REMOTA',$3,$4,'application/pdf',$5,$6,$7,$8) RETURNING id`,
          [doc.id, doc.candidate_id, sf.bucket, sf.key, sf.size, sf.sha256, sf.keyId, sf.encryptedDataKey])).rows[0];
        const sig = (await c.query(
          `INSERT INTO signature (document_id, candidate_id, signer_type, signer_id, signature_type, signature_image_file_id, document_hash_before, document_hash_after)
           VALUES ($1,$2,'FORMIGUINHA',$3,'ELETRONICA_EVIDENCIADA',$4,$5,$6) RETURNING id`,
          [doc.id, doc.candidate_id, doc.worker_id, nf.id, hashBefore, sf.sha256])).rows[0];
        await c.query(
          `INSERT INTO signature_evidence (signature_id, document_id, candidate_id, signer_type, ip_hash, user_agent, acceptance_hash, document_hash_before, document_hash_after)
           VALUES ($1,$2,$3,'FORMIGUINHA',$4,$5,$6,$7,$8)`,
          [sig.id, doc.id, doc.candidate_id, hmac(req.ip), String(req.headers['user-agent'] ?? ''), sha256('remota-aceite-' + sig.id), hashBefore, sf.sha256]);
        await c.query('UPDATE document_instance SET current_file_id=$1 WHERE id=$2', [nf.id, doc.id]);
        await c.query("UPDATE signature_request SET status='CONCLUIDA' WHERE id=$1", [sr.id]);
        // Ator nulo: o signatário remoto é uma formiguinha (worker), não um app_user.
        await transition(c, { id: doc.id, candidateId: doc.candidate_id, officeId: doc.accounting_office_id }, ['ENVIADO_PARA_ASSINATURA', 'CONTRATO_GERADO', 'EM_ASSINATURA_ASSISTIDA', 'VISUALIZADO_PELA_FORMIGUINHA', 'ACEITE_REGISTRADO'], 'AGUARDANDO_ADMINISTRADOR', { sub: null as unknown as string, name: 'formiguinha', role: 'FORMIGUINHA', officeId: doc.accounting_office_id, candidateIds: [doc.candidate_id] }, 'ASSINADA_FORMIGUINHA_REMOTA', { hashBefore, hashAfter: sf.sha256 });
        otpStore.delete(sha256(token));
        return { status: 'AGUARDANDO_ADMINISTRADOR', hashAfter: sf.sha256 };
      });
    } catch (e) {
      if (e instanceof WorkflowConflict) return reply.code(409).send({ erro: e.message });
      throw e;
    }
  });
}
