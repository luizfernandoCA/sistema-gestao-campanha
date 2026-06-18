'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/chrome/Sidebar';
import { auth } from '@/lib/api';

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => { if (!auth.isAuthed()) router.replace('/login'); }, [router]);
  return (
    <div className="min-h-screen flex bg-ink-50">
      <Sidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
