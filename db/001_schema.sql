-- =====================================================================
-- Sistema de Gestão Documental de Campanha — Schema da Fundação
-- PostgreSQL 16 · Row Level Security · Audit Ledger append-only
-- Comentários em pt-BR. Conceitos preservados do modelo de dados de referência.
-- =====================================================================
-- Convenção de papéis de banco:
--   - O owner (postgres) roda migrations e seed e BYPASSA o RLS.
--   - A aplicação conecta como papel "app_rw" (NÃO-owner) e o RLS é aplicado.
-- A aplicação define, por requisição (SET LOCAL):
--   app.office_id        -> escritório contábil em escopo
--   app.candidate_ids    -> CSV de candidate_id que o usuário pode acessar
--   app.user_id, app.role
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Papel de aplicação (sem BYPASSRLS). Senha definida no deploy via ALTER ROLE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN PASSWORD 'troque_no_deploy';
  END IF;
END$$;

-- ---------------------------------------------------------------------
-- 1) Tenancy: escritório, campanha, candidato, município
-- ---------------------------------------------------------------------
CREATE TABLE accounting_office (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name    text NOT NULL,
  document_number text NOT NULL,
  status        text NOT NULL DEFAULT 'ATIVO',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL REFERENCES accounting_office(id),
  election_year       int  NOT NULL,
  election_type       text NOT NULL,
  state               text NOT NULL,
  status              text NOT NULL DEFAULT 'ATIVA',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidate (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL REFERENCES accounting_office(id),
  campaign_id         uuid NOT NULL REFERENCES campaign(id),
  name                text NOT NULL,
  candidate_number    text,
  party               text,
  status              text NOT NULL DEFAULT 'ATIVO',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE municipality (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state     text NOT NULL,
  name      text NOT NULL,
  ibge_code text
);

-- ---------------------------------------------------------------------
-- 2) Identidade, papéis e permissões
-- ---------------------------------------------------------------------
CREATE TABLE app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  email          text NOT NULL UNIQUE,
  cpf_hmac       text,
  password_hash  text NOT NULL,
  status         text NOT NULL DEFAULT 'ATIVO',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Papéis: CONTADOR, JURIDICO, ADMINISTRADOR_CAMPANHA, COORDENADOR_GERAL,
--         COORDENADOR_LOCAL, FORMIGUINHA, SUPORTE_INTERNO, AUDITOR
CREATE TABLE user_membership (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES app_user(id),
  accounting_office_id uuid NOT NULL REFERENCES accounting_office(id),
  campaign_id          uuid REFERENCES campaign(id),
  candidate_id         uuid REFERENCES candidate(id),
  role                 text NOT NULL,
  status               text NOT NULL DEFAULT 'ATIVO',
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Escopo fino de coordenador local (município)
CREATE TABLE access_scope (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_membership_id uuid NOT NULL REFERENCES user_membership(id),
  municipality_id    uuid REFERENCES municipality(id),
  starts_at          timestamptz,
  ends_at            timestamptz
);

-- ---------------------------------------------------------------------
-- 3) Formiguinhas (workers) — dados pessoais cifrados; HMAC p/ dedup
-- ---------------------------------------------------------------------
CREATE TABLE worker (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL REFERENCES accounting_office(id),
  cpf_hmac             text NOT NULL,
  cpf_enc              text,         -- ciphertext (envelope) — demo
  name_enc             text,
  name_plain           text,         -- apenas demo p/ exibição; em produção, cifrado
  phone_enc            text,
  email_enc            text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (accounting_office_id, cpf_hmac)
);

CREATE TABLE worker_assignment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL REFERENCES accounting_office(id),
  campaign_id          uuid NOT NULL REFERENCES campaign(id),
  candidate_id         uuid NOT NULL REFERENCES candidate(id),
  municipality_id      uuid REFERENCES municipality(id),
  coordinator_local_id uuid REFERENCES app_user(id),
  worker_id            uuid NOT NULL REFERENCES worker(id),
  status               text NOT NULL DEFAULT 'ATIVO',
  created_by           uuid REFERENCES app_user(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 4) Templates e documentos
-- ---------------------------------------------------------------------
CREATE TABLE contract_template (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL REFERENCES accounting_office(id),
  name                 text NOT NULL,
  status               text NOT NULL DEFAULT 'RASCUNHO',
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contract_template_version (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id         uuid NOT NULL REFERENCES contract_template(id),
  version_number      int  NOT NULL,
  content_html        text NOT NULL,
  content_text_hash   text NOT NULL,
  status              text NOT NULL DEFAULT 'PUBLICADO', -- imutável após publicar
  approved_by_legal_id uuid REFERENCES app_user(id),
  published_at        timestamptz,
  UNIQUE (template_id, version_number)
);

CREATE TABLE document_instance (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id        uuid NOT NULL REFERENCES accounting_office(id),
  campaign_id                 uuid NOT NULL REFERENCES campaign(id),
  candidate_id                uuid NOT NULL REFERENCES candidate(id),
  municipality_id             uuid REFERENCES municipality(id),
  coordinator_local_id        uuid REFERENCES app_user(id),
  worker_id                   uuid NOT NULL REFERENCES worker(id),
  contract_template_version_id uuid NOT NULL REFERENCES contract_template_version(id),
  status                      text NOT NULL DEFAULT 'CONTRATO_GERADO',
  current_file_id             uuid,
  previous_document_id        uuid REFERENCES document_instance(id),
  reissue_group_id            uuid,
  version                     int NOT NULL DEFAULT 1,
  created_by                  uuid REFERENCES app_user(id),
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_data_snapshot (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES document_instance(id),
  candidate_id  uuid NOT NULL REFERENCES candidate(id),
  snapshot_json jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_file (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       uuid NOT NULL REFERENCES document_instance(id),
  candidate_id      uuid NOT NULL REFERENCES candidate(id),
  file_type         text NOT NULL,   -- PDF_CONTRATO, ASSINATURA_IMG, EVIDENCIA
  file_role         text,
  storage_bucket    text NOT NULL,
  storage_key       text NOT NULL,
  version           int NOT NULL DEFAULT 1,
  mime_type         text,
  size_bytes        bigint,
  sha256_hash       text NOT NULL,
  encryption_key_id text NOT NULL,
  encrypted_data_key text NOT NULL,
  status            text NOT NULL DEFAULT 'ATIVO',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5) Workflow, eventos e auditoria
-- ---------------------------------------------------------------------
CREATE TABLE document_status_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES document_instance(id),
  candidate_id uuid NOT NULL REFERENCES candidate(id),
  from_status  text,
  to_status    text NOT NULL,
  actor_user_id uuid REFERENCES app_user(id),
  actor_role   text,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES document_instance(id),
  candidate_id uuid NOT NULL REFERENCES candidate(id),
  event_type   text NOT NULL,
  actor_user_id uuid REFERENCES app_user(id),
  actor_role   text,
  payload_json jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Ledger append-only com hash encadeado por candidato
CREATE TABLE audit_ledger_entry (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id       uuid NOT NULL REFERENCES candidate(id),
  accounting_office_id uuid NOT NULL REFERENCES accounting_office(id),
  resource_type      text NOT NULL,
  resource_id        text,
  event_type         text NOT NULL,
  actor_user_id      uuid,
  actor_role         text,
  payload_hash       text NOT NULL,
  previous_entry_hash text NOT NULL,
  entry_hash         text NOT NULL,
  server_timestamp   timestamptz NOT NULL DEFAULT now()
);

-- Bloqueia UPDATE/DELETE no ledger (append-only de verdade)
CREATE OR REPLACE FUNCTION audit_ledger_block() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_ledger_entry é append-only: % proibido', TG_OP;
END;$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION audit_ledger_block();
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION audit_ledger_block();

-- ---------------------------------------------------------------------
-- 6) Assinaturas e evidências
-- ---------------------------------------------------------------------
CREATE TABLE signature_request (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES document_instance(id),
  candidate_id  uuid NOT NULL REFERENCES candidate(id),
  worker_id     uuid NOT NULL REFERENCES worker(id),
  request_type  text NOT NULL,            -- REMOTA
  delivery_channel text,
  destination_masked text,
  token_hash    text NOT NULL,            -- apenas hash do token
  expires_at    timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'PENDENTE',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE signature_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES document_instance(id),
  candidate_id  uuid NOT NULL REFERENCES candidate(id),
  worker_id     uuid NOT NULL REFERENCES worker(id),
  session_type  text NOT NULL,            -- ASSISTIDA | REMOTA
  status        text NOT NULL DEFAULT 'ABERTA',
  started_by_user_id uuid REFERENCES app_user(id),
  device_id     text,
  ip_hash       text,
  user_agent    text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  UNIQUE (document_id, status) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE signature (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES document_instance(id),
  candidate_id        uuid NOT NULL REFERENCES candidate(id),
  signer_type         text NOT NULL,      -- FORMIGUINHA | ADMINISTRADOR
  signer_id           uuid,
  signature_type      text NOT NULL,      -- ELETRONICA_EVIDENCIADA
  signature_image_file_id uuid,
  document_hash_before text,
  document_hash_after  text,
  signed_at           timestamptz NOT NULL DEFAULT now(),
  status              text NOT NULL DEFAULT 'VALIDA',
  UNIQUE (document_id, signer_type)
);

CREATE TABLE signature_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_id  uuid NOT NULL REFERENCES signature(id),
  document_id   uuid NOT NULL REFERENCES document_instance(id),
  candidate_id  uuid NOT NULL REFERENCES candidate(id),
  signer_type   text NOT NULL,
  operator_user_id uuid REFERENCES app_user(id),
  device_id     text,
  ip_hash       text,
  user_agent    text,
  acceptance_hash text NOT NULL,
  document_hash_before text,
  document_hash_after  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 7) Exportação contábil e contestação
-- ---------------------------------------------------------------------
CREATE TABLE export_batch (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid NOT NULL REFERENCES candidate(id),
  accounting_office_id uuid NOT NULL REFERENCES accounting_office(id),
  status        text NOT NULL DEFAULT 'GERADO',
  manifest_json jsonb,
  manifest_hash text,
  document_count int NOT NULL DEFAULT 0,
  created_by     uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contestation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES document_instance(id),
  candidate_id  uuid NOT NULL REFERENCES candidate(id),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'ABERTA',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Índices recomendados
-- ---------------------------------------------------------------------
CREATE INDEX idx_document_candidate_status ON document_instance(candidate_id, status, created_at);
CREATE INDEX idx_worker_assignment_scope ON worker_assignment(candidate_id, municipality_id, coordinator_local_id, status);
CREATE INDEX idx_document_events_document ON document_event(document_id, created_at);
CREATE INDEX idx_audit_candidate ON audit_ledger_entry(candidate_id, id);
CREATE INDEX idx_export_candidate ON export_batch(candidate_id, status, created_at);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
-- Helpers de escopo
CREATE OR REPLACE FUNCTION app_office() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.office_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_candidate_ids() RETURNS uuid[] AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('app.candidate_ids', true), '') = '' THEN ARRAY[]::uuid[]
    ELSE string_to_array(current_setting('app.candidate_ids', true), ',')::uuid[]
  END
$$ LANGUAGE sql STABLE;

-- Tabelas com escopo de ESCRITÓRIO (isolamento entre escritórios)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounting_office','campaign','candidate','worker',
                           'worker_assignment','contract_template'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END$$;

CREATE POLICY p_office ON accounting_office USING (id = app_office());
CREATE POLICY p_office_camp ON campaign USING (accounting_office_id = app_office());
CREATE POLICY p_office_cand ON candidate USING (accounting_office_id = app_office());
CREATE POLICY p_office_worker ON worker USING (accounting_office_id = app_office());
CREATE POLICY p_office_wa ON worker_assignment USING (accounting_office_id = app_office());
CREATE POLICY p_office_tpl ON contract_template USING (accounting_office_id = app_office());

-- Tabelas com escopo de CANDIDATO (isolamento A x B dentro do mesmo escritório)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_instance','document_data_snapshot','document_file',
                           'document_status_history','document_event','audit_ledger_entry',
                           'signature_request','signature_session','signature','signature_evidence',
                           'export_batch','contestation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY p_cand ON %I USING (candidate_id = ANY(app_candidate_ids()))', t);
  END LOOP;
END$$;

-- Permissões do papel de aplicação (RLS continua valendo por ser não-owner)
GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_rw;
-- DELETE só onde faz sentido (nunca no ledger). Não concedemos DELETE global.
