-- =====================================================================
-- 002 — Endurecimento (idempotente). Aplica WITH CHECK explícito em todas
-- as políticas RLS (bloqueia INSERT/UPDATE gravando escopo de outro
-- candidato/escritório) e trava a imutabilidade de documentos finalizados.
-- Pode ser reaplicado com segurança.
-- =====================================================================

-- Políticas de ESCRITÓRIO com WITH CHECK
DROP POLICY IF EXISTS p_office ON accounting_office;
CREATE POLICY p_office ON accounting_office USING (id = app_office()) WITH CHECK (id = app_office());
DROP POLICY IF EXISTS p_office_camp ON campaign;
CREATE POLICY p_office_camp ON campaign USING (accounting_office_id = app_office()) WITH CHECK (accounting_office_id = app_office());
DROP POLICY IF EXISTS p_office_cand ON candidate;
CREATE POLICY p_office_cand ON candidate USING (accounting_office_id = app_office()) WITH CHECK (accounting_office_id = app_office());
DROP POLICY IF EXISTS p_office_worker ON worker;
CREATE POLICY p_office_worker ON worker USING (accounting_office_id = app_office()) WITH CHECK (accounting_office_id = app_office());
DROP POLICY IF EXISTS p_office_wa ON worker_assignment;
CREATE POLICY p_office_wa ON worker_assignment USING (accounting_office_id = app_office()) WITH CHECK (accounting_office_id = app_office());
DROP POLICY IF EXISTS p_office_tpl ON contract_template;
CREATE POLICY p_office_tpl ON contract_template USING (accounting_office_id = app_office()) WITH CHECK (accounting_office_id = app_office());

-- Políticas de CANDIDATO com WITH CHECK
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_instance','document_data_snapshot','document_file',
                           'document_status_history','document_event','audit_ledger_entry',
                           'signature_request','signature_session','signature','signature_evidence',
                           'export_batch','contestation'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS p_cand ON %I', t);
    EXECUTE format('CREATE POLICY p_cand ON %I USING (candidate_id = ANY(app_candidate_ids())) WITH CHECK (candidate_id = ANY(app_candidate_ids()))', t);
  END LOOP;
END$$;

-- Imutabilidade: documento FINALIZADO/CANCELADO não recebe novos arquivos.
CREATE OR REPLACE FUNCTION block_finalized_doc_file() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM document_instance WHERE id = NEW.document_id;
  IF st IN ('FINALIZADO','CANCELADO') THEN
    RAISE EXCEPTION 'documento % está % e não aceita novos arquivos (imutável)', NEW.document_id, st;
  END IF;
  RETURN NEW;
END;$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_block_finalized ON document_file;
CREATE TRIGGER trg_block_finalized BEFORE INSERT OR UPDATE ON document_file
  FOR EACH ROW EXECUTE FUNCTION block_finalized_doc_file();

-- Princípio do menor privilégio: app_rw não precisa de UPDATE em tabelas
-- puramente append (eventos/histórico/evidências/snapshot).
REVOKE UPDATE ON document_event, document_status_history, signature_evidence,
  document_data_snapshot FROM app_rw;
