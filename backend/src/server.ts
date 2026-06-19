import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { env } from './core/env.js';
import { ensureBucket } from './core/storage.js';
import { adminPool } from './core/db.js';
import { rateLimit } from './core/util.js';
import { authRoutes } from './routes/auth.js';
import { appRoutes } from './routes/app.js';
import { modules1 } from './routes/modules1.js';
import { modules2 } from './routes/modules2.js';
import { modules3 } from './routes/modules3.js';
import { platformRoutes } from './routes/platform.js';
import { publicRoutes } from './routes/public.js';
import { openapiDoc } from './core/openapi.js';

const app = Fastify({
  logger: { level: 'info' },
  // Limite de tamanho de requisição (defesa de borda)
  bodyLimit: 5 * 1024 * 1024,
});

// CORS restrito: apenas o domínio público (e localhost para desenvolvimento).
const corsAllow = [
  `https://${process.env.DOMAIN ?? ''}`,
  'http://localhost', 'http://localhost:8080',
].filter((o) => o && o !== 'https://');
await app.register(cors, {
  origin: (origin, cb) => cb(null, !origin || corsAllow.includes(origin)),
});
await app.register(jwt, { secret: env.jwtSecret });

// Rate limit por IP (defesa de borda): 240 req/min.
app.addHook('onRequest', async (req, reply) => {
  const id = `${req.ip}`;
  if (!rateLimit(id, 240, 60_000)) reply.code(429).send({ erro: 'muitas requisições, tente novamente em instantes' });
});

// Health/readiness e OpenAPI (sem autenticação)
app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString(), servico: 'sistema-campanha' }));
app.get('/api/ready', async (_req, reply) => {
  try { await adminPool.query('SELECT 1'); return { ready: true }; }
  catch { return reply.code(503).send({ ready: false }); }
});
app.get('/api/openapi.json', async () => openapiDoc);

// Tratador de erros global: mapeia id inválido (uuid malformado) p/ 400 e
// não vaza detalhe interno do banco em 500.
app.setErrorHandler((err, req, reply) => {
  if ((err as any).code === '22P02') return reply.code(400).send({ erro: 'identificador inválido' });
  req.log.error(err);
  reply.code((err as any).statusCode ?? 500).send({ erro: 'erro interno' });
});

await app.register(authRoutes);
await app.register(publicRoutes);
await app.register(appRoutes);
await app.register(modules1);
await app.register(modules2);
await app.register(modules3);
await app.register(platformRoutes);

try {
  await ensureBucket();
  await app.listen({ host: '0.0.0.0', port: env.port });
  app.log.info(`API ouvindo em ${env.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
