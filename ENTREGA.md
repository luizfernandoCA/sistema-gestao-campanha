# Entrega — Sistema de Gestão Documental de Campanha (35 microarquiteturas)

## No ar
- **URL:** https://escritorio.e-negociosinteligentes.com.br (HTTPS automático)
- **API/contrato:** https://escritorio.e-negociosinteligentes.com.br/api/openapi.json
- **Ambiente:** demonstração, dados fictícios (seed). Não usar com dados reais sem validação jurídica/contábil.

## Acessos de demonstração (senha `Demo@2026`)
| E-mail | Papel |
|---|---|
| `contador.alfa@demo` | Contador (vê candidatos A e B) |
| `coord.ana@demo` | Coordenador local (candidato A) |
| `coord.bruno@demo` | Coordenador local (candidato B) |
| `admin.ana@demo` | Administrador de campanha (candidato A) |
| `suporte@demo` | Suporte interno |
| `auditor@demo` | Auditor |
| `contador.beta@demo` | Contador (escritório 2, candidato C) |

Dica: muitas operações avançadas (antifraude, auditoria externa, backup) exigem papel Contador/Auditor — entre como `contador.alfa@demo` para testá-las no painel "Operações avançadas".

## As 35 microarquiteturas — todas implementadas e no ar
Multi-tenant · permissões (RBAC+RLS) · identidade/JWT · hierarquia · templates versionados · geração de documentos · workflow (FSM) · assinatura assistida · assinatura remota (link+OTP) · exceção em papel (QR/scan/OCR mock/revisão) · evidências · cadeia de custódia (ledger append-only) · criptografia (envelope AES-256-GCM) · chaves (KMS local) · armazenamento (S3/MinIO privado) · exportação contábil (dossiê+manifesto+ZIP) · dashboards · notificações (idempotentes) · offline-first (pacote cifrado + sync) · antifraude (sinais/casos) · IA/OCR (extração+divergência) · privacidade/LGPD (DSR, consentimento, retenção, legal hold que bloqueia descarte) · suporte seguro (acesso just-in-time com aprovação) · observabilidade (métricas/readiness/security log) · resposta a incidente (timeline) · backup/DR (`deploy/backup.sh` com teste de restore) · performance (agregações sem N+1) · auditoria externa (pacote com hash de manifesto) · APIs (OpenAPI, idempotência, rate limit) · DevSecOps (CI em `.github/workflows`) · testes de isolamento · retenção documental · contestação · reemissão · importação em massa (prévia+commit, dedup por HMAC).

## Verificações ao vivo (em produção)
- Isolamento RLS (escritório e candidato) + ledger append-only: **verde**.
- Fluxo completo: gerar → assinar assistida/remota → admin → finalizar → exportar → verificar cadeia.
- Importação idempotente; reemissão; notificação idempotente; papel (QR errado=422); offline sync; LGPD legal-hold **bloqueia** descarte; suporte sem aprovação=403 e com aprovação=200; auditoria externa com hash; OTP com limite de tentativas.
- Duas rodadas de **auditoria hostil (onda-verifier)**. Achados bloqueantes da 1ª (RLS WITH CHECK, IDOR de exportação, imutabilidade pós-assinatura) e ressalvas da 2ª (idempotência escopada por usuário, `requireRole` faltante, UNIQUE de token, trava de OTP) — **todos corrigidos e revalidados**.

## Infraestrutura
- **Hetzner** projeto "campanha-documental", servidor **cx33** (= CX32: 4 vCPU/8 GB), Nuremberg, **IP 46.224.193.105** (~€7–8/mês).
- **Hostinger** registro A `escritorio` → IP.
- **Stack:** PostgreSQL 16 (RLS) · MinIO · API Fastify/TS · Caddy (HTTPS). Código em `/opt/app`; segredos em `/opt/app/.env`.

## Limites honestos (profundidade)
Cada uma das 35 áreas existe e funciona, em profundidade pragmática de demonstração. Continuam exigindo serviços/credenciais externos reais (e por isso usam adaptador mock): KMS/HSM de hardware, gateways reais de SMS/WhatsApp, motor de OCR/IA de produção, e-mail real, e alta disponibilidade multi-nó. A base já carrega contratos e escopos para promover cada mock a integração real sem retrabalho.

## Gestão
- Backup/DR manual: `cd /opt/app && bash deploy/backup.sh` (gera dump + teste de restore).
- Atualizar: rsync para `/opt/app` + `docker compose up -d --build`.
- Custos/segurança: desligar o servidor cx33 e revogar o token de API "deploy-campanha" no console Hetzner quando não for mais usar.
