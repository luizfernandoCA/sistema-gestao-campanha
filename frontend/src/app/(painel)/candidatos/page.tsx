'use client';
import { useEffect, useState } from 'react';
import { Topbar } from '@/components/chrome/Topbar';
import { api } from '@/lib/api';
import { Reveal } from '@/components/motion/Reveal';

interface Cand { id: string; name: string; candidate_number: string; party: string; status: string }

export default function CandidatosPage() {
  const [rows, setRows] = useState<Cand[] | null>(null);
  useEffect(() => { api<Cand[]>('/api/candidatos').then(setRows); }, []);
  return (
    <>
      <Topbar title="Candidatos" />
      <main className="p-8 space-y-6">
        <Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows?.map((c) => (
              <div key={c.id} className="card p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold tracking-tight">{c.name}</h3>
                    <p className="text-sm text-ink-500">Nº {c.candidate_number ?? '—'} · {c.party ?? '—'}</p>
                  </div>
                  <span className="badge badge-green">{c.status}</span>
                </div>
                <p className="text-xs text-ink-400 font-mono break-all">{c.id}</p>
              </div>
            ))}
          </div>
          {rows && rows.length === 0 && <p className="text-ink-500 text-sm">Sem candidatos no escopo.</p>}
        </Reveal>
      </main>
    </>
  );
}
