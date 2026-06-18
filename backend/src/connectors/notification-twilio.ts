// Adapter Twilio — SMS, WhatsApp e OTP. Mock seguro se sem credenciais.
// IMPORTANTE: não logamos número de destino, OTP, ou corpo da mensagem (arquitetura 18).

import { env, hasIntegration } from '../core/env.js';

export type Canal = 'SMS' | 'WHATSAPP';

export interface SendInput {
  canal: Canal;
  to: string; // E.164: +55119...
  message: string;
}

export interface SendResult {
  modo: 'MOCK' | 'REAL';
  sid?: string; // Twilio Message SID
  status: 'enviado' | 'falha' | 'mock';
  erro?: string;
}

function basicAuth(): string {
  const sid = env.twilio.accountSid!;
  const tok = env.twilio.authToken!;
  return Buffer.from(`${sid}:${tok}`).toString('base64');
}

function fromFor(canal: Canal): string {
  if (canal === 'WHATSAPP') return env.twilio.whatsappFrom ?? '';
  return env.twilio.smsFrom ?? '';
}

export async function notifySend(input: SendInput): Promise<SendResult> {
  const hasCreds = hasIntegration('TWILIO_ACCOUNT_SID') && hasIntegration('TWILIO_AUTH_TOKEN');
  if (!hasCreds || !fromFor(input.canal)) {
    // Modo mock: registra apenas que houve tentativa; sem destino nem corpo.
    return { modo: 'MOCK', status: 'mock' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.twilio.accountSid}/Messages.json`;
  const params = new URLSearchParams();
  const toPrefixed = input.canal === 'WHATSAPP' ? `whatsapp:${input.to}` : input.to;
  params.append('To', toPrefixed);
  params.append('From', fromFor(input.canal));
  params.append('Body', input.message);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data: any = await res.json();
    if (!res.ok) {
      return { modo: 'REAL', status: 'falha', erro: String(data?.message ?? `HTTP ${res.status}`) };
    }
    return { modo: 'REAL', status: 'enviado', sid: data.sid };
  } catch (e) {
    return { modo: 'REAL', status: 'falha', erro: (e as Error).message.slice(0, 120) };
  }
}

// Geração de OTP local (não delegamos ao Twilio Verify por simplicidade).
// Em produção, recomendado migrar para Twilio Verify para anti-bot + brute force.
export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
