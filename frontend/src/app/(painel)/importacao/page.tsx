'use client';
import { Topbar } from '@/components/chrome/Topbar';
import { Reveal } from '@/components/motion/Reveal';
import { FileUp } from 'lucide-react';
export default function ImportacaoPage() {
  return (
    <>
      <Topbar title="Importação em massa" />
      <main className="p-8">
        <Reveal>
          <div className="card p-10 text-center">
            <FileUp className="w-12 h-12 mx-auto text-ink-400 mb-4" strokeWidth={1.5} />
            <h2 className="text-xl font-semibold mb-2">Use a API <code>POST /api/importacao/previa</code></h2>
            <p className="text-ink-500 text-sm max-w-xl mx-auto">
              UI de upload + prévia interativa fica para a próxima onda. Hoje, o endpoint aceita
              CSV/JSON com prévia (mostra novos × duplicados) seguido de commit idempotente.
              Documentação completa em <a href="/api/openapi.json" className="text-accent-500 hover:underline">/api/openapi.json</a>.
            </p>
          </div>
        </Reveal>
      </main>
    </>
  );
}
