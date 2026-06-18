'use client';
import { useEffect, useState } from 'react';
import { Topbar } from '@/components/chrome/Topbar';
import { api } from '@/lib/api';
import { Reveal } from '@/components/motion/Reveal';
import Link from 'next/link';

interface Doc { id: string; status: string; candidato: string; formiguinha: string; created_at: string }

const statusBadge: Record<string, string> = {
  FINALIZADO: 'badge-green', CONTRATO_GERADO: 'badge-blue', CONTESTADO: 'badge-red',
  AGUARDANDO_ADMINISTRADOR: 'badge-amber', ENVIADO_PARA_ASSINATURA: 'badge-amber',
};

export default function DocumentosPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  useEffect(() => { api<Doc[]>('/api/documentos').then(setDocs); }, []);
  return (
    <>
      <Topbar title="Documentos" />
      <main className="p-8 space-y-6">
        <Reveal>
          <p className="text-ink-500 text-sm">{docs?.length ?? 0} documentos no seu escopo. Apenas listagem; ações de workflow são commands.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-ink-500">
                <tr><th className="px-6 py-3">Candidato</th><th>Formiguinha</th><th>Status</th><th>Criado</th><th></th></tr>
              </thead>
              <tbody>
                {docs?.map((d) => (
                  <tr key={d.id} className="border-t border-ink-100 hover:bg-ink-50/50 transition-colors">
                    <td className="px-6 py-3 font-medium">{d.candidato}</td>
                    <td>{d.formiguinha}</td>
                    <td><span className={`badge ${statusBadge[d.status] ?? ''}`}>{d.status}</span></td>
                    <td className="text-ink-500">{new Date(d.created_at).toLocaleString('pt-BR')}</td>
                    <td className="px-6"><Link className="text-accent-500 hover:underline" href={`/auditoria?doc=${d.id}`}>Timeline →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {docs && docs.length === 0 && <p className="text-ink-500 text-sm p-8 text-center">Nenhum documento ainda.</p>}
            {!docs && <p className="text-ink-500 text-sm p-8 text-center">Carregando…</p>}
          </div>
        </Reveal>
      </main>
    </>
  );
}
