import type { FastifyInstance } from 'fastify';
import { adminPool, withScope, type Scope } from '../core/db.js';
import { appendLedger } from '../core/audit.js';
import { transition, WorkflowConflict } from '../core/workflow.js';
import { sha256, hmac, randomToken } from '../core/crypto.js';
import { putEncrypted } from '../core/storage.js';
import { renderContractPdf, stripHtml } from '../core/pdf.js';

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
                  cc.name AS cand, w.name_plain AS worker, v.content_html
             FROM document_instance d JOIN document_file f ON f.id=d.current_file_id
             JOIN candidate cc ON cc.id=d.candidate_id JOIN worker w ON w.id=d.worker_id
             JOIN contract_template_version v ON v.id=d.contract_template_version_id
            WHERE d.id=$1`, [sr.document_id])).rows[0];
        if (!doc) return reply.code(404).send({ erro: 'documento indisponível' });
        const hashBefore = doc.sha256_hash;
        const signedAt = new Date().toISOString();
        const sealed = await renderContractPdf({ title: 'Contrato de Prestação de Serviços de Campanha', candidate: doc.cand, worker: doc.worker, bodyText: stripHtml(doc.content_html), signatures: [{ who: `Formiguinha (remota) ${doc.worker}`, at: signedAt, hash: hashBefore }] });
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
        await transition(c, { id: doc.id, candidateId: doc.candidate_id, officeId: doc.accounting_office_id }, ['ENVIADO_PARA_ASSINATURA', 'CONTRATO_GERADO', 'EM_ASSINATURA_ASSISTIDA'], 'AGUARDANDO_ADMINISTRADOR', { sub: null as unknown as string, name: 'formiguinha', role: 'FORMIGUINHA', officeId: doc.accounting_office_id, candidateIds: [doc.candidate_id] }, 'ASSINADA_FORMIGUINHA_REMOTA', { hashBefore, hashAfter: sf.sha256 });
        otpStore.delete(sha256(token));
        return { status: 'AGUARDANDO_ADMINISTRADOR', hashAfter: sf.sha256 };
      });
    } catch (e) {
      if (e instanceof WorkflowConflict) return reply.code(409).send({ erro: e.message });
      throw e;
    }
  });
}
