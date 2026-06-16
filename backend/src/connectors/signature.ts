// Adapter de assinatura eletrônica com valor jurídico ICP-Brasil (Lei 14.063/2020).
// Suporta ClickSign (default) e D4Sign. Sem chave -> mantém fluxo de assinatura
// assistida interno com pacote de evidências (já compatível com art. 4º/5º).
//
// Quando configurado, o sistema OFERECE assinatura externa como upgrade
// (avançada/qualificada) — o fluxo interno continua válido como evidenciada.

import { env, hasIntegration } from '../core/env.js';

export interface SignatureEnvelope {
  documentName: string;
  pdfBase64: string; // PDF a assinar (já gerado pelo sistema)
  signer: {
    name: string;
    email: string;
    phone?: string;
    cpf?: string; // sem máscara, 11 dígitos
    birthdate?: string; // YYYY-MM-DD
  };
  authentication: 'email' | 'sms' | 'whatsapp' | 'selfie';
  // URL para webhook de retorno (status: enviado, visualizado, assinado, recusado)
  webhookUrl?: string;
}

export interface SignatureCreateResult {
  modo: 'MOCK' | 'REAL';
  provider: 'clicksign' | 'd4sign' | 'none';
  envelopeId?: string;
  signerLink?: string; // link que o signatário recebe
  status: 'enviado' | 'falha' | 'mock';
  erro?: string;
}

async function createClickSign(input: SignatureEnvelope): Promise<SignatureCreateResult> {
  const base = env.signature.clicksignApiBase ?? 'https://app.clicksign.com';
  const token = env.signature.clicksignToken!;
  try {
    // 1) Criar documento via base64
    const upRes = await fetch(`${base}/api/v1/documents?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        document: {
          path: `/Contratos/${input.documentName}.pdf`,
          content_base64: `data:application/pdf;base64,${input.pdfBase64}`,
        },
      }),
    });
    const up: any = await upRes.json();
    if (!upRes.ok) return { modo: 'REAL', provider: 'clicksign', status: 'falha', erro: String(up?.message ?? `HTTP ${upRes.status}`) };
    const docKey = up?.document?.key;
    // 2) Criar signatário
    const auths: Record<string, string[]> = {
      email: ['email'], sms: ['sms'], whatsapp: ['whatsapp'], selfie: ['selfie'],
    };
    const signerRes = await fetch(`${base}/api/v1/signers?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        signer: {
          email: input.signer.email,
          phone_number: input.signer.phone ?? '',
          documentation: input.signer.cpf ?? '',
          birthday: input.signer.birthdate ?? '',
          has_documentation: !!input.signer.cpf,
          name: input.signer.name,
          auths: auths[input.authentication],
        },
      }),
    });
    const signer: any = await signerRes.json();
    if (!signerRes.ok) return { modo: 'REAL', provider: 'clicksign', status: 'falha', erro: String(signer?.message ?? `HTTP ${signerRes.status}`) };
    const signerKey = signer?.signer?.key;
    // 3) Adicionar signatário ao documento (signe como party = sign)
    await fetch(`${base}/api/v1/lists?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        list: { document_key: docKey, signer_key: signerKey, sign_as: 'party' },
      }),
    });
    // 4) Disparar notificação por e-mail
    await fetch(`${base}/api/v1/notifications?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_signature_key: signerKey, message: `Sua assinatura é necessária no documento ${input.documentName}` }),
    });
    return {
      modo: 'REAL',
      provider: 'clicksign',
      envelopeId: docKey,
      signerLink: `${base}/sign/${signerKey}`,
      status: 'enviado',
    };
  } catch (e) {
    return { modo: 'REAL', provider: 'clicksign', status: 'falha', erro: (e as Error).message.slice(0, 200) };
  }
}

async function createD4Sign(input: SignatureEnvelope): Promise<SignatureCreateResult> {
  const base = env.signature.d4signApiBase ?? 'https://secure.d4sign.com.br/api/v1';
  const tokenAPI = env.signature.d4signToken!;
  const cryptKey = env.signature.d4signCryptKey!;
  const safeUuid = env.signature.d4signSafeUuid; // Cofre para armazenar PDFs
  if (!safeUuid) return { modo: 'REAL', provider: 'd4sign', status: 'falha', erro: 'D4SIGN_SAFE_UUID ausente (cofre)' };
  try {
    // 1) Upload base64
    const upRes = await fetch(`${base}/documents/${safeUuid}/uploadbinary?tokenAPI=${tokenAPI}&cryptKey=${cryptKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base64_binary_file: input.pdfBase64, name: `${input.documentName}.pdf` }),
    });
    const up: any = await upRes.json();
    if (!upRes.ok || !up?.uuid) return { modo: 'REAL', provider: 'd4sign', status: 'falha', erro: String(up?.message ?? `HTTP ${upRes.status}`) };
    const docUuid = up.uuid;
    // 2) Adicionar signatário
    const auth = input.authentication === 'sms' ? 1 : input.authentication === 'whatsapp' ? 5 : 0;
    await fetch(`${base}/documents/${docUuid}/createlist?tokenAPI=${tokenAPI}&cryptKey=${cryptKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        signers: [{
          email: input.signer.email,
          act: 1, // signatário
          foreign: 0,
          certificadoicpbr: 0,
          assinatura_presencial: 0,
          docauth: auth,
          embed_methodauth: 'email',
          embed_smsnumber: input.signer.phone ?? '',
        }],
      }),
    });
    // 3) Enviar para assinar
    await fetch(`${base}/documents/${docUuid}/sendtosigner?tokenAPI=${tokenAPI}&cryptKey=${cryptKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Por favor assine o documento.', skip_email: '0', workflow: '0' }),
    });
    return {
      modo: 'REAL',
      provider: 'd4sign',
      envelopeId: docUuid,
      signerLink: `https://secure.d4sign.com.br/check/${docUuid}`,
      status: 'enviado',
    };
  } catch (e) {
    return { modo: 'REAL', provider: 'd4sign', status: 'falha', erro: (e as Error).message.slice(0, 200) };
  }
}

export async function signatureCreate(input: SignatureEnvelope): Promise<SignatureCreateResult> {
  if (env.signature.provider === 'clicksign' && hasIntegration('CLICKSIGN_API_TOKEN')) return createClickSign(input);
  if (env.signature.provider === 'd4sign' && hasIntegration('D4SIGN_API_TOKEN') && hasIntegration('D4SIGN_CRYPT_KEY')) return createD4Sign(input);
  return { modo: 'MOCK', provider: 'none', status: 'mock' };
}
