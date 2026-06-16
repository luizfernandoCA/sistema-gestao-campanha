'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Files, Users, ShieldCheck, Plug, FileDown, FileUp, LogOut } from 'lucide-react';
import { auth } from '@/lib/api';

const items = [
  { href: '/painel',       label: 'Painel',       icon: LayoutDashboard },
  { href: '/documentos',   label: 'Documentos',   icon: Files },
  { href: '/candidatos',   label: 'Candidatos',   icon: Users },
  { href: '/auditoria',    label: 'Auditoria',    icon: ShieldCheck },
  { href: '/importacao',   label: 'Importação',   icon: FileUp },
  { href: '/exportacao',   label: 'Exportação',   icon: FileDown },
  { href: '/conexoes',     label: 'Conexões',     icon: Plug },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-64 shrink-0 border-r border-ink-200 bg-white/60 backdrop-blur-xl h-screen sticky top-0 flex flex-col">
      <div className="px-6 py-6 border-b border-ink-200">
        <Link href="/painel" className="font-semibold tracking-tight">
          Sistema · Campanha
        </Link>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((i) => {
          const active = pathname === i.href || pathname.startsWith(i.href + '/');
          return (
            <Link key={i.href} href={i.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                active ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100'
              }`}>
              <i.icon className="w-4 h-4" strokeWidth={2} />
              {i.label}
            </Link>
          );
        })}
      </nav>
      <button onClick={() => auth.logout()}
        className="m-3 flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-ink-600 hover:bg-ink-100 transition-colors">
        <LogOut className="w-4 h-4" strokeWidth={2} /> Sair
      </button>
    </aside>
  );
}
