/**
 * Cloudflare R2 object storage.
 *
 * R2 speaks the S3 API, so the AWS SDK drives it unchanged — only the endpoint
 * and a fixed "auto" region differ. Two rules hold everywhere in this module:
 *
 *  1. The bucket is private. Nothing here ever returns a public URL; downloads
 *     go through short-lived presigned links minted after an authorisation
 *     check, so a leaked link expires and never crosses an agency boundary.
 *  2. Callers store the returned key, not a URL. Keys are stable, presigned
 *     URLs are not.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

/** How long a download link stays valid. Long enough to click, short enough to not matter if shared. */
const DOWNLOAD_URL_TTL_SECONDS = 300;

/** Carrier quotes arrive as PDFs, scans, or photos of a document. */
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15 MB

export class StorageNotConfiguredError extends Error {}

let client: S3Client | undefined;

/** True when every R2 variable is present. */
export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID?.trim() &&
    process.env.R2_ACCESS_KEY_ID?.trim() &&
    process.env.R2_SECRET_ACCESS_KEY?.trim() &&
    process.env.R2_BUCKET?.trim()
  );
}

function bucket(): string {
  const name = process.env.R2_BUCKET?.trim();
  if (!name) throw new StorageNotConfiguredError('R2_BUCKET is not set.');
  return name;
}

/**
 * Lazily built so the app boots fine without R2 configured — uploads then fail
 * with a clear message instead of the process dying at import time.
 */
function getClient(): S3Client {
  if (client) return client;
  if (!isStorageConfigured()) {
    throw new StorageNotConfiguredError(
      'File storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.'
    );
  }
  client = new S3Client({
    // R2 has no regions; the SDK still requires the field.
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID!.trim()}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
    },
  });
  return client;
}

/**
 * Strip anything that could escape the intended prefix or confuse a browser on
 * download. The original name is kept separately in the database for display,
 * so mangling here costs nothing.
 */
function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_{2,}/g, '_');
  return cleaned.slice(0, 120) || 'file';
}

/**
 * Build the object key for a quote option's document.
 *
 * The agency id leads the prefix so a bucket listing is segmented by tenant, and
 * a UUID keeps two uploads of "quote.pdf" from colliding.
 */
export function quoteDocumentKey(agencyId: string, quoteOptionId: string, filename: string): string {
  return `agencies/${agencyId}/quote-options/${quoteOptionId}/${randomUUID()}-${safeFilename(filename)}`;
}

export async function putObject(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );
}

/**
 * A time-limited download link.
 *
 * `downloadName` sets Content-Disposition so the browser saves the file under
 * the name the agent uploaded rather than the UUID-prefixed key.
 */
export async function getDownloadUrl(key: string, downloadName?: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: key,
    ...(downloadName
      ? { ResponseContentDisposition: `attachment; filename="${safeFilename(downloadName)}"` }
      : {}),
  });
  return getSignedUrl(getClient(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

/** Delete is best-effort: a missing object is already the desired state. */
export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
