// Adapter de e-mail transacional. Suporta Resend (default) e SendGrid.
// Sem chave -> mock. Mensagens nunca contêm dados sensíveis em texto aberto
// (regra técnica 18: arquitetura de notificações).

import { env, hasIntegration } from '../core/env.js';

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  // ReplyTo opcional para roteamento de contestação/contato.
  replyTo?: string;
}

export interface EmailResult {
  modo: 'MOCK' | 'REAL';
  id?: string;
  status: 'enviado' | 'falha' | 'mock';
  erro?: string;
}

async function sendResend(input: EmailInput): Promise<EmailResult> {
  const body = {
    from: env.email.from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    reply_to: input.replyTo,
  };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.email.resendApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data: any = await res.json();
    if (!res.ok) {
      return { modo: 'REAL', status: 'falha', erro: String(data?.message ?? `HTTP ${res.status}`) };
    }
    return { modo: 'REAL', status: 'enviado', id: data.id };
  } catch (e) {
    return { modo: 'REAL', status: 'falha', erro: (e as Error).message.slice(0, 120) };
  }
}

async function sendSendgrid(input: EmailInput): Promise<EmailResult> {
  const body = {
    personalizations: [{ to: [{ email: input.to }] }],
    from: { email: env.email.from },
    reply_to: input.replyTo ? { email: input.replyTo } : undefined,
    subject: input.subject,
    content: [
      { type: 'text/plain', value: input.text ?? input.html.replace(/<[^>]+>/g, ' ') },
      { type: 'text/html', value: input.html },
    ],
  };
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.email.sendgridApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 202) {
      return { modo: 'REAL', status: 'enviado', id: res.headers.get('x-message-id') ?? undefined };
    }
    const txt = await res.text();
    return { modo: 'REAL', status: 'falha', erro: txt.slice(0, 200) };
  } catch (e) {
    return { modo: 'REAL', status: 'falha', erro: (e as Error).message.slice(0, 120) };
  }
}

export async function emailSend(input: EmailInput): Promise<EmailResult> {
  if (env.email.provider === 'resend' && hasIntegration('RESEND_API_KEY')) {
    return sendResend(input);
  }
  if (env.email.provider === 'sendgrid' && hasIntegration('SENDGRID_API_KEY')) {
    return sendSendgrid(input);
  }
  return { modo: 'MOCK', status: 'mock' };
}
