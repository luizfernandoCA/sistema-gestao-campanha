import { adminPool, withScope, type Scope } from '../core/db.js';
import { appendLedger, verifyChain } from '../core/audit.js';

// Teste de isolamento via RLS. Sai com código 1 se qualquer asserção falhar.
let falhas = 0;
function check(nome: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FALHA'} — ${nome}`);
  if (!ok) falhas++;
}

async function main() {
  const q = async (sql: string, p: any[] = []) => (await adminPool.query(sql, p)).rows;
  const office1 = (await q(`SELECT id FROM accounting_office WHERE legal_name LIKE 'Escritório Contábil Alfa'`))[0].id;
  const office2 = (await q(`SELECT id FROM accounting_office WHERE legal_name LIKE 'Escritório Contábil Beta'`))[0].id;
  const candA = (await q(`SELECT id FROM candidate WHERE name = 'Ana Eleitoral'`))[0].id;
  const candB = (await q(`SELECT id FROM candidate WHERE name = 'Bruno Candidato'`))[0].id;
  const candC = (await q(`SELECT id FROM candidate WHERE name = 'Carla Terceiro'`))[0].id;
  const docB = (await q(`SELECT id FROM document_instance WHERE candidate_id = $1 LIMIT 1`, [candB]))[0].id;

  const scopeCoordA: Scope = { userId: 'test', role: 'COORDENADOR_LOCAL', officeId: office1, candidateIds: [candA] };
  const scopeContadorBeta: Scope = { userId: 'test', role: 'CONTADOR', officeId: office2, candidateIds: [candC] };

  // 1) Coord. A só enxerga documentos do candidato A
  await withScope(scopeCoordA, async (c) => {
    const docs = (await c.query('SELECT candidate_id FROM document_instance')).rows;
    check('Coord. A vê apenas documentos do candidato A', docs.length > 0 && docs.every((d: any) => d.candidate_id === candA));
  });

  // 2) Coord. A NÃO acessa um documento do candidato B (RLS retorna 0 linhas)
  await withScope(scopeCoordA, async (c) => {
    const r = (await c.query('SELECT id FROM document_instance WHERE id = $1', [docB])).rows;
    check('Coord. A não acessa documento do candidato B', r.length === 0);
  });

  // 3) Coord. A não enxerga o candidato B na tabela candidate
  await withScope(scopeCoordA, async (c) => {
    // candidate é escopo de escritório; coord A está no office1 (mesmo de B),
    // então VÊ o cadastro de B — o isolamento documental é por candidato.
    // Aqui validamos o isolamento de ESCRITÓRIO: não vê o candidato C (office2).
    const r = (await c.query('SELECT id FROM candidate WHERE id = $1', [candC])).rows;
    check('Coord. A (escritório 1) não acessa candidato C (escritório 2)', r.length === 0);
  });

  // 4) Contador Beta (escritório 2) não acessa workers do escritório 1
  await withScope(scopeContadorBeta, async (c) => {
    const r = (await c.query('SELECT id FROM worker WHERE accounting_office_id = $1', [office1])).rows;
    check('Contador Beta não acessa workers do escritório 1', r.length === 0);
  });

  // 5) Ledger: append no escopo de A e verificação da cadeia
  await withScope(scopeCoordA, async (c) => {
    await appendLedger(c, { candidateId: candA, officeId: office1, resourceType: 'teste', eventType: 'TESTE_ISOLAMENTO', payload: { n: 1 } });
    const v = await verifyChain(c, candA);
    check('Cadeia de auditoria do candidato A íntegra após append', v.ok && v.entries > 0);
  });

  // 6) Ledger é append-only: UPDATE deve falhar (trigger)
  let blocked = false;
  try {
    await adminPool.query('UPDATE audit_ledger_entry SET event_type = $1 WHERE candidate_id = $2', ['HACK', candA]);
  } catch { blocked = true; }
  check('UPDATE no audit_ledger_entry é bloqueado (append-only)', blocked);

  console.log(falhas === 0 ? '\nTODOS OS TESTES DE ISOLAMENTO PASSARAM.' : `\n${falhas} FALHA(S).`);
  await adminPool.end();
  process.exit(falhas === 0 ? 0 : 1);
}
main().catch((e) => { console.error('Erro no teste:', e.message); process.exit(1); });
