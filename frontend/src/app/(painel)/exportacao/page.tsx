'use client';
import { useEffect, useState } from 'react';
import { Topbar } from '@/components/chrome/Topbar';
import { api } from '@/lib/api';
import { Reveal } from '@/components/motion/Reveal';
import { FileDown } from 'lucide-react';

interface Cand { id: string; name: string }

export default function ExportacaoPage() {
  const [cands, setCands] = useState<Cand[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api<Cand[]>('/api/candidatos').then(setCands); }, []);

  async function gerar(c: Cand) {
    setBusy(c.id); setMsg(null);
    try {
      const r = await api<{ exportId: string; itens: number }>(`/api/exportacao/candidato/${c.id}`, { method: 'POST' });
      setMsg(`Dossiê gerado: ${r.itens} itens. ID ${r.exportId}.`);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <>
      <Topbar title="Exportação contábil" />
      <main className="p-8 space-y-6">
        <Reveal>
          <p className="text-ink-500 text-sm">
            Geração de dossiê por candidato com manifesto de hashes. Documento contestado fica em pendências.
          </p>
        </Reveal>
        {msg && <Reveal><div className="card p-4 bg-green-50 text-sm">{msg}</div></Reveal>}
        <Reveal delay={0.1}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cands.map((c) => (
              <div key={c.id} className="card p-6 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{c.name}</h3>
                  <p className="text-xs text-ink-400 font-mono break-all mt-1">{c.id}</p>
                </div>
                <button onClick={() => gerar(c)} disabled={busy === c.id}
                  className="btn-primary text-sm py-2 px-4 inline-flex items-center gap-2 shrink-0">
                  <FileDown className="w-4 h-4" /> {busy === c.id ? '…' : 'Gerar'}
                </button>
              </div>
            ))}
          </div>
        </Reveal>
      </main>
    </>
  );
}
