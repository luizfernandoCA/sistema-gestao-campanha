'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Me { name: string; role: string; }

export function Topbar({ title }: { title: string }) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { api<Me>('/api/me').then(setMe).catch(() => {}); }, []);
  return (
    <header className="h-16 border-b border-ink-200 bg-white/60 backdrop-blur-xl flex items-center justify-between px-8 sticky top-0 z-30">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {me && (
        <div className="flex items-center gap-3">
          <span className="badge badge-blue text-xs">{me.role.replaceAll('_', ' ')}</span>
          <span className="text-sm text-ink-700">{me.name}</span>
          <div className="w-9 h-9 rounded-full bg-ink-900 text-white text-sm font-medium flex items-center justify-center">
            {me.name.slice(0, 1).toUpperCase()}
          </div>
        </div>
      )}
    </header>
  );
}
