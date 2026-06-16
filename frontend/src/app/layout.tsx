import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Sistema de Gestão Documental de Campanha',
  description: 'Plataforma de cadeia de custódia documental, assinatura assistida e exportação contábil para campanhas eleitorais.',
  metadataBase: new URL('https://escritorio.e-negociosinteligentes.com.br'),
  openGraph: {
    title: 'Sistema de Gestão Documental de Campanha',
    description: 'Cadeia de custódia, assinatura eletrônica evidenciada e exportação contábil auditável.',
    locale: 'pt_BR',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
