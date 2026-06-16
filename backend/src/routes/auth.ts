import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveLogin } from '../core/auth.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // E-mail/identificador de login (aceita usuários de demonstração sem TLD).
  const loginSchema = z.object({ email: z.string().min(3).max(120), senha: z.string().min(1) });

  app.post('/api/login', async (req, reply) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ erro: 'payload inválido' });
    const user = await resolveLogin(p.data.email, p.data.senha);
    if (!user) return reply.code(401).send({ erro: 'credenciais inválidas' });
    const token = app.jwt.sign(user, { expiresIn: '8h' });
    return { token, usuario: { nome: user.name, papel: user.role, candidatos: user.candidateIds.length } };
  });

  app.get('/api/me', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.code(401).send({ erro: 'não autenticado' }); }
    const u = req.user;
    return { nome: u.name, papel: u.role, officeId: u.officeId, candidatos: u.candidateIds.length };
  });
}
