import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withScope, adminPool } from '../core/db.js';
import { authenticate, requireRole, userToScope, hashPassword } from '../core/auth.js';

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

  // ---------------- Coordenadores (usuários) ----------------
  // user_membership NÃO tem RLS (é identidade — gerida pelo adminPool, exceção
  // como o login). Por isso o escopo é enforçado MANUALMENTE aqui: o admin só
  // cria coordenadores para candidatos do PRÓPRIO escopo/escritório. Os limites
  // de cardinalidade (1 coord-geral por candidato, ≤40 coord-locais) são
  // garantidos no banco (fase 004) e seus erros são mapeados para 409.
  const COORD_ROLES = ['COORDENADOR_LOCAL', 'COORDENADOR_GERAL'] as const;

  app.get('/api/usuarios', async (req, reply) => {
    if (!requireRole(req, reply, ['ADMINISTRADOR_CAMPANHA'])) return;
    const user = req.user;
    if (user.candidateIds.length === 0) return { candidatos: [], coordenadores: [] };
    // Candidatos do escopo do admin (para o select), e os coordenadores já criados.
    const candidatos = (await adminPool.query(
      'SELECT id, name FROM candidate WHERE id = ANY($1::uuid[]) AND accounting_office_id = $2 ORDER BY name',
      [user.candidateIds, user.officeId])).rows;
    const coordenadores = (await adminPool.query(
      `SELECT u.name, u.email, m.role, m.status, c.name AS candidato
         FROM user_membership m
         JOIN app_user u ON u.id = m.user_id
         JOIN candidate c ON c.id = m.candidate_id
        WHERE m.accounting_office_id = $1
          AND m.candidate_id = ANY($2::uuid[])
          AND m.role = ANY($3::text[])
          AND m.status = 'ATIVO'
        ORDER BY c.name, m.role, u.name`,
      [user.officeId, user.candidateIds, COORD_ROLES as unknown as string[]])).rows;
    return { candidatos, coordenadores };
  });

  const userSchema = z.object({
    name: z.string().min(2).max(160),
    // E-mail leniente: o sistema usa endereços sem TLD (ex.: admin.ana@demo),
    // que o z.string().email() rejeitaria. Basta "algo@algo".
    email: z.string().min(3).max(160).regex(/^[^\s@]+@[^\s@]+$/, 'e-mail inválido'),
    password: z.string().min(8).max(100),
    role: z.enum(COORD_ROLES),
    candidate_id: z.string().uuid(),
  });
  app.post('/api/usuarios', async (req, reply) => {
    if (!requireRole(req, reply, ['ADMINISTRADOR_CAMPANHA'])) return;
    const p = userSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ erro: 'payload inválido' });
    const user = req.user;
    // Escopo manual: o candidato precisa estar no escopo do admin (adminPool bypassa RLS).
    if (!user.candidateIds.includes(p.data.candidate_id)) {
      return reply.code(403).send({ erro: 'candidato fora do seu escopo' });
    }
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      // Confirma que o candidato é do escritório do admin e pega a campanha.
      const cand = (await client.query(
        'SELECT id, campaign_id FROM candidate WHERE id = $1 AND accounting_office_id = $2',
        [p.data.candidate_id, user.officeId])).rows[0];
      if (!cand) { await client.query('ROLLBACK'); return reply.code(404).send({ erro: 'candidato fora do escopo' }); }

      const u = (await client.query(
        'INSERT INTO app_user (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id',
        [p.data.name, p.data.email.toLowerCase(), hashPassword(p.data.password)])).rows[0];
      await client.query(
        `INSERT INTO user_membership (user_id, accounting_office_id, campaign_id, candidate_id, role)
         VALUES ($1,$2,$3,$4,$5)`,
        [u.id, user.officeId, cand.campaign_id, cand.id, p.data.role]);
      await client.query('COMMIT');
      return { id: u.id, role: p.data.role };
    } catch (e: any) {
      await client.query('ROLLBACK');
      // Mapeia violações em mensagens claras (sem vazar detalhe do banco).
      if (e?.code === '23505' && String(e.constraint).includes('email')) {
        return reply.code(409).send({ erro: 'e-mail já cadastrado' });
      }
      if (e?.code === '23505' && String(e.constraint).includes('coord_geral')) {
        return reply.code(409).send({ erro: 'já existe um COORDENADOR_GERAL para este candidato' });
      }
      if (e?.code === '23505' && String(e.constraint).includes('admin')) {
        return reply.code(409).send({ erro: 'já existe um ADMINISTRADOR_CAMPANHA para este candidato' });
      }
      if (e?.code === '23514') { // trigger de limite (≤40 coord-locais)
        return reply.code(409).send({ erro: 'limite de 40 coordenadores locais por candidato atingido' });
      }
      throw e;
    } finally {
      client.release();
    }
  });
}
