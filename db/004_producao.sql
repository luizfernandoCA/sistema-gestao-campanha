-- =====================================================================
-- Migration 004 — Produção: tabelas auxiliares de entrega, índices
-- recomendados (modelo de dados de referência), RLS no novo, e
-- gatilho reforçado de imutabilidade do audit_ledger_entry.
-- =====================================================================

-- Tentativas de entrega de notificação (multi-provedor: Twilio, Resend, SendGrid).
-- Permite rastrear retries, status do provedor e erro sem expor o destino.
CREATE TABLE IF NOT EXISTS notification_delivery_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
  status text NOT NULL,            -- 'enviado' | 'falha' | 'mock'
  provider_id text,                -- Twilio Message SID / Resend id / SendGrid x-message-id
  error text,                      -- mensagem curta de erro (sem stack)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nda_notif ON notification_delivery_attempt(notification_id, created_at);

-- RLS por notification.candidate_id (herdada via JOIN, mas exposta diretamente).
ALTER TABLE notification_delivery_attempt ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_nda ON notification_delivery_attempt;
CREATE POLICY p_nda ON notification_delivery_attempt
  USING (notification_id IN (SELECT id FROM notification))
  WITH CHECK (notification_id IN (SELECT id FROM notification));

-- ---------------------------------------------------------------------
-- Índices recomendados pelo modelo de dados de referência (07).
-- IF NOT EXISTS para idempotência em migrações repetidas.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_document_candidate_status
  ON document_instance(candidate_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_document_local_dashboard
  ON document_instance(candidate_id, municipality_id, coordinator_local_id, status);

CREATE INDEX IF NOT EXISTS idx_worker_assignment_scope
  ON worker_assignment(candidate_id, municipality_id, coordinator_local_id, status);

CREATE INDEX IF NOT EXISTS idx_document_events_document
  ON document_event(document_id, created_at);

CREATE INDEX IF NOT EXISTS idx_export_batch_candidate
  ON export_batch(candidate_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_ledger_candidate
  ON audit_ledger_entry(candidate_id, id);

-- ---------------------------------------------------------------------
-- Gatilho reforçado: BLOQUEIA INSERT que tente forjar previous_entry_hash
-- diferente do tail atual da cadeia (defense-in-depth contra app comprometido).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_ledger_chain() RETURNS trigger AS $$
DECLARE expected text;
BEGIN
  SELECT entry_hash INTO expected
    FROM audit_ledger_entry
   WHERE candidate_id = NEW.candidate_id
   ORDER BY id DESC LIMIT 1;
  IF expected IS NULL THEN
    -- Primeira entrada do candidato: previous DEVE ser o genesis (64 zeros).
    IF NEW.previous_entry_hash <> repeat('0', 64) THEN
      RAISE EXCEPTION 'previous_entry_hash deve ser genesis para a primeira entrada do candidato';
    END IF;
  ELSE
    IF NEW.previous_entry_hash <> expected THEN
      RAISE EXCEPTION 'previous_entry_hash não corresponde ao tail da cadeia (race ou fraude)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_chain_insert ON audit_ledger_entry;
CREATE TRIGGER trg_audit_chain_insert
  BEFORE INSERT ON audit_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION enforce_ledger_chain();

-- ---------------------------------------------------------------------
-- Privilégios para o papel de aplicação nas tabelas novas (idempotente).
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
