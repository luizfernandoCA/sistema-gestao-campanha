'use client';
// Scroll pin via GSAP ScrollTrigger — usado para a seção de features narrativas.
import { useEffect, useRef } from 'react';
import gsap from 'gsap';

export function ScrollPin({ children, height = '300vh' }: { children: React.ReactNode; height?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { ScrollTrigger } = await import('gsap/ScrollTrigger');
      if (!mounted) return;
      gsap.registerPlugin(ScrollTrigger);
      if (!wrap.current) return;
      const inner = wrap.current.querySelector<HTMLElement>('[data-pin-target]');
      if (!inner) return;
      const trigger = ScrollTrigger.create({
        trigger: wrap.current, start: 'top top', end: 'bottom bottom',
        pin: inner, pinSpacing: false,
      });
      return () => trigger.kill();
    })();
    return () => { mounted = false; };
  }, []);
  return (
    <section ref={wrap} style={{ height }} className="relative">
      <div data-pin-target className="h-screen flex items-center justify-center">
        {children}
      </div>
    </section>
  );
}
