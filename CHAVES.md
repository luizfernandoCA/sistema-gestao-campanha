# CHAVES.md — Manual de Configuração de Produção

Este documento explica **passo-a-passo** como criar cada conta nos provedores
externos, gerar as chaves e plugá-las no sistema. Tudo em ordem segura, do mais
importante para o opcional.

> **Princípio**: você pode subir o sistema 100% funcional em modo MOCK e ir
> migrando integração por integração para REAL conforme as chaves chegam.
> Nada precisa de reinicialização global — basta atualizar `.env` e reiniciar
> apenas o serviço `api`.

---

## 0) Antes de tudo — gerar segredos locais

Esses NÃO são chaves de provedor externo. São segredos que você mesmo gera no
servidor (ou no seu laptop) e cola no `.env`.

```bash
# JWT_SECRET (64 bytes hex)
openssl rand -hex 64

# MASTER_KEY_B64 (32 bytes em base64 — KMS local / envelope encryption)
openssl rand -base64 32

# HMAC_KEY (64 bytes hex — usado para deduplicar CPF/telefone sem expor)
openssl rand -hex 64

# Senhas do Postgres
openssl rand -base64 24      # POSTGRES_PASSWORD
openssl rand -base64 24      # APP_DB_PASSWORD

# MinIO
openssl rand -base64 24      # S3_SECRET_KEY
```

Cole cada um no `.env` correspondente.

---

## 1) Anthropic Claude — IA / OCR / extração

**Para que serve**: análise de documentos escaneados, extração estruturada de
campos (CPF, valor, data), detecção de divergências contra cadastro,
classificação de tipo de documento. A IA **nunca** altera o cadastro — apenas
sinaliza para revisão humana (regra técnica 21 da arquitetura).

### Passo-a-passo

1. Acesse <https://console.anthropic.com> e crie conta (ou faça login).
2. No menu lateral: **Settings → Billing** — adicione cartão e $5 de crédito
   inicial (pode usar até esgotar; sem mensalidade).
3. Vá em **Settings → API Keys → Create Key**.
4. Dê um nome (ex.: `sistema-campanha-prod`) e copie a chave que começa com
   `sk-ant-api03-...`. **Anote agora; ela só aparece uma vez.**
5. No servidor, edite `/opt/app/.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ANTHROPIC_MODEL=claude-sonnet-4-6
   ```
6. Reinicie o backend: `docker compose up -d --build api`.
7. Confirme em <https://seu-dominio/conexoes> que IA aparece como **REAL**.

### Custo esperado

Claude Sonnet 4.6 ≈ $3/M tokens de input + $15/M de output.
Um documento médio (3000 caracteres ≈ 800 tokens) custa **≈ $0.005**.
1000 documentos/mês ≈ **$5 USD**.

---

## 2) Twilio — SMS, WhatsApp e OTP da assinatura remota

**Para que serve**: enviar o código de verificação (OTP) para a formiguinha
assinar remotamente, e notificações operacionais (contestação, conclusão, etc.).

### Passo-a-passo

1. Acesse <https://www.twilio.com/try-twilio> e crie conta.
2. Verifique seu telefone (você recebe um SMS).
3. No dashboard inicial, copie **Account SID** e **Auth Token** (canto superior).
4. Compre um número:
   - **Phone Numbers → Buy a Number** → escolha um número com SMS habilitado
   - Custo: ~$1/mês + $0.0075 por SMS enviado (BR).
5. Para WhatsApp:
   - **Messaging → Try it out → Send a WhatsApp message** → ative o sandbox
     (gratuito para testes; em produção exige aprovação da Meta).
   - O número do sandbox é `+14155238886`.
6. Edite `/opt/app/.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=seu_auth_token
   TWILIO_SMS_FROM=+1xxxxxxxxxx
   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
   ```
7. Reinicie a API: `docker compose up -d --build api`.

### Custo esperado

- SMS Brasil: ~$0.075/mensagem
- WhatsApp: $0.005 (utility) a $0.07 (marketing) por mensagem
- 1000 OTPs/mês via WhatsApp ≈ **$5–7 USD**

### Migração para produção WhatsApp

Para usar WhatsApp em produção (sem sandbox), você precisa:
1. Verificar conta business no Facebook Business Manager
2. Solicitar aprovação do número no Twilio
3. Cadastrar templates de mensagem com o Twilio Content Builder

---

## 3) Resend — E-mail transacional (recomendado) ou SendGrid

**Para que serve**: enviar e-mails de confirmação de assinatura, dossiês prontos,
notificações ao contador, link de contestação.

### Opção A: Resend (mais simples)

1. Acesse <https://resend.com> e crie conta.
2. **Domains → Add Domain** → digite seu domínio (ex.: `e-negociosinteligentes.com.br`).
3. Resend mostra **3 registros DNS** (SPF, DKIM, DMARC):
   - Adicione no Hostinger: hPanel → DNS → Manage → Add Record
   - Aguarde propagar (~30 minutos)
   - No Resend, clique em **Verify Domain**.
4. **API Keys → Create API Key** → escopo "Full Access" → copie `re_xxx...`.
5. Edite `/opt/app/.env`:
   ```
   EMAIL_PROVIDER=resend
   EMAIL_FROM=sistema@e-negociosinteligentes.com.br
   RESEND_API_KEY=re_xxxxxxxxxxxxxxx
   ```
6. Reinicie a API: `docker compose up -d --build api`.

### Opção B: SendGrid (alternativa)

1. Acesse <https://sendgrid.com> e crie conta gratuita (100 e-mails/dia).
2. **Settings → Sender Authentication → Authenticate Your Domain**.
3. **Settings → API Keys → Create API Key** → escopo "Restricted Access" →
   marcar apenas "Mail Send" → copie a chave.
