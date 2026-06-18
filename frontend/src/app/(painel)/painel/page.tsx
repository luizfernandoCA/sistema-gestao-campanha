'use client';
import { Topbar } from '@/components/chrome/Topbar';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Reveal } from '@/components/motion/Reveal';
import { Files, Users, ShieldAlert, BadgeCheck } from 'lucide-react';

interface Dash {
  candidatos: { id: string; name: string }[];
  documentos_por_status: { candidate_id: string; status: string; total: number }[];
}

export default function PainelPage() {
  const [data, setData] = useState<Dash | null>(null);
  useEffect(() => { api<Dash>('/api/dashboard').then(setData).catch(() => {}); }, []);

  const total = data?.documentos_por_status.reduce((s, r) => s + r.total, 0) ?? 0;
  const finalizados = data?.documentos_por_status.filter((r) => r.status === 'FINALIZADO').reduce((s, r) => s + r.total, 0) ?? 0;
  const pendentes = total - finalizados;

  return (
    <>
      <Topbar title="Painel" />
      <main className="p-8 space-y-8">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight">Visão geral do escritório</h2>
          <p className="text-ink-500 mt-1">Agregado em uma única query (sem N+1). Recursos sob RLS.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card icon={Users} label="Candidatos no escopo" value={data?.candidatos.length ?? '—'} />
            <Card icon={Files} label="Documentos totais" value={total} />
            <Card icon={BadgeCheck} label="Finalizados" value={finalizados} hint={total ? `${Math.round(finalizados / total * 100)}%` : ''} />
            <Card icon={ShieldAlert} label="Pendentes" value={pendentes} />
          </div>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="card p-6">
            <h3 className="text-lg font-semibold mb-4">Distribuição por status</h3>
            {data?.documentos_por_status.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-ink-500 border-b border-ink-200">
                  <tr><th className="py-2">Candidato</th><th>Status</th><th className="text-right">Total</th></tr>
                </thead>
                <tbody>
                  {data.documentos_por_status.map((r, i) => {
                    const cand = data.candidatos.find((c) => c.id === r.candidate_id)?.name ?? r.candidate_id.slice(0, 8);
                    return (
                      <tr key={i} className="border-b border-ink-100 last:border-0">
                        <td className="py-3">{cand}</td>
                        <td><span className="badge">{r.status}</span></td>
                        <td className="text-right font-medium">{r.total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="text-ink-500 text-sm">Sem dados (banco vazio ou seed não carregado).</p>}
          </div>
        </Reveal>
      </main>
    </>
  );
}

function Card({ icon: Icon, label, value, hint }: { icon: any; label: string; value: number | string; hint?: string }) {
  return (
    <div className="card p-6">
      <Icon className="w-5 h-5 text-ink-500 mb-3" strokeWidth={1.5} />
      <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="text-sm text-ink-500 mt-1">{label}{hint && <span className="ml-2 text-ink-400">{hint}</span>}</div>
    </div>
  );
}
