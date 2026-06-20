import { readFileSync } from 'node:fs';

// Carrega e valida variáveis de ambiente. Sem segredos no código.
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

// Master key: prioriza ARQUIVO/Docker secret (não fica no .env nem aparece em
// `docker inspect`); cai para a env MASTER_KEY_B64 apenas como compatibilidade.
// O VALOR é o mesmo de antes — muda só a origem da leitura (nada a remigrar).
function masterKeyB64(): string {
  const file = process.env.MASTER_KEY_FILE ?? '/run/secrets/master_key';
  try {
    const v = readFileSync(file, 'utf8').trim();
    if (v) return v;
  } catch { /* arquivo ausente — usa a env como fallback */ }
  return req('MASTER_KEY_B64');
}

export const env = {
  port: parseInt(process.env.PORT ?? '8080', 10),
  // Pool da aplicação (papel app_rw — RLS aplicado)
  databaseUrl: req('DATABASE_URL'),
  // Pool administrativo (owner — usado só para autenticação/migrations)
  adminDatabaseUrl: req('ADMIN_DATABASE_URL'),
  jwtSecret: req('JWT_SECRET'),
  // Chave mestra do "KMS local" (base64 de 32 bytes) — envelope encryption
  masterKeyB64: masterKeyB64(),
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
  // Redis (store de OTP — sobrevive a restart/escala; antes era memória do processo).
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
  // Espelhamento do PDF finalizado no Google Drive (destino adicional).
  // Padrão 'log' (mock, sem rede). 'google' exige a credencial abaixo.
  drive: {
    mode: ((process.env.DRIVE_MODE ?? 'log').toLowerCase() === 'google' ? 'google' : 'log') as 'log' | 'google',
    saJsonB64: process.env.GOOGLE_SA_JSON_B64 ?? '',   // JSON da service account em base64
    rootFolderId: process.env.GDRIVE_ROOT_FOLDER_ID ?? '', // pasta raiz compartilhada c/ a SA
  },
};
