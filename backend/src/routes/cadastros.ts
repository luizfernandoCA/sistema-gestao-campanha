import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withScope } from '../core/db.js';
import { authenticate, requireRole, userToScope } from '../core/auth.js';

// Cadastros de setup do ESCRITÓRIO: campanhas e candidatos.
// Ambas as tabelas têm RLS por escritório (p_office_camp / p_office_cand com
// WITH CHECK accounting_office_id = app_office()), então o insert via withScope
// usando user.officeId passa. Não há entrada no ledger (ele é por-candidato e o
// candidato recém-criado ainda não está no escopo de quem cria).
export async function cadastroRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  // ---------------- Campanhas ----------------
  app.get('/api/campanhas', async (req) =>
    withScope(userToScope(req.user), async (c) =>
      (await c.query(
        `SELECT id, election_year, election_type, state, status,
                prazo_envio_dias, prazo_assinatura_dias
           FROM campaign ORDER BY election_year DESC, state`)).rows));

  const campSchema = z.object({
    election_year: z.number().int().min(2000).max(2100),
    election_type: z.string().min(2).max(40),
    state: z.string().length(2),
    prazo_envio_dias: z.number().int().min(1).max(365).optional(),
    prazo_assinatura_dias: z.number().int().min(1).max(365).optional(),
  });
  app.post('/api/campanhas', async (req, reply) => {
    if (!requireRole(req, reply, ['ADMINISTRADOR_CAMPANHA'])) return;
    const p = campSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ erro: 'payload inválido' });
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const r = (await c.query(
        `INSERT INTO campaign (accounting_office_id, election_year, election_type, state,
                               prazo_envio_dias, prazo_assinatura_dias)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status`,
        [user.officeId, p.data.election_year, p.data.election_type.toUpperCase(),
         p.data.state.toUpperCase(), p.data.prazo_envio_dias ?? null, p.data.prazo_assinatura_dias ?? null],
      )).rows[0];
      return { id: r.id, status: r.status };
    });
  });

  // ---------------- Candidatos ----------------
  const candSchema = z.object({
    name: z.string().min(2).max(160),
    candidate_number: z.string().min(1).max(10),
    party: z.string().min(1).max(80),
    campaign_id: z.string().uuid(),
  });
  app.post('/api/candidatos', async (req, reply) => {
    if (!requireRole(req, reply, ['ADMINISTRADOR_CAMPANHA'])) return;
    const p = candSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ erro: 'payload inválido' });
    const user = req.user;
    return withScope(userToScope(user), async (c) => {
      const camp = (await c.query('SELECT id FROM campaign WHERE id=$1', [p.data.campaign_id])).rows[0];
      if (!camp) return reply.code(404).send({ erro: 'campanha fora do escopo' });
      const r = (await c.query(
        `INSERT INTO candidate (accounting_office_id, campaign_id, name, candidate_number, party)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, status`,
        [user.officeId, camp.id, p.data.name, p.data.candidate_number, p.data.party],
      )).rows[0];
      return { id: r.id, status: r.status };
    });
  });
}
