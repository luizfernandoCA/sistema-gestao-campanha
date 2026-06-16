'use client';
import Link from 'next/link';
import { Reveal } from '../motion/Reveal';
import { ArrowRight } from 'lucide-react';

export function CTA() {
  return (
    <section className="container mx-auto px-6 pt-16 pb-32">
      <Reveal>
        <div className="card p-16 text-center bg-gradient-to-br from-ink-900 to-ink-700 text-white border-0">
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight max-w-2xl mx-auto text-balance">
            Comece a operar com cadeia de custódia hoje.
          </h2>
          <p className="mt-6 text-lg text-ink-200 max-w-xl mx-auto">
            Login dos papéis: contador, administrador, coordenador e auditoria.
            Cada um vê apenas o que lhe cabe, com evidências verificáveis.
          </p>
          <div className="mt-10">
            <Link href="/login" className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-ink-900 rounded-full font-medium hover:translate-y-[-1px] transition-transform">
              Entrar no sistema <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
