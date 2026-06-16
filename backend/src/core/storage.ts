import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { env } from './env.js';
import { envelopeEncrypt, envelopeDecrypt, sha256 } from './crypto.js';

// Cliente S3/MinIO. Bucket privado (nunca público).
const s3 = new S3Client({
  endpoint: env.s3.endpoint,
  region: env.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: env.s3.accessKey, secretAccessKey: env.s3.secretKey },
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.s3.bucket }));
  }
}

export interface StoredFile {
  bucket: string;
  key: string;
  sha256: string;       // hash do conteúdo em CLARO (integridade)
  encryptedDataKey: string;
  keyId: string;
  size: number;
}

// Cifra (envelope) e grava o conteúdo. Retorna metadados p/ o banco.
export async function putEncrypted(key: string, plaintext: Buffer): Promise<StoredFile> {
  const hash = sha256(plaintext);
  const env_ = envelopeEncrypt(plaintext);
  await s3.send(new PutObjectCommand({
    Bucket: env.s3.bucket,
    Key: key,
    Body: env_.ciphertext,
    ContentType: 'application/octet-stream',
  }));
  return {
    bucket: env.s3.bucket,
    key,
    sha256: hash,
    encryptedDataKey: env_.encryptedDataKey,
    keyId: env_.keyId,
    size: plaintext.length,
  };
}

export async function getDecrypted(key: string, encryptedDataKey: string): Promise<Buffer> {
  const out = await s3.send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const c of out.Body as AsyncIterable<Buffer>) chunks.push(c);
  return envelopeDecrypt(Buffer.concat(chunks), encryptedDataKey);
}
