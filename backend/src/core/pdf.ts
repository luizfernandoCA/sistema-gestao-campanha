import PDFDocument from 'pdfkit';

// Renderiza um PDF simples do contrato. Pluggable: a fonte da verdade é o
// snapshot + hash; o PDF é a representação visual.
export function renderContractPdf(opts: {
  title: string;
  candidate: string;
  worker: string;
  bodyText: string;
  signatures?: { who: string; at: string; hash: string }[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(opts.title, { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).fillColor('#555')
      .text(`Candidato: ${opts.candidate}`)
      .text(`Contratado(a): ${opts.worker}`)
      .text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`);
    doc.moveDown().fillColor('#000').fontSize(11);
    doc.text(opts.bodyText, { align: 'justify' });

    if (opts.signatures?.length) {
      doc.moveDown(2).fontSize(12).text('Assinaturas e evidências', { underline: true });
      doc.moveDown(0.5).fontSize(9).fillColor('#333');
      for (const s of opts.signatures) {
        doc.text(`• ${s.who} — ${s.at}`);
        doc.text(`  hash do documento: ${s.hash}`);
        doc.moveDown(0.3);
      }
    }
    doc.moveDown(2).fontSize(8).fillColor('#888')
      .text('Documento de demonstração. Assinatura eletrônica com pacote de evidências (Lei 14.063/2020).', { align: 'center' });
    doc.end();
  });
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
