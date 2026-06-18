# Sistema de Gestão Documental de Campanha — v2

Plataforma de **cadeia de custódia documental** para escritórios de contabilidade
eleitoral. Refatoração v2: backend Fastify endurecido + adapters de produção
(Anthropic, Twilio, Resend/SendGrid, ClickSign/D4Sign) + frontend Next.js 14
com design Apple-like, motion e scroll animations.

> Não é um sistema de PDFs. É uma plataforma de **evidência eleitoral**, assinatura
> assistida, cadeia de custódia imutável e dossiê contábil verificável.

## Princípio

```text
Toda assinatura tem aceite + hash + operador + dispositivo + timestamp do servidor.
Toda ação relevante entra no audit_ledger_entry (append-only, hash encadeado).
Toda tabela sensível carrega accounting_office_id + candidate_id + RLS.
Documento assinado nunca é editado — correção é reemissão.
```

## Stack

```text
Backend:  TypeScript · Node 22 · Fastify · PostgreSQL 16 (RLS) · MinIO/S3 · BullMQ-ready
Frontend: Next.js 14 (App Router) · Tailwind · Framer Motion · GSAP ScrollTrigger
Infra:    Docker Compose · Caddy 2 (HTTPS automático) · Hetzner CX32
Adapters: Anthropic Claude (IA/OCR) · Twilio (SMS/WhatsApp/OTP)
          Resend ou SendGrid (e-mail) · ClickSign ou D4Sign (assinatura ICP-Brasil)
```

## As 35 microarquiteturas implementadas

Multi-tenant · permissões (RBAC+ABAC+ReBAC) · identidade JWT · hierarquia · templates
versionados · geração de documentos · workflow FSM · assinatura assistida · assinatura
remota (OTP via Twilio) · exceção em papel (QR/scan) · evidências · cadeia de custódia
(ledger append-only com gatilho de imutabilidade) · criptografia envelope AES-256-GCM ·
chaves (KMS local) · storage S3 privado · exportação contábil (ZIP + manifesto) ·
dashboards · notificações multicanal (Twilio + Resend) · offline-first · antifraude ·
**IA/OCR via Anthropic Claude** · LGPD (DSR, retenção, legal hold) · suporte seguro com
aprovação · observabilidade · resposta a incidente · backup/DR (`deploy/backup.sh`) ·
performance · auditoria externa · APIs (OpenAPI) · DevSecOps (CI) · testes de
isolamento · retenção · contestação · reemissão · importação em massa.

## Modo MOCK × REAL — política dos adapters

Cada integração detecta automaticamente se sua chave está configurada em `.env`.
**Sem chave** → adapter ativo em modo MOCK (rota responde, mas não chama API externa).
**Com chave** → chamada real. Você migra integração por integração sem reiniciar deploy:

| Connector | Variáveis | Sem chave |
|---|---|---|
| Anthropic Claude (IA/OCR) | `ANTHROPIC_API_KEY` | MOCK: retorna estrutura vazia |
| Twilio SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` | MOCK |
| Twilio WhatsApp | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | MOCK |
| Resend (e-mail) | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` | MOCK |
| SendGrid (e-mail) | `EMAIL_PROVIDER=sendgrid`, `SENDGRID_API_KEY`, `EMAIL_FROM` | MOCK |
| ClickSign (assinatura ICP) | `SIGNATURE_PROVIDER=clicksign`, `CLICKSIGN_API_TOKEN` | Assinatura interna evidenciada continua funcionando |
| D4Sign (assinatura ICP) | `SIGNATURE_PROVIDER=d4sign`, `D4SIGN_API_TOKEN`, `D4SIGN_CRYPT_KEY`, `D4SIGN_SAFE_UUID` | idem |

Status ao vivo em **`GET /api/connectors/status`** ou na página `/conexoes` do painel.

## Subir localmente

Pré-requisito: Docker. Veja **`CHAVES.md`** para o passo-a-passo de cada integração.

```bash
cp .env.example .env       # preencha (use deploy/deploy.sh para gerar segredos)
docker compose up -d --build
```

A primeira subida aplica `db/001_schema.sql` → `002_hardening.sql` → `003_modules.sql`
→ `004_producao.sql` e roda seed (idempotente).

- Frontend: `https://{DOMAIN}` ou `http://localhost`
- API:      `https://{DOMAIN}/api` (OpenAPI em `/api/openapi.json`)

## Logins de demonstração (senha `Demo@2026`)

| E-mail | Papel |
|---|---|
| `contador.alfa@demo` | Contador (vê candidatos A e B do Escritório Alfa) |
| `coord.ana@demo` | Coordenador local (candidato A) |
| `coord.bruno@demo` | Coordenador local (candidato B) |
| `admin.ana@demo` | Administrador (candidato A) |
| `contador.beta@demo` | Contador (Escritório Beta) |

## Testes

```bash
cd backend
npm run typecheck             # tipos
npm run test:isolation        # RLS + ledger append-only (exige banco rodando)
```

O teste de isolamento prova: A não vê documentos de B; Escritório 1 não vê o
Escritório 2; a cadeia de auditoria está íntegra; UPDATE/DELETE no ledger é bloqueado.

## Estrutura

```
backend/
  src/
    core/          # env, db, crypto, audit, workflow, pdf, openapi, auth, util
    connectors/    # ai-anthropic, notification-twilio, email, signature
    routes/        # auth, app, modules1/2/3, platform, public
    scripts/       # bootstrap, migrate, seed, test_isolation
db/
  001_schema.sql        # schema base + RLS + ledger
  002_hardening.sql     # RLS WITH CHECK + trigger imutabilidade
  003_modules.sql       # tabelas dos módulos avançados
  004_producao.sql      # notification_delivery_attempt + índices + trigger reforçado
frontend/
  src/
    app/                # Next.js App Router: landing, login, /painel/*, /publico/assinar
    components/         # ui, motion, chrome, landing
    lib/                # api client
deploy/
  Caddyfile, cloud-init.yaml, deploy.sh, entrypoint.sh, backup.sh
docker-compose.yml
.env.example
CHAVES.md               # Passo-a-passo: cada chave, onde obter, ordem de configuração
```

## Próximos passos

Veja **`CHAVES.md`** para criar cada conta (Anthropic, Twilio, Resend, ClickSign),
gerar as chaves e plugar uma a uma sem reiniciar nada.
