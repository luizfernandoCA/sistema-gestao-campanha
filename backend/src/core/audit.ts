import type { PoolClient } from 'pg';
import { sha256 } from './crypto.js';

// Ledger append-only com hash encadeado POR CANDIDATO.
// Cada entrada: entry_hash = sha256(previous_entry_hash + payload_hash + meta).
// O trigger no banco impede UPDATE/DELETE — não existe edição silenciosa.

const GENESIS = '0'.repeat(64);

export interface LedgerInput {
  candidateId: string;
  officeId: string;
  resourceType: string;
  resourceId?: string;
  eventType: string;
  actorUserId?: string;
  actorRole?: string;
  payload?: unknown;
}

export async function appendLedger(c: PoolClient, e: LedgerInput): Promise<string> {
  const payloadHash = sha256(JSON.stringify(e.payload ?? {}));
  const prev = await c.query(
    'SELECT entry_hash FROM audit_ledger_entry WHERE candidate_id = $1 ORDER BY id DESC LIMIT 1',
    [e.candidateId],
  );
  const previousHash: string = prev.rows[0]?.entry_hash ?? GENESIS;
  const ts = new Date().toISOString();
  const entryHash = sha256(
    [previousHash, payloadHash, e.candidateId, e.resourceType, e.resourceId ?? '', e.eventType, ts].join('|'),
  );
  await c.query(
    `INSERT INTO audit_ledger_entry
      (candidate_id, accounting_office_id, resource_type, resource_id, event_type,
       actor_user_id, actor_role, payload_hash, previous_entry_hash, entry_hash, server_timestamp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [e.candidateId, e.officeId, e.resourceType, e.resourceId ?? null, e.eventType,
     e.actorUserId ?? null, e.actorRole ?? null, payloadHash, previousHash, entryHash, ts],
  );
  return entryHash;
}

// Recalcula a cadeia e confirma integridade.
export async function verifyChain(c: PoolClient, candidateId: string): Promise<{ ok: boolean; entries: number; brokenAt?: number }> {
  const rows = (await c.query(
    `SELECT id, candidate_id, resource_type, resource_id, event_type, payload_hash,
            previous_entry_hash, entry_hash, server_timestamp
       FROM audit_ledger_entry WHERE candidate_id = $1 ORDER BY id ASC`,
    [candidateId],
  )).rows;
  let prev = GENESIS;
  for (const r of rows) {
    const ts = new Date(r.server_timestamp).toISOString();
    const expected = sha256(
      [prev, r.payload_hash, r.candidate_id, r.resource_type, r.resource_id ?? '', r.event_type, ts].join('|'),
    );
    if (r.previous_entry_hash !== prev || r.entry_hash !== expected) {
      return { ok: false, entries: rows.length, brokenAt: Number(r.id) };
    }
    prev = r.entry_hash;
  }
  return { ok: true, entries: rows.length };
}
