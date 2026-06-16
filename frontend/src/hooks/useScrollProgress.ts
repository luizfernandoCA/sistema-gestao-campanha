'use client';
import { useEffect, useState } from 'react';

export function useScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const on = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      setP(total > 0 ? window.scrollY / total : 0);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return p;
}
