'use client';
import { Reveal } from '../motion/Reveal';

const blocks = [
  ['Portal Contador', 'Portal Jurídico', 'Administrador', 'Coord. Geral', 'PWA Coord. Local', 'Formiguinha', 'Suporte/Auditoria'],
  ['Identidade', 'Tenancy', 'Hierarquia', 'Templates', 'Documentos', 'Workflow', 'Assinatura'],
  ['Evidências', 'Audit Ledger', 'Storage', 'Notificação', 'Exportação', 'Antifraude', 'IA/OCR'],
  ['PostgreSQL + RLS', 'Object Storage cifrado', 'KMS local (envelope)', 'Filas/Workers'],
];

export function Architecture() {
  return (
    <section className="container mx-auto px-6 py-32">
      <Reveal>
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-sm font-medium text-accent-500 mb-4">ARQUITETURA</p>
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight">
            Monolito modular, sem microservices prematuros.
          </h2>
          <p className="mt-6 text-lg text-ink-500">
            Cada módulo encapsula uma das 35 microarquiteturas. Promover para serviço separado
            só quando houver escala, isolamento operacional ou equipe dedicada — não antes.
          </p>
        </div>
      </Reveal>
      <div className="space-y-4 max-w-5xl mx-auto">
        {blocks.map((row, i) => (
          <Reveal key={i} delay={i * 0.08}>
            <div className="card p-2 flex flex-wrap gap-2 justify-center">
              {row.map((b) => (
                <span key={b} className="px-4 py-2 rounded-2xl bg-ink-50 text-sm font-medium text-ink-700">
                  {b}
                </span>
              ))}
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
