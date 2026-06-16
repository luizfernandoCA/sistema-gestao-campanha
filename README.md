# Sistema de Gestão Documental de Campanha — Fundação

Fundação **real e deployável** do sistema descrito no pacote de arquitetura (35 microarquiteturas).
Não é o produto completo — é a base executável, segura e auditável, com o fluxo central ponta a ponta.

> Ambiente de **demonstração**, com dados fictícios. Não usar com dados reais sem validação
> jurídica e contábil, conforme a própria arquitetura recomenda.

## O que está implementado

- **Multi-tenant com Row Level Security (RLS)** no PostgreSQL. Dois níveis de isolamento:
  por **escritório** e por **candidato** (candidato A não acessa B no mesmo escritório).
- **Identidade e autorização**: login JWT, papéis (CONTADOR, COORDENADOR_LOCAL,
  ADMINISTRADOR_CAMPANHA etc.), escopo aplicado no banco via `SET LOCAL` + políticas RLS.
- **Hierarquia e formiguinhas**: escritório → campanha → candidato → município → workers.
  Dados pessoais cifrados; CPF com HMAC para deduplicação.
- **Templates versionados e imutáveis** + **geração de documento** com snapshot e PDF.
- **Workflow por máquina de estados** (ações, nunca update livre de status), com trava
  otimista que resolve corrida entre operadores.
- **Assinatura assistida** (coordenador opera, formiguinha assina com aceites + pad de
  assinatura) e **assinatura remota** (link com token guardado só como hash).
- **Evidências** e **cadeia de custódia**: `audit_ledger_entry` append-only com **hash
  encadeado por candidato** e endpoint de verificação. Trigger no banco bloqueia UPDATE/DELETE.
- **Criptografia**: envelope encryption AES-256-GCM (KMS local), storage S3/MinIO **privado**,
  SHA-256 de integridade.
- **Exportação contábil**: dossiê por candidato com manifesto de hashes e ZIP. Documento
  contestado não entra na exportação regular.
- **Dashboards** agregados (consulta única, sem N+1).
- **Frontend** por papel (SPA) servido pelo Caddy com **HTTPS automático**.

## Stack

TypeScript · Node 22 · Fastify · PostgreSQL 16 (RLS) · MinIO (S3) · Caddy · Docker Compose.

## Arquitetura de pastas

```
backend/        API Fastify (core/ + routes/ + scripts/)
db/             001_schema.sql (schema + RLS + ledger append-only)
frontend/       SPA estática (index.html)
deploy/         Caddyfile, cloud-init, deploy.sh, entrypoint.sh
docker-compose.yml
```

## Subir localmente

Pré-requisito: Docker.

```bash
cp .env.example .env   # ajuste os segredos (ou rode deploy/deploy.sh que gera sozinho)
docker compose up -d --build
# Frontend: http://localhost  (ajuste DOMAIN=localhost no .env para testes locais)
```

Na primeira subida, o container aplica o schema e o seed automaticamente (idempotente).

## Logins de demonstração (senha `Demo@2026`)

| E-mail | Papel | Vê |
|---|---|---|
| `contador.alfa@demo` | CONTADOR | candidatos A e B (Escritório Alfa) |
| `coord.ana@demo` | COORDENADOR_LOCAL | candidato A |
| `coord.bruno@demo` | COORDENADOR_LOCAL | candidato B |
| `admin.ana@demo` | ADMINISTRADOR_CAMPANHA | candidato A |
| `contador.beta@demo` | CONTADOR | candidato C (Escritório Beta) |

## Fluxo de ponta a ponta (demonstração)

1. Entre como `coord.ana@demo` → gere um contrato para uma formiguinha.
2. Clique em **Assinar** → confirme os 3 aceites, desenhe a assinatura → evidências e hash são gerados.
3. Entre como `admin.ana@demo` → **Assinar (admin)** → documento **FINALIZADO**.
4. Entre como `contador.alfa@demo` → **Exportar dossiê** do candidato A e **Verificar cadeia** de auditoria.

## Testes

```bash
cd backend
npm run typecheck         # tipos
npm run test:isolation    # prova de isolamento RLS + ledger append-only (precisa do banco)
```

O teste de isolamento confirma: A não vê documentos de B; Escritório 1 não vê o Escritório 2;
a cadeia de auditoria é íntegra; e UPDATE no ledger é bloqueado.

## Deploy em produção (Hetzner + Caddy)

1. Servidor Ubuntu provisionado com `deploy/cloud-init.yaml` (instala Docker).
2. Código enviado para `/opt/app` (rsync).
3. DNS do domínio apontando (registro A) para o IP do servidor.
4. No servidor: `cd /opt/app && DOMAIN=seu.dominio bash deploy/deploy.sh` → Caddy emite o
   certificado TLS automaticamente.

## Limites conscientes desta fundação

Não implementados ainda (das 35 microarquiteturas): exceção em papel/OCR, offline-first,
antifraude completo, notificações reais, retenção/LGPD operacional, backup/DR automatizado,
observabilidade avançada e o restante das telas. A base já carrega os escopos e contratos
necessários para evoluí-las sem retrabalho.
