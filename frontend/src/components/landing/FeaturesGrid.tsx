'use client';
import { Reveal } from '../motion/Reveal';
import { FileSignature, Lock, ShieldAlert, Database, FileText, Activity, FileSearch, ScanLine, Send, ServerCog, Eye, Inbox } from 'lucide-react';

const features = [
  { icon: FileSignature, title: 'Assinatura assistida e remota', desc: 'Coordenador opera, formiguinha assina. Pacote de evidências completo: aceite, hash, IP, dispositivo, timestamp do servidor.' },
  { icon: Lock,           title: 'Criptografia envelope AES-256-GCM', desc: 'PDFs e evidências cifrados antes do storage. CPF com HMAC para dedup sem expor o dado.' },
  { icon: Database,       title: 'Multi-tenant com RLS', desc: 'Isolamento entre candidatos e escritórios provado no banco. Candidato A nunca vê dados de B — testado.' },
  { icon: Activity,       title: 'Ledger append-only', desc: 'Hash encadeado por candidato. Trigger no banco bloqueia UPDATE/DELETE. Verificação de cadeia em endpoint.' },
  { icon: FileText,       title: 'Templates versionados', desc: 'Documento gerado guarda contract_template_version_id. Aprovação jurídica e contábil obrigatória.' },
  { icon: Inbox,          title: 'Exportação contábil', desc: 'Dossiê por candidato com manifesto de hashes em ZIP. Documento contestado não entra na regular.' },
  { icon: ShieldAlert,    title: 'Antifraude com sinais', desc: 'Duplicidade, excesso de papel, evidências ausentes — IA nunca é decisor final. Revisão humana obrigatória.' },
  { icon: ScanLine,       title: 'OCR com Anthropic Claude', desc: 'Extração estruturada, classificação e detecção de divergências. Sem alterar cadastro automaticamente.' },
  { icon: Send,           title: 'Notificação multicanal', desc: 'SMS, WhatsApp e e-mail via Twilio + Resend. Idempotência forte; sem dado sensível em corpo.' },
  { icon: FileSearch,     title: 'Auditoria externa', desc: 'Pacote read-only com manifest e hashes. Auditor de candidato A nunca vê B.' },
  { icon: ServerCog,      title: 'Observabilidade + backup', desc: 'Logs estruturados, métricas, security events, backup cifrado com restore test periódico.' },
  { icon: Eye,            title: 'LGPD operacional', desc: 'DSR, consentimento, retenção, legal hold que BLOQUEIA descarte. Suporte temporário com aprovação.' },
];

export function FeaturesGrid() {
  return (
    <section id="arquitetura" className="container mx-auto px-6 py-32">
      <Reveal>
        <div className="max-w-3xl mb-16">
          <p className="text-sm font-medium text-accent-500 mb-4">35 MICROARQUITETURAS</p>
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-balance">
            Cada decisão de engenharia tem motivo.
          </h2>
          <p className="mt-6 text-lg text-ink-500 text-balance">
            Não é um repositório de PDFs. É uma plataforma de cadeia de custódia documental
            com isolamento provado, evidências seladas e exportação verificável.
          </p>
        </div>
      </Reveal>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((f, i) => (
          <Reveal key={f.title} delay={i * 0.05}>
            <div className="card p-7 h-full hover:border-ink-300 transition-colors">
              <f.icon className="w-7 h-7 text-ink-700 mb-5" strokeWidth={1.5} />
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-ink-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
