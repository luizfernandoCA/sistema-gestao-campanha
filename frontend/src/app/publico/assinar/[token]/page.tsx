'use client';
import { useState, FormEvent, use } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';

interface Params { token: string }

export default function AssinarRemotoPage({ params }: { params: Promise<Params> }) {
  const { token } = use(params);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [otp, setOtp] = useState('');
  const [otpMock, setOtpMock] = useState<string | null>(null);
  const [destino, setDestino] = useState('');
  const [canal, setCanal] = useState<'WHATSAPP' | 'SMS' | 'EMAIL'>('WHATSAPP');
  const [assinatura, setAssinatura] = useState('');
  const [aceites, setAceites] = useState({ identidade: false, leitura: false, livre: false });
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feito, setFeito] = useState(false);

  async function pedirOtp(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErro(null);
    try {
      const r = await fetch('/api/publico/assinatura/remota/otp', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, canal, destino }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro ?? 'Falha ao enviar');
      if (data.modo === 'MOCK') setOtpMock(data.otp_mock);
      setStep(2);
    } catch (e) { setErro((e as Error).message); } finally { setBusy(false); }
  }

  async function concluir(e: FormEvent) {
    e.preventDefault();
    if (!aceites.identidade || !aceites.leitura || !aceites.livre) {
      setErro('Você precisa confirmar os três aceites para prosseguir.'); return;
    }
    if (!assinatura.trim()) { setErro('Desenhe ou digite sua assinatura.'); return; }
    setBusy(true); setErro(null);
    try {
      const r = await fetch('/api/publico/assinatura/remota/concluir', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, otp, assinaturaBase64: btoa(assinatura) }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.erro ?? 'Falha ao concluir');
      setFeito(true); setStep(3);
    } catch (e) { setErro((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 hero-grid">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="w-full max-w-xl">
        <div className="card p-10">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck className="w-5 h-5 text-accent-500" />
            <span className="text-sm text-ink-500">Assinatura eletrônica evidenciada · Lei 14.063/2020</span>
          </div>
          {feito && (
            <div className="text-center py-10">
              <CheckCircle2 className="w-16 h-16 mx-auto text-green-600 mb-4" strokeWidth={1.5} />
              <h1 className="text-2xl font-semibold tracking-tight mb-2">Assinatura concluída</h1>
              <p className="text-ink-500">Suas evidências foram seladas. Você receberá uma cópia em breve.</p>
            </div>
          )}
          {!feito && step === 1 && (
            <form onSubmit={pedirOtp} className="space-y-4">
              <h1 className="text-2xl font-semibold tracking-tight mb-2">Validação de identidade</h1>
              <p className="text-ink-500 text-sm mb-6">Enviaremos um código de verificação para o canal escolhido.</p>
              <div>
                <label className="text-sm font-medium block mb-1.5">Canal</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['WHATSAPP', 'SMS', 'EMAIL'] as const).map((c) => (
                    <button key={c} type="button" onClick={() => setCanal(c)}
                      className={`py-2.5 rounded-xl border text-sm ${canal === c ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200'}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">{canal === 'EMAIL' ? 'E-mail' : 'Número (formato +55...)'}</label>
                <input className="input" required value={destino} onChange={(e) => setDestino(e.target.value)}
                  placeholder={canal === 'EMAIL' ? 'voce@email.com' : '+5511999999999'} />
              </div>
              {erro && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{erro}</div>}
              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? 'Enviando…' : 'Receber código'}
              </button>
            </form>
          )}
          {!feito && step === 2 && (
            <form onSubmit={concluir} className="space-y-4">
              <h1 className="text-2xl font-semibold tracking-tight mb-2">Confirme e assine</h1>
              {otpMock && (
                <div className="text-xs bg-amber-50 text-amber-800 rounded-xl px-3 py-2">
                  Modo de teste: o código é <span className="font-mono font-bold">{otpMock}</span>
                </div>
              )}
              <div>
                <label className="text-sm font-medium block mb-1.5">Código de verificação</label>
                <input className="input font-mono tracking-widest text-center text-lg" required maxLength={6}
                  value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div className="space-y-2 py-3 border-y border-ink-100">
                {[
                  ['identidade', 'Confirmo que sou a pessoa cujo nome consta no contrato.'],
                  ['leitura', 'Li o contrato integralmente e compreendi suas cláusulas.'],
                  ['livre', 'Estou assinando livremente, sem coação.'],
                ].map(([k, label]) => (
                  <label key={k} className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="mt-1 accent-ink-900"
                      checked={(aceites as any)[k]} onChange={(e) => setAceites({ ...aceites, [k]: e.target.checked })} />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Sua assinatura (digite seu nome completo)</label>
                <input className="input font-serif italic text-xl" required value={assinatura}
                  onChange={(e) => setAssinatura(e.target.value)} placeholder="Maria da Silva" />
              </div>
              {erro && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{erro}</div>}
              <button type="submit" disabled={busy} className="btn-primary w-full">
                {busy ? 'Selando evidências…' : 'Assinar contrato'}
              </button>
            </form>
          )}
          <p className="text-xs text-ink-400 mt-8 text-center">
            Sua assinatura gera hash + evidências em cadeia de custódia imutável.
            Em caso de divergência, você pode contestar pelo mesmo canal.
          </p>
        </div>
      </motion.div>
    </main>
  );
}
