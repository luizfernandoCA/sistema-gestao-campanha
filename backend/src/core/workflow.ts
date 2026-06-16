import type { PoolClient } from 'pg';
import { appendLedger } from './audit.js';
import type { AuthUser } from './auth.js';

// Transições comandadas por AÇÃO (nunca por update livre de status).
export type Estado =
  | 'CONTRATO_GERADO' | 'ENVIADO_PARA_ASSINATURA' | 'EM_ASSINATURA_ASSISTIDA'
  | 'VISUALIZADO_PELA_FORMIGUINHA' | 'ACEITE_REGISTRADO' | 'ASSINADO_PELA_FORMIGUINHA'
  | 'AGUARDANDO_ADMINISTRADOR' | 'ASSINADO_PELO_ADMINISTRADOR' | 'FINALIZADO'
  | 'CANCELADO' | 'CONTESTADO' | 'REEMITIDO';

export class WorkflowConflict extends Error {
  constructor(msg: string) { super(msg); this.name = 'WorkflowConflict'; }
}

// Atualiza o status com trava otimista: só transita se o estado atual estiver
// entre os esperados. Em corrida (dois operadores), apenas um vence; o outro
// recebe erro controlado. Registra histórico, evento e entrada no ledger.
export async function transition(
  c: PoolClient,
  doc: { id: string; candidateId: string; officeId: string },
  fromExpected: Estado[],
  to: Estado,
  user: AuthUser,
  eventType: string,
  payload?: unknown,
): Promise<void> {
  const upd = await c.query(
    `UPDATE document_instance SET status = $1
       WHERE id = $2 AND status = ANY($3::text[])
     RETURNING status`,
    [to, doc.id, fromExpected],
  );
  if (upd.rowCount === 0) {
    const cur = (await c.query('SELECT status FROM document_instance WHERE id = $1', [doc.id])).rows[0];
    throw new WorkflowConflict(
      `transição inválida para ${to}: estado atual é ${cur?.status ?? 'inexistente'}`,
    );
  }
  await c.query(
    `INSERT INTO document_status_history (document_id, candidate_id, from_status, to_status, actor_user_id, actor_role)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [doc.id, doc.candidateId, fromExpected.join('|'), to, user.sub, user.role],
  );
  await c.query(
    `INSERT INTO document_event (document_id, candidate_id, event_type, actor_user_id, actor_role, payload_json)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [doc.id, doc.candidateId, eventType, user.sub, user.role, payload ? JSON.stringify(payload) : null],
  );
  await appendLedger(c, {
    candidateId: doc.candidateId, officeId: doc.officeId,
    resourceType: 'document', resourceId: doc.id, eventType,
    actorUserId: user.sub, actorRole: user.role, payload: { to },
  });
}
