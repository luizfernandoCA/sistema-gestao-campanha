// Camada central de connectors. Cada integração detecta se a chave está
// configurada em env. Sem chave -> modo MOCK seguro e logado. Com chave -> chamada real.
// Nenhuma chave é hardcoded. Nenhum dado sensível vai para logs.

import { env, hasIntegration } from '../core/env.js';

export type Modo = 'MOCK' | 'REAL';

export interface ConnectorStatus {
  ai: { provider: 'anthropic'; mode: Modo; model?: string };
  sms: { provider: 'twilio'; mode: Modo };
  whatsapp: { provider: 'twilio'; mode: Modo };
  email: { provider: 'resend' | 'sendgrid' | 'none'; mode: Modo };
  signature: { provider: 'clicksign' | 'd4sign' | 'none'; mode: Modo };
  storage: { provider: 's3'; mode: Modo; endpoint: string };
  kms: { provider: 'local-aes-gcm'; mode: 'REAL' };
}

export function connectorStatus(): ConnectorStatus {
  return {
    ai: {
      provider: 'anthropic',
      mode: hasIntegration('ANTHROPIC_API_KEY') ? 'REAL' : 'MOCK',
      model: env.ai.model,
    },
    sms: {
      provider: 'twilio',
      mode: hasIntegration('TWILIO_ACCOUNT_SID') && hasIntegration('TWILIO_AUTH_TOKEN') ? 'REAL' : 'MOCK',
    },
    whatsapp: {
      provider: 'twilio',
      mode: hasIntegration('TWILIO_ACCOUNT_SID') && hasIntegration('TWILIO_WHATSAPP_FROM') ? 'REAL' : 'MOCK',
    },
    email: {
      provider: env.email.provider,
      mode: env.email.provider === 'resend' && hasIntegration('RESEND_API_KEY') ? 'REAL'
        : env.email.provider === 'sendgrid' && hasIntegration('SENDGRID_API_KEY') ? 'REAL'
        : 'MOCK',
    },
    signature: {
      provider: env.signature.provider,
      mode: env.signature.provider === 'clicksign' && hasIntegration('CLICKSIGN_API_TOKEN') ? 'REAL'
        : env.signature.provider === 'd4sign' && hasIntegration('D4SIGN_API_TOKEN') && hasIntegration('D4SIGN_CRYPT_KEY') ? 'REAL'
        : 'MOCK',
    },
    storage: { provider: 's3', mode: 'REAL', endpoint: env.s3.endpoint },
    kms: { provider: 'local-aes-gcm', mode: 'REAL' },
  };
}

export * from './ai-anthropic.js';
export * from './notification-twilio.js';
export * from './email.js';
export * from './signature.js';
