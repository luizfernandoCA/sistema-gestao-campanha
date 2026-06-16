'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useScrollProgress } from '../../hooks/useScrollProgress';

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const progress = useScrollProgress();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`fixed top-0 left-0 right-0 z-40 transition-all ${scrolled ? 'py-2' : 'py-4'}`}>
      <nav className={`container mx-auto px-6 transition-all`}>
        <div className={`glass rounded-2xl px-5 py-3 flex items-center justify-between`}>
          <Link href="/" className="font-semibold tracking-tight">
            Sistema · Campanha
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <a href="#arquitetura" className="text-ink-500 hover:text-ink-900 hidden sm:inline">Arquitetura</a>
            <Link href="/login" className="btn-primary text-sm py-2 px-4">Entrar</Link>
          </div>
        </div>
      </nav>
      <div className="absolute bottom-0 left-0 h-[2px] bg-accent-500"
           style={{ width: `${progress * 100}%`, transition: 'width 0.15s linear' }} />
    </header>
  );
}
