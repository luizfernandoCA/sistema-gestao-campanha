-- =====================================================================
-- 003 — Tabelas das microarquiteturas restantes (importação, reemissão,
-- notificações, papel, offline, antifraude, IA/OCR, LGPD, suporte,
-- incidente, backup, auditoria externa, idempotência/observabilidade).
-- Toda tabela carrega accounting_office_id; as documentais carregam candidate_id.
-- RLS: candidato (isolamento A x B) ou escritório, com USING + WITH CHECK.
-- =====================================================================

-- Idempotência (interno; sem RLS) — POSTs críticos não duplicam efeito.
CREATE TABLE IF NOT EXISTS idempotency_record (
  key         text PRIMARY KEY,
  user_id     uuid,
  response_json jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Importação em massa
CREATE TABLE IF NOT EXISTS bulk_import_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PREVIA', total int NOT NULL DEFAULT 0,
  inserted int NOT NULL DEFAULT 0, duplicates int NOT NULL DEFAULT 0,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS bulk_import_row (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES bulk_import_batch(id),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  cpf_hmac text, name_plain text, status text NOT NULL DEFAULT 'NOVO', error text);

-- Reemissão
CREATE TABLE IF NOT EXISTS document_reissue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  original_document_id uuid NOT NULL, new_document_id uuid NOT NULL,
  reissue_group_id uuid NOT NULL, reason text, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now());

-- Notificações (mock, idempotentes)
CREATE TABLE IF NOT EXISTS notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  channel text NOT NULL, destination_masked text, template_key text,
  status text NOT NULL DEFAULT 'ENVIADA', idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now());

-- Exceção em papel
CREATE TABLE IF NOT EXISTS paper_exception_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  document_id uuid NOT NULL, justification text, qr_token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'SOLICITADO', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS paper_scan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  paper_exception_case_id uuid NOT NULL REFERENCES paper_exception_case(id),
  ocr_text text, ocr_confidence numeric, status text NOT NULL DEFAULT 'RECEBIDO',
  created_at timestamptz NOT NULL DEFAULT now());

-- Offline-first
CREATE TABLE IF NOT EXISTS offline_package (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  coordinator_local_id uuid, payload_enc text NOT NULL, item_count int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'ABERTO',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS offline_sync_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  package_id uuid NOT NULL, status text NOT NULL, detail text,
  created_at timestamptz NOT NULL DEFAULT now());

-- Antifraude
CREATE TABLE IF NOT EXISTS fraud_signal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  document_id uuid, signal_type text NOT NULL, severity text NOT NULL DEFAULT 'BAIXA',
  detail text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS fraud_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ABERTO', severity text NOT NULL DEFAULT 'BAIXA',
  summary text, created_at timestamptz NOT NULL DEFAULT now());

-- IA/OCR
CREATE TABLE IF NOT EXISTS ai_ocr_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  document_id uuid, status text NOT NULL DEFAULT 'CONCLUIDO',
  result_json jsonb, divergence boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());

-- LGPD / privacidade (escopo de escritório)
CREATE TABLE IF NOT EXISTS data_subject_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, subject_ref text, request_type text NOT NULL,
  status text NOT NULL DEFAULT 'RECEBIDO', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS consent_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, worker_id uuid, consent_type text NOT NULL,
  granted boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS privacy_notice_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, version int NOT NULL, content text,
  published_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS retention_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, name text NOT NULL, retention_days int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS legal_hold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL, reason text,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS disposal_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'SOLICITADO', blocked_by_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());

-- Suporte seguro
CREATE TABLE IF NOT EXISTS support_ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, subject text, status text NOT NULL DEFAULT 'ABERTO',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS support_access_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  requester_user_id uuid, reason text, status text NOT NULL DEFAULT 'PENDENTE',
  approved_by uuid, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS support_access_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  request_id uuid NOT NULL, status text NOT NULL DEFAULT 'ATIVA',
  started_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS support_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, session_id uuid NOT NULL, action text,
  created_at timestamptz NOT NULL DEFAULT now());

-- Incidente
CREATE TABLE IF NOT EXISTS security_incident (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, severity text NOT NULL DEFAULT 'MEDIA',
  summary text, status text NOT NULL DEFAULT 'ABERTO', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS incident_timeline_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, incident_id uuid NOT NULL REFERENCES security_incident(id),
  description text, created_at timestamptz NOT NULL DEFAULT now());

-- Backup / DR
CREATE TABLE IF NOT EXISTS backup_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, status text NOT NULL DEFAULT 'CONCLUIDO',
  location text, size_bytes bigint, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS restore_test (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, backup_job_id uuid, status text NOT NULL DEFAULT 'OK',
  created_at timestamptz NOT NULL DEFAULT now());

-- Auditoria externa
CREATE TABLE IF NOT EXISTS external_audit_package (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid NOT NULL,
  manifest_json jsonb, manifest_hash text, status text NOT NULL DEFAULT 'GERADO',
  created_at timestamptz NOT NULL DEFAULT now());

-- Observabilidade
CREATE TABLE IF NOT EXISTS security_log_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, candidate_id uuid, event_type text NOT NULL,
  actor_user_id uuid, actor_role text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS metric_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_office_id uuid NOT NULL, metric_key text NOT NULL, metric_value numeric,
  created_at timestamptz NOT NULL DEFAULT now());

-- ---------------------------------------------------------------------
-- RLS: candidato (USING + WITH CHECK)
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bulk_import_batch','bulk_import_row','document_reissue','notification',
    'paper_exception_case','paper_scan','offline_package','offline_sync_event','fraud_signal',
    'fraud_case','ai_ocr_job','legal_hold','disposal_job','support_access_request',
    'support_access_session','external_audit_package'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_cand ON %I', t);
    EXECUTE format('CREATE POLICY p_cand ON %I USING (candidate_id = ANY(app_candidate_ids())) WITH CHECK (candidate_id = ANY(app_candidate_ids()))', t);
  END LOOP;
END$$;

-- RLS: escritório (USING + WITH CHECK)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['data_subject_request','consent_record','privacy_notice_version',
    'retention_policy','support_ticket','support_action_log','security_incident',
    'incident_timeline_event','backup_job','restore_test','security_log_event','metric_snapshot'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_office ON %I', t);
    EXECUTE format('CREATE POLICY p_office ON %I USING (accounting_office_id = app_office()) WITH CHECK (accounting_office_id = app_office())', t);
  END LOOP;
END$$;

-- Privilégios para o papel de aplicação nas novas tabelas
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;

CREATE INDEX IF NOT EXISTS idx_fraud_case_cand ON fraud_case(candidate_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_notification_cand ON notification(candidate_id, created_at);

-- Token de assinatura remota deve ser único (evita colisão/duplicidade).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_sr_token') THEN
    ALTER TABLE signature_request ADD CONSTRAINT uq_sr_token UNIQUE (token_hash);
  END IF;
END$$;
