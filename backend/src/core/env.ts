// Carrega e valida variáveis de ambiente. Sem segredos no código.
// Variáveis obrigatórias falham na inicialização (fail fast).
// Variáveis de integração são opcionais — sem elas o connector roda em modo MOCK.
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v : undefined;
}

// True se a variável está presente e não vazia. Use para detectar modo MOCK vs REAL.
export function hasIntegration(name: string): boolean {
  return !!opt(name);
}

const emailProvider = (opt('EMAIL_PROVIDER') ?? 'resend').toLowerCase();
const signatureProvider = (opt('SIGNATURE_PROVIDER') ?? 'clicksign').toLowerCase();

export const env = {
  port: parseInt(process.env.PORT ?? '8080', 10),
  // Pool da aplicação (papel app_rw — RLS aplicado)
  databaseUrl: req('DATABASE_URL'),
  // Pool administrativo (owner — usado só para autenticação/migrations)
  adminDatabaseUrl: req('ADMIN_DATABASE_URL'),
  jwtSecret: req('JWT_SECRET'),
  // Chave mestra do "KMS local" (base64 de 32 bytes) — envelope encryption
  masterKeyB64: req('MASTER_KEY_B64'),
  // Chave para HMAC de CPF/telefone (dedup/busca sem expor o dado)
  hmacKey: req('HMAC_KEY'),
  s3: {
    endpoint: req('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKey: req('S3_ACCESS_KEY'),
    secretKey: req('S3_SECRET_KEY'),
    bucket: process.env.S3_BUCKET ?? 'documentos',
  },
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080',

  // ---------- Integrações opcionais ----------
  ai: {
    apiKey: opt('ANTHROPIC_API_KEY'),
    model: opt('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6',
  },
  twilio: {
    accountSid: opt('TWILIO_ACCOUNT_SID'),
    authToken: opt('TWILIO_AUTH_TOKEN'),
    smsFrom: opt('TWILIO_SMS_FROM'),
    whatsappFrom: opt('TWILIO_WHATSAPP_FROM'),
  },
  email: {
    provider: (emailProvider === 'resend' || emailProvider === 'sendgrid' ? emailProvider : 'none') as 'resend' | 'sendgrid' | 'none',
    from: opt('EMAIL_FROM') ?? 'sistema@escritorio.local',
    resendApiKey: opt('RESEND_API_KEY'),
    sendgridApiKey: opt('SENDGRID_API_KEY'),
  },
  signature: {
    provider: (signatureProvider === 'clicksign' || signatureProvider === 'd4sign' ? signatureProvider : 'none') as 'clicksign' | 'd4sign' | 'none',
    clicksignToken: opt('CLICKSIGN_API_TOKEN'),
    clicksignApiBase: opt('CLICKSIGN_API_BASE'),
    d4signToken: opt('D4SIGN_API_TOKEN'),
    d4signCryptKey: opt('D4SIGN_CRYPT_KEY'),
    d4signSafeUuid: opt('D4SIGN_SAFE_UUID'),
    d4signApiBase: opt('D4SIGN_API_BASE'),
  },
  // Origens CORS permitidas (CSV). Em produção, restringir ao domínio.
  corsOrigins: (opt('CORS_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  // Nome do domínio público (para Caddy + CORS auto).
  domain: opt('DOMAIN') ?? 'localhost',
};
