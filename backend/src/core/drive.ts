import { env } from './env.js';
import { sha256 } from './crypto.js';

// Espelhamento do PDF FINALIZADO no Google Drive — destino ADICIONAL.
// O storage S3/MinIO cifrado continua sendo a FONTE DA VERDADE; o Drive é só
// uma cópia de conveniência por candidato. Por isso uma falha aqui nunca deve
// desfazer a finalização (ver routes/app.ts: o push roda em try/catch e o
// resultado é registrado no ledger, sucesso ou falha).
//
// Dois modos (env DRIVE_MODE):
//   - 'log'    (padrão): adaptador MOCK — não chama o Google. Apenas registra a
//              intenção (log + retorno determinístico). Use até ligar a credencial.
//   - 'google' : empurra de verdade. Exige GOOGLE_SA_JSON_B64 (JSON da service
//              account em base64) + GDRIVE_ROOT_FOLDER_ID. Ainda NÃO implementado:
//              lança erro orientando a configuração (a finalização é mantida).

export interface DrivePushInput {
  candidateId: string;
  candidateName: string;
  documentId: string;
  filename: string;
  content: Buffer;
}

export interface DrivePushResult {
  provider: 'LOG' | 'GOOGLE_DRIVE';
  status: 'MOCK_LOGADO' | 'ENVIADO';
  folder: string;        // pasta lógica por candidato (no Drive real, o caminho/ID)
  fileRef: string;       // id/ref do arquivo no destino
  contentSha256: string; // integridade do que foi (ou seria) enviado
  bytes: number;
}

// Logger opcional (compatível com o pino do Fastify: req.log).
export interface DriveLogger { info: (o: unknown, msg?: string) => void; }

// Nome da pasta por candidato. No Drive real vira a pasta de destino.
function folderForCandidate(input: DrivePushInput): string {
  return `Candidato — ${input.candidateName} (${input.candidateId})`;
}

export async function pushDocumentToDrive(input: DrivePushInput, logger?: DriveLogger): Promise<DrivePushResult> {
  const contentSha256 = sha256(input.content);
  const folder = folderForCandidate(input);

  if (env.drive.mode === 'google') {
    // TODO(produção): implementar com googleapis + service account.
    //   1) carregar credencial de GOOGLE_SA_JSON_B64 (base64 do JSON da SA);
    //   2) garantir/buscar subpasta do candidato sob GDRIVE_ROOT_FOLDER_ID
    //      (a pasta raiz precisa estar COMPARTILHADA com o e-mail da SA);
    //   3) files.create (multipart) com o PDF e devolver o fileId real.
    if (!env.drive.saJsonB64 || !env.drive.rootFolderId) {
      throw new Error('DRIVE_MODE=google: defina GOOGLE_SA_JSON_B64 e GDRIVE_ROOT_FOLDER_ID');
    }
    throw new Error('DRIVE_MODE=google ainda não implementado — credencial pronta, falta a integração real');
  }

  // Modo mock/log: sem rede. Retorno determinístico (rastreável no ledger e em teste).
  const result: DrivePushResult = {
    provider: 'LOG',
    status: 'MOCK_LOGADO',
    folder,
    fileRef: 'mock-' + contentSha256.slice(0, 16),
    contentSha256,
    bytes: input.content.length,
  };
  logger?.info({ drive: result, documentId: input.documentId }, 'drive: push (mock/log)');
  return result;
}
