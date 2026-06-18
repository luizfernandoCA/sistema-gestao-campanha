'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { auth } from '@/lib/api';
import { Lock, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setErr(null);
    try { await auth.login(email, pwd); router.push('/painel'); }
    catch (e: unknown) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 hero-grid">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="w-full max-w-md">
        <Link href="/" className="block text-sm text-ink-500 mb-8 hover:text-ink-900">← voltar</Link>
        <div className="card p-10">
          <div className="w-12 h-12 rounded-2xl bg-ink-900 text-white flex items-center justify-center mb-6">
            <Lock className="w-5 h-5" strokeWidth={2} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight mb-2">Entrar no sistema</h1>
          <p className="text-ink-500 mb-8">Acesso por papel: contador, coordenador, administrador, auditoria.</p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-ink-700 mb-1.5 block">E-mail</label>
              <input className="input" type="email" autoComplete="username" required
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-ink-700 mb-1.5 block">Senha</label>
              <input className="input" type="password" autoComplete="current-password" required
                value={pwd} onChange={(e) => setPwd(e.target.value)} />
            </div>
            {err && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{err}</div>}
            <button type="submit" disabled={loading}
              className="btn-primary w-full inline-flex items-center justify-center gap-2 disabled:opacity-60">
              {loading ? 'Entrando…' : <>Entrar <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
          <p className="text-xs text-ink-400 mt-6 text-center">
            Em ambiente de demonstração, senhas são <span className="font-mono">Demo@2026</span>.
            <br/>Em produção, MFA é obrigatório para perfis críticos.
          </p>
        </div>
      </motion.div>
    </main>
  );
}
