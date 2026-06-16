import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { adminPool, type Scope } from './db.js';

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}
export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

const OFFICE_WIDE = new Set(['CONTADOR', 'JURIDICO', 'AUDITOR', 'SUPORTE_INTERNO']);

export interface AuthUser {
  sub: string;
  name: string;
  role: string;
  officeId: string;
  candidateIds: string[];
}

// Resolve o escopo do usuário a partir das memberships (usa o pool admin =
// bypass RLS, exclusivamente para autenticação).
export async function resolveLogin(email: string, password: string): Promise<AuthUser | null> {
  const u = (await adminPool.query(
    'SELECT id, name, password_hash, status FROM app_user WHERE email = $1',
    [email],
  )).rows[0];
  if (!u || u.status !== 'ATIVO' || !verifyPassword(password, u.password_hash)) return null;

  const ms = (await adminPool.query(
    `SELECT role, accounting_office_id, campaign_id, candidate_id
       FROM user_membership WHERE user_id = $1 AND status = 'ATIVO'`,
    [u.id],
  )).rows;
  if (ms.length === 0) return null;

  const officeId: string = ms[0].accounting_office_id;
  const role: string = ms[0].role;

  let candidateIds: string[] = [];
  if (ms.some((m: any) => OFFICE_WIDE.has(m.role))) {
    candidateIds = (await adminPool.query(
      'SELECT id FROM candidate WHERE accounting_office_id = $1', [officeId],
    )).rows.map((r: any) => r.id);
  } else {
    const set = new Set<string>();
    for (const m of ms) {
      if (m.candidate_id) set.add(m.candidate_id);
      else if (m.campaign_id) {
        const cs = (await adminPool.query(
          'SELECT id FROM candidate WHERE campaign_id = $1', [m.campaign_id],
        )).rows;
        cs.forEach((r: any) => set.add(r.id));
      }
    }
    candidateIds = [...set];
  }
  return { sub: u.id, name: u.name, role, officeId, candidateIds };
}

export function userToScope(user: AuthUser): Scope {
  return { userId: user.sub, role: user.role, officeId: user.officeId, candidateIds: user.candidateIds };
}

// Hook de autenticação para Fastify (@fastify/jwt já registrado).
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ erro: 'não autenticado' });
  }
}

export function requireRole(req: FastifyRequest, reply: FastifyReply, roles: string[]): boolean {
  const u = req.user as AuthUser;
  if (!roles.includes(u.role)) {
    reply.code(403).send({ erro: 'sem permissão para esta ação', papel: u.role });
    return false;
  }
  return true;
}
