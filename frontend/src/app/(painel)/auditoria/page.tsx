'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Topbar } from '@/components/chrome/Topbar';
import { api } from '@/lib/api';
import { Reveal } from '@/components/motion/Reveal';
import { CheckCircle2, XCircle } from 'lucide-react';

interface Event { event_type: string; actor_role: string; created_at: string }
interface ChainCheck { ok: boolean; entries: number; brokenAt?: number }

function AuditoriaInner() {
  const params = useSearchParams();
  const docId = params.get('doc');
  const candId = params.get('cand');
  const [timeline, setTimeline] = useState<Event[] | null>(null);
  const [chain, setChain] = useState<ChainCheck | null>(null);

  useEffect(() => {
    if (docId) api<Event[]>(`/api/documentos/${docId}/timeline`).then(setTimeline).catch(() => {});
    if (candId) api<ChainCheck>(`/api/auditoria/${candId}/verificar`).then(setChain).catch(() => {});
  }, [docId, candId]);

  return (
    <>
      <Topbar title="Auditoria" />
      <main className="p-8 space-y-8">
        <Reveal>
          <div className="card p-6 space-y-3">
            <p className="text-sm text-ink-500">
              Use <code>?doc=&lt;uuid&gt;</code> para a timeline de um documento ou{' '}
              <code>?cand=&lt;uuid&gt;</code> para verificar a cadeia de custódia de um candidato.
            </p>
          </div>
        </Reveal>
        {chain && (
          <Reveal delay={0.1}>
            <div className="card p-6">
              <h3 className="text-lg font-semibold mb-4">Cadeia de custódia</h3>
              <div className="flex items-center gap-3">
                {chain.ok
                  ? <><CheckCircle2 className="w-5 h-5 text-green-600" /> <span>Cadeia íntegra — {chain.entries} entradas</span></>
                  : <><XCircle className="w-5 h-5 text-red-600" /> <span>Cadeia quebrada na entrada #{chain.brokenAt}</span></>}
              </div>
            </div>
          </Reveal>
        )}
        {timeline && (
          <Reveal delay={0.15}>
            <div className="card p-6">
              <h3 className="text-lg font-semibold mb-4">Linha do tempo do documento</h3>
              <ol className="space-y-3">
                {timeline.map((e, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-ink-400 mt-2"></div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{e.event_type}</p>
                      <p className="text-xs text-ink-500">{e.actor_role} · {new Date(e.created_at).toLocaleString('pt-BR')}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        )}
      </main>
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<><Topbar title="Auditoria" /><main className="p-8 text-ink-500">Carregando…</main></>}><AuditoriaInner /></Suspense>;
}
