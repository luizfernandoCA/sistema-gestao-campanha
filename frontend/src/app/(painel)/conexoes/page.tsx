'use client';
import { useEffect, useState } from 'react';
import { Topbar } from '@/components/chrome/Topbar';
import { api } from '@/lib/api';
import { Reveal } from '@/components/motion/Reveal';
import { CheckCircle2, AlertCircle, Cloud } from 'lucide-react';

interface Status {
  ai: { provider: string; mode: 'REAL' | 'MOCK'; model?: string };
  sms: { provider: string; mode: 'REAL' | 'MOCK' };
  whatsapp: { provider: string; mode: 'REAL' | 'MOCK' };
  email: { provider: string; mode: 'REAL' | 'MOCK' };
  signature: { provider: string; mode: 'REAL' | 'MOCK' };
  storage: { provider: string; mode: 'REAL' | 'MOCK'; endpoint: string };
  kms: { provider: string; mode: 'REAL' };
}

const docs: Record<string, { env: string; label: string; url: string }> = {
  ai: { env: 'ANTHROPIC_API_KEY', label: 'Anthropic Claude', url: 'https://console.anthropic.com' },
  sms: { env: 'TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_SMS_FROM', label: 'Twilio SMS', url: 'https://www.twilio.com/console' },
  whatsapp: { env: 'TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM', label: 'Twilio WhatsApp', url: 'https://www.twilio.com/console' },
  email: { env: 'RESEND_API_KEY (ou SENDGRID_API_KEY)', label: 'E-mail', url: 'https://resend.com' },
  signature: { env: 'CLICKSIGN_API_TOKEN (ou D4SIGN_API_TOKEN+D4SIGN_CRYPT_KEY)', label: 'Assinatura ICP-Brasil', url: 'https://www.clicksign.com' },
};

export default function ConexoesPage() {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => { api<Status>('/api/connectors/status').then(setS).catch(() => {}); }, []);
  if (!s) return (<><Topbar title="Conexões" /><main className="p-8 text-ink-500">Carregando…</main></>);
  const cards: Array<[keyof Status, string]> = [
    ['ai', 'IA / OCR'], ['email', 'E-mail transacional'], ['sms', 'SMS'],
    ['whatsapp', 'WhatsApp'], ['signature', 'Assinatura ICP-Brasil'],
    ['storage', 'Object storage'], ['kms', 'KMS local'],
  ];
  return (
    <>
      <Topbar title="Conexões" />
      <main className="p-8 space-y-6">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight">Status das integrações</h2>
          <p className="text-ink-500 mt-1">REAL = chave configurada · MOCK = adapter ativo, sem chamada externa.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map(([k, label]) => {
              const c = s[k];
              const isReal = c.mode === 'REAL';
              const doc = docs[k as string];
              return (
                <div key={k} className="card p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Cloud className="w-5 h-5 text-ink-500" strokeWidth={1.5} />
                      <h3 className="font-semibold">{label}</h3>
                    </div>
                    <span className={`badge ${isReal ? 'badge-green' : 'badge-amber'}`}>
                      {isReal ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {c.mode}
                    </span>
                  </div>
                  <p className="text-sm text-ink-700">{(c as any).provider ?? '—'}{(c as any).model ? ` · ${(c as any).model}` : ''}</p>
                  {doc && (
                    <div className="mt-4 pt-4 border-t border-ink-100 space-y-2">
                      <p className="text-xs text-ink-500"><span className="font-medium">.env:</span> {doc.env}</p>
                      <a href={doc.url} target="_blank" rel="noreferrer" className="text-xs text-accent-500 hover:underline">
                        Obter chave em {new URL(doc.url).hostname} →
                      </a>
                    </div>
                  )}
                  {!doc && (c as any).endpoint && (
                    <p className="text-xs text-ink-400 font-mono mt-2 break-all">{(c as any).endpoint}</p>
                  )}
                </div>
              );
            })}
          </div>
        </Reveal>
      </main>
    </>
  );
}
