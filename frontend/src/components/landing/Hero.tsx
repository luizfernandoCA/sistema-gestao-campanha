'use client';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';

export function Hero() {
  return (
    <section className="relative min-h-[92vh] flex items-center justify-center hero-grid overflow-hidden">
      <div className="absolute inset-0 -z-10 animate-gradient-pan" />
      <div className="container mx-auto px-6 text-center max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-8 text-sm">
            <ShieldCheck className="w-4 h-4 text-accent-500" />
            Sistema auditável · LGPD · TSE 23.607/2019 · Lei 14.063/2020
          </div>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-semibold tracking-tight text-balance leading-[1.05]">
            Cadeia de custódia
            <br />
            <span className="bg-gradient-to-r from-ink-900 to-ink-500 bg-clip-text text-transparent">
              para campanha eleitoral.
            </span>
          </h1>
          <p className="mt-8 text-lg md:text-xl text-ink-500 max-w-2xl mx-auto text-balance">
            Contratos de formiguinhas, assinatura assistida, evidências
            criptografadas e exportação contábil verificável. Sem perder uma
            única assinatura.
          </p>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <Link href="/login" className="btn-primary inline-flex items-center gap-2">
              Entrar no sistema <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="#arquitetura" className="btn-ghost">Como funciona</a>
          </div>
          <div className="mt-16 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-sm text-ink-400">
            <span>35 microarquiteturas</span>
            <span>·</span>
            <span>Row Level Security</span>
            <span>·</span>
            <span>Ledger append-only</span>
            <span>·</span>
            <span>Envelope encryption</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
