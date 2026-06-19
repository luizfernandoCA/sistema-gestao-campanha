-- =====================================================================
-- 004 — Prazos/SLA e limites de papéis por candidato (idempotente).
-- Fundação para: fiscalização do coordenador-geral (detecção de atraso) e
-- as regras de cardinalidade pedidas pelo cliente. Tudo ADITIVO — não altera
-- RLS, criptografia nem o ledger. Pode ser reaplicado com segurança.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Prazos/SLA
--    - Padrão por campanha (em dias, contados da criação da atribuição).
--    - Override explícito por atribuição (data absoluta). NULL = sem prazo.
--    O "atraso" é DERIVADO em consulta (não há status materializado):
--      prazo_efetivo = COALESCE(wa.prazo_assinatura,
--                               wa.created_at + camp.prazo_assinatura_dias)
--      em_atraso = prazo_efetivo < now() AND não existe documento FINALIZADO
--                  para aquela atribuição (worker+candidato).
-- ---------------------------------------------------------------------
ALTER TABLE campaign
  ADD COLUMN IF NOT EXISTS prazo_envio_dias      int,
  ADD COLUMN IF NOT EXISTS prazo_assinatura_dias int;

ALTER TABLE worker_assignment
  ADD COLUMN IF NOT EXISTS prazo_envio      timestamptz,
  ADD COLUMN IF NOT EXISTS prazo_assinatura timestamptz;

-- ---------------------------------------------------------------------
-- 2) Limites de papéis por candidato (cardinalidade garantida no banco)
--    - 1 ADMINISTRADOR_CAMPANHA por candidato
--    - 1 COORDENADOR_GERAL por candidato
--    Índices únicos PARCIAIS: só consideram memberships ATIVOS com candidato.
--    (user_membership não tem RLS — é identidade, gerida pelo pool admin.)
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_por_candidato
  ON user_membership (candidate_id)
  WHERE role = 'ADMINISTRADOR_CAMPANHA' AND status = 'ATIVO' AND candidate_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_coord_geral_por_candidato
  ON user_membership (candidate_id)
  WHERE role = 'COORDENADOR_GERAL' AND status = 'ATIVO' AND candidate_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3) Limite de até 40 COORDENADOR_LOCAL por candidato
--    Não cabe em índice único → trigger de contagem (BEFORE INSERT/UPDATE).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_coord_local_limit() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  IF NEW.role = 'COORDENADOR_LOCAL' AND NEW.status = 'ATIVO' AND NEW.candidate_id IS NOT NULL THEN
    SELECT count(*) INTO n
      FROM user_membership
     WHERE candidate_id = NEW.candidate_id
       AND role = 'COORDENADOR_LOCAL'
       AND status = 'ATIVO'
       AND id <> NEW.id;
    IF n >= 40 THEN
      RAISE EXCEPTION 'limite de 40 coordenadores locais por candidato atingido (candidato %)', NEW.candidate_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_coord_local_limit ON user_membership;
CREATE TRIGGER trg_coord_local_limit BEFORE INSERT OR UPDATE ON user_membership
  FOR EACH ROW EXECUTE FUNCTION enforce_coord_local_limit();
