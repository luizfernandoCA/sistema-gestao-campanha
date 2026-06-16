import pg from 'pg';
import { hashPassword } from '../core/auth.js';
import { hmac, encField } from '../core/crypto.js';

// Seed de demonstração. Roda como OWNER (bypass RLS).
// Escritório 1 -> candidatos A e B. Escritório 2 -> candidato C.
// Prova de isolamento: A não acessa B; escritório 1 não acessa C.
const adminUrl = process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error('ADMIN_DATABASE_URL ausente');
const SENHA = process.env.DEMO_PASSWORD ?? 'Demo@2026';

async function main() {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`TRUNCATE accounting_office, campaign, candidate, municipality, app_user,
      user_membership, access_scope, worker, worker_assignment, contract_template,
      contract_template_version, document_instance, document_data_snapshot, document_file,
      document_status_history, document_event, audit_ledger_entry, signature_request,
      signature_session, signature, signature_evidence, export_batch, contestation RESTART IDENTITY CASCADE`);

    const office1 = (await c.query(`INSERT INTO accounting_office (legal_name, document_number) VALUES ('Escritório Contábil Alfa','11.111.111/0001-11') RETURNING id`)).rows[0].id;
    const office2 = (await c.query(`INSERT INTO accounting_office (legal_name, document_number) VALUES ('Escritório Contábil Beta','22.222.222/0001-22') RETURNING id`)).rows[0].id;

    const camp1 = (await c.query(`INSERT INTO campaign (accounting_office_id, election_year, election_type, state) VALUES ($1,2026,'MUNICIPAL','SP') RETURNING id`, [office1])).rows[0].id;
    const camp2 = (await c.query(`INSERT INTO campaign (accounting_office_id, election_year, election_type, state) VALUES ($1,2026,'MUNICIPAL','RJ') RETURNING id`, [office2])).rows[0].id;

    const candA = (await c.query(`INSERT INTO candidate (accounting_office_id, campaign_id, name, candidate_number, party) VALUES ($1,$2,'Ana Eleitoral','12345','PARTIDO A') RETURNING id`, [office1, camp1])).rows[0].id;
    const candB = (await c.query(`INSERT INTO candidate (accounting_office_id, campaign_id, name, candidate_number, party) VALUES ($1,$2,'Bruno Candidato','54321','PARTIDO B') RETURNING id`, [office1, camp1])).rows[0].id;
    const candC = (await c.query(`INSERT INTO candidate (accounting_office_id, campaign_id, name, candidate_number, party) VALUES ($1,$2,'Carla Terceiro','99999','PARTIDO C') RETURNING id`, [office2, camp2])).rows[0].id;

    const mun = (await c.query(`INSERT INTO municipality (state, name, ibge_code) VALUES ('SP','São Paulo','3550308') RETURNING id`)).rows[0].id;

    async function user(name: string, email: string, office: string, role: string, candidate: string | null, campaign: string | null) {
      const u = (await c.query(`INSERT INTO app_user (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id`,
        [name, email, hashPassword(SENHA)])).rows[0].id;
      await c.query(`INSERT INTO user_membership (user_id, accounting_office_id, campaign_id, candidate_id, role) VALUES ($1,$2,$3,$4,$5)`,
        [u, office, campaign, candidate, role]);
      return u;
    }
    await user('Contador Alfa', 'contador.alfa@demo', office1, 'CONTADOR', null, null);
    await user('Contador Beta', 'contador.beta@demo', office2, 'CONTADOR', null, null);
    const coordA = await user('Coord. Ana', 'coord.ana@demo', office1, 'COORDENADOR_LOCAL', candA, camp1);
    const coordB = await user('Coord. Bruno', 'coord.bruno@demo', office1, 'COORDENADOR_LOCAL', candB, camp1);
    await user('Admin Ana', 'admin.ana@demo', office1, 'ADMINISTRADOR_CAMPANHA', candA, camp1);
    await user('Suporte', 'suporte@demo', office1, 'SUPORTE_INTERNO', null, null);
    await user('Auditor', 'auditor@demo', office1, 'AUDITOR', null, null);

    // Templates publicados (imutáveis)
    const corpo = '<p>Pelo presente instrumento, a parte contratada presta serviços de apoio à campanha, '
      + 'declarando ciência das condições, valores e da natureza eventual do vínculo, conforme a legislação eleitoral vigente.</p>';
    async function template(office: string) {
      const t = (await c.query(`INSERT INTO contract_template (accounting_office_id, name, status) VALUES ($1,'Contrato Formiguinha','PUBLICADO') RETURNING id`, [office])).rows[0].id;
      const v = (await c.query(`INSERT INTO contract_template_version (template_id, version_number, content_html, content_text_hash, status, published_at) VALUES ($1,1,$2,$3,'PUBLICADO',now()) RETURNING id`,
        [t, corpo, hmac(corpo)])).rows[0].id;
      return v;
    }
    const tvOffice1 = await template(office1);
    await template(office2);

    // Workers + atribuições
    async function worker(office: string, campaign: string, candidate: string, coordUser: string, nome: string, cpf: string) {
      const w = (await c.query(`INSERT INTO worker (accounting_office_id, cpf_hmac, cpf_enc, name_plain, name_enc) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [office, hmac(cpf), encField(cpf), nome, encField(nome)])).rows[0].id;
      const wa = (await c.query(`INSERT INTO worker_assignment (accounting_office_id, campaign_id, candidate_id, municipality_id, coordinator_local_id, worker_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$5) RETURNING id`,
        [office, campaign, candidate, mun, coordUser, w])).rows[0].id;
      return { w, wa };
    }
    const wa1 = await worker(office1, camp1, candA, coordA, 'Maria Apoiadora', '11111111111');
    await worker(office1, camp1, candA, coordA, 'João Voluntário', '22222222222');
    await worker(office1, camp1, candB, coordB, 'Pedro Militante', '33333333333');
    await worker(office2, camp2, candC, coordB, 'Sônia Terceira', '44444444444');

    // Alguns documentos históricos p/ dashboards (sem arquivo; o fluxo vivo gera arquivos reais)
    async function doc(office: string, campaign: string, candidate: string, coordUser: string, workerId: string, status: string) {
      await c.query(`INSERT INTO document_instance (accounting_office_id, campaign_id, candidate_id, municipality_id, coordinator_local_id, worker_id, contract_template_version_id, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$5)`,
        [office, campaign, candidate, mun, coordUser, workerId, tvOffice1, status]);
    }
    await doc(office1, camp1, candA, coordA, wa1.w, 'CONTRATO_GERADO');
    await doc(office1, camp1, candA, coordA, wa1.w, 'AGUARDANDO_ADMINISTRADOR');
    await doc(office1, camp1, candB, coordB, wa1.w, 'CONTRATO_GERADO');

    await c.query('COMMIT');
    console.log('Seed concluído.');
    console.log('--- Logins de demonstração (senha:', SENHA, ') ---');
    console.log('contador.alfa@demo   (CONTADOR, vê candidatos A e B)');
    console.log('coord.ana@demo       (COORDENADOR_LOCAL, candidato A)');
    console.log('coord.bruno@demo     (COORDENADOR_LOCAL, candidato B)');
    console.log('admin.ana@demo       (ADMINISTRADOR_CAMPANHA, candidato A)');
    console.log('contador.beta@demo   (CONTADOR, escritório 2, candidato C)');
    console.log('IDs: A=' + candA + ' B=' + candB + ' C=' + candC + ' atribuicaoA=' + wa1.wa + ' templateV=' + tvOffice1);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error('Falha no seed:', e.message); process.exit(1); });
