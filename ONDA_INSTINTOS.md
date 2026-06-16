# ONDA_INSTINTOS.md — Memória da missão

## Projeto
Sistema de Gestão Documental de Campanha Eleitoral (escritório contábil → candidatos → formiguinhas).
Arquitetura completa em /Downloads/md (35 microarquiteturas). Monolito modular.

## Missão atual (2026-06-15) — autorizada em modo autônomo
- Escopo: FUNDAÇÃO real e deployável (não as 35 completas; isso é trabalho de meses).
- Hostname público: escritorio.e-negociosinteligentes.com.br
- Servidor: Hetzner Cloud CX32 (4 vCPU / 8 GB).
- DNS: Hostinger (hpanel já logado).
- Tudo em Português do Brasil para o usuário acompanhar.

## Instintos (confiança)
- [0.9] Sandbox NÃO tem Docker; tem Node 22, git, ssh, rsync, curl, openssl, zip. → Testar typecheck/build local; rodar integração no servidor.
- [0.9] Saída SSH:22 ABERTA e api.hetzner.cloud acessível. → Deploy via API Hetzner + rsync/ssh é mais confiável que automação de navegador.
- [0.8] Hetzner user-data (cloud-init) tem limite ~32KiB. → Não embutir app no cloud-init; cloud-init só instala Docker; app vai por rsync.
- [0.8] Frontend em SPA vanilla (sem build) servido pelo Caddy → reduz complexidade de deploy.
- [0.7] Rodar API via `tsx` no container (sem etapa de build TS) → deploy mais simples.

## Decisões de segurança (guarda-seguranca)
- Ambiente é demo/seed; dados pessoais são fictícios. Banner deixando claro "ambiente de demonstração".
- Segredos (JWT, master key, senhas DB) gerados no servidor, nunca commitados.
- Sem bucket público; storage cifrado (envelope AES-256-GCM, master key em env = KMS local).

## Instintos adicionais (pós-missão)
- [0.95] Hetzner renomeou a linha CX: o "CX32" (4vCPU/8GB Intel) hoje é "cx33" (id 115). cax* = ARM, cpx* = AMD, ccx* = dedicado.
- [0.9] Zod `.email()` REJEITA e-mails sem TLD (ex.: user@demo). Para logins de demonstração, usar identificador `z.string().min(3)` ou domínios com ponto.
- [0.9] Em Postgres, políticas RLS com só `USING` aplicam o mesmo como WITH CHECK em INSERT/UPDATE; mesmo assim, declarar WITH CHECK explícito evita ambiguidade e satisfaz auditoria.
- [0.9] Endpoints de exportação/download SEMPRE precisam de requireRole além do RLS (RLS de candidato não distingue papéis dentro do escopo).
- [0.85] Processos em background no sandbox NÃO sobrevivem entre chamadas bash; rodar build longo no servidor via nohup e fazer polling curto (<45s) por SSH.
- [0.85] Caddy emite TLS em segundos quando o A record já resolve antes do compose up.