4. Edite `/opt/app/.env`:
   ```
   EMAIL_PROVIDER=sendgrid
   EMAIL_FROM=sistema@e-negociosinteligentes.com.br
   SENDGRID_API_KEY=SG.xxxxxxxxxx
   ```
5. Reinicie a API.

### Custo esperado

- Resend: 3000 e-mails/mês grátis, depois $20/mês para 50k
- SendGrid: 100/dia grátis, depois $19.95/mês para 50k

---

## 4) Assinatura eletrônica ICP-Brasil — ClickSign (recomendado) ou D4Sign

**Para que serve**: promover a assinatura eletrônica interna (evidenciada) para
**assinatura avançada** com valor jurídico reforçado (Lei 14.063/2020 art. 4º
inciso II). O fluxo interno continua válido como base de evidências.

### Opção A: ClickSign

1. Acesse <https://www.clicksign.com> → **Criar conta**.
2. Escolha plano:
   - **Sandbox/Trial**: gratuito para testar (assinaturas marcadas como teste)
   - **Profissional**: R$ 79/mês com 30 assinaturas + R$ 2,49 por adicional
3. No painel: **Configurações → API → Gerar Token**.
4. Edite `/opt/app/.env`:
   ```
   SIGNATURE_PROVIDER=clicksign
   CLICKSIGN_API_TOKEN=seu_token
   CLICKSIGN_API_BASE=https://app.clicksign.com
   # Para sandbox: CLICKSIGN_API_BASE=https://sandbox.clicksign.com
   ```
5. Reinicie a API: `docker compose up -d --build api`.
6. (Opcional) Configure webhook em **Configurações → Webhooks**:
   - URL: `https://seu-dominio/api/assinatura/eletronica/webhook/clicksign`
   - Eventos: `sign`, `refuse`, `auto_close`

### Opção B: D4Sign

1. Acesse <https://www.d4sign.com.br> → criar conta.
2. **Minha Conta → Configurações → Token API**:
   - Gere `tokenAPI` e `cryptKey` (ambos necessários).
3. Crie um **Cofre** para armazenar os PDFs assinados:
   - **Cofres → Novo Cofre** → anote o UUID gerado.
4. Edite `/opt/app/.env`:
   ```
   SIGNATURE_PROVIDER=d4sign
   D4SIGN_API_TOKEN=seu_token_api
   D4SIGN_CRYPT_KEY=sua_crypt_key
   D4SIGN_SAFE_UUID=uuid_do_cofre
   D4SIGN_API_BASE=https://secure.d4sign.com.br/api/v1
   ```
5. Reinicie a API.

### Custo esperado

- ClickSign: a partir de R$ 79/mês (30 assinaturas)
- D4Sign: a partir de R$ 89/mês (30 documentos)

---

## 5) Domínio + Caddy (já configurado, só conferir)

Pré-requisitos:
- Domínio `escritorio.e-negociosinteligentes.com.br` apontando para
  **IP 46.224.193.105** (Hetzner CX32)
- Hostinger DNS: registro A `escritorio` → 46.224.193.105

Caddy emite o certificado TLS automaticamente quando o A record já resolve
e o `docker compose up` é executado.

---

## 6) Validação final antes de publicar

Depois de configurar TODAS as chaves desejadas:

```bash
# 1. Verificar status dos connectors
curl -H "Authorization: Bearer $JWT" https://seu-dominio/api/connectors/status

# 2. Smoke test E2E (login + dashboard + isolamento)
docker compose exec api npm run test:isolation

# 3. Conferir health + readiness
curl https://seu-dominio/api/health
curl https://seu-dominio/api/ready

# 4. Olhar logs por 5 minutos
docker compose logs -f api | grep -iE "error|warn"
```

### Checklist pré-produção

- [ ] `.env` no servidor com TODAS as chaves desejadas (e nenhuma chave commitada)
- [ ] `/conexoes` mostra cada connector como **REAL**
- [ ] Teste de assinatura remota end-to-end funcionando (OTP chega de verdade)
- [ ] Teste de isolamento RLS passa (verde)
- [ ] Backup manual executado: `docker compose exec api bash deploy/backup.sh`
- [ ] DNS A record propagado e HTTPS válido (Caddy verde)
- [ ] Senhas de demonstração removidas/trocadas
- [ ] Política de privacidade e termos cadastrados em `data_processing_activity`

---

## 7) Custos totais estimados (operação mensal)

| Item | Estimativa baixa | Estimativa alta |
|---|---|---|
| Hetzner CX32 | €7 (~R$ 40) | €7 |
| Anthropic Claude (1k docs OCR) | $5 (~R$ 28) | $20 |
| Twilio (1k OTPs WhatsApp) | $5 (~R$ 28) | $15 |
| Resend (até 3k e-mails) | $0 | $20 |
| ClickSign (30 assinaturas) | R$ 79 | R$ 250+ |
| Domínio Hostinger | R$ 5/mês | R$ 10 |
| **Total mensal aproximado** | **R$ 180** | **R$ 470** |

Tudo isso pode rodar em modo MOCK enquanto você quiser. Os custos só começam
quando você pluga cada chave real.

---

## 8) Suporte

- Código-fonte: <https://github.com/luizfernandoCA/sistema-gestao-campanha>
- Branch v2: `refactor/v2-producao`
- Arquitetura completa: pacote de 9 documentos `.md` + `.pdf` fornecidos

Em caso de incidente:
1. Não apague logs — eles são evidência.
2. Abra um incidente: `POST /api/incidentes` com timeline.
3. Se cross-tenant suspeito: revogue sessões em massa imediatamente.
4. Consulte o playbook em `deploy/playbooks/` (se ainda não existe, será criado
   na Onda 4 — pressão adversarial).
