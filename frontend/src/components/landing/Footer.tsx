export function Footer() {
  return (
    <footer className="border-t border-ink-200">
      <div className="container mx-auto px-6 py-12 flex flex-wrap items-center justify-between gap-6">
        <div className="text-sm text-ink-500">
          © {new Date().getFullYear()} Sistema de Gestão Documental de Campanha.
          Construído pelo Nemesis ONDA Foundry.
        </div>
        <div className="flex gap-6 text-sm text-ink-500">
          <a href="/api/openapi.json" className="hover:text-ink-900">OpenAPI</a>
          <a href="https://github.com/luizfernandoCA/sistema-gestao-campanha" className="hover:text-ink-900">Código-fonte</a>
        </div>
      </div>
    </footer>
  );
}
