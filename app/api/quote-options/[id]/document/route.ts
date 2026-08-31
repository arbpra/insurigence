import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import {
  putObject,
  getDownloadUrl,
  deleteObject,
  quoteDocumentKey,
  isStorageConfigured,
  StorageNotConfiguredError,
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
} from '@/lib/storage/r2';

/**
 * The carrier's quote document attached to a quote option.
 *
 * POST   → upload (replaces any existing document)
 * GET    → redirect to a short-lived presigned download URL
 * DELETE → remove the file and clear the fields
 *
 * The bucket is private. Every download is authorised here first and only then
 * presigned, so a document is never reachable by URL alone and never crosses an
 * agency boundary.
 */

/** Cross-agency access returns 404 — a 403 would confirm the id exists. */
async function authorizeOption(request: NextRequest, optionId: string) {
  const auth = await getAuthContext(request);
  if (!auth.valid || !auth.user) return { error: auth.response! };

  const option = await prisma.quoteOption.findUnique({ where: { id: optionId } });
  if (!option) {
    return { error: NextResponse.json({ error: 'Quote option not found' }, { status: 404 }) };
  }
  if (auth.user.role !== 'SUPER_ADMIN' && option.agencyId !== auth.user.agencyId) {
    return { error: NextResponse.json({ error: 'Quote option not found' }, { status: 404 }) };
  }
  return { option, user: auth.user };
}

function storageUnavailable(err: unknown) {
  if (err instanceof StorageNotConfiguredError) {
    console.error('[quote-document]', err.message);
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 });
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { option, error } = await authorizeOption(request, id);
    if (error) return error;

    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Expected a multipart form upload' }, { status: 400 });
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was provided' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'The file is empty' }, { status: 400 });
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      return NextResponse.json(
        { error: `File must be ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB or smaller` },
        { status: 400 }
      );
    }
    if (!ALLOWED_DOCUMENT_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_TYPES)[number])) {
      return NextResponse.json(
        { error: 'Upload a PDF, Word document, or image' },
        { status: 400 }
      );
    }

    const key = quoteDocumentKey(option!.agencyId, option!.id, file.name);
    const body = Buffer.from(await file.arrayBuffer());
    await putObject({ key, body, contentType: file.type });

    // Replacing a document: drop the old object once the new one is safely
    // stored, so a failed upload never leaves the option with nothing.
    const previousKey = option!.documentKey;

    const updated = await prisma.quoteOption.update({
      where: { id: option!.id },
      data: {
        documentKey: key,
        documentName: file.name.slice(0, 500),
        documentSize: file.size,
        documentContentType: file.type,
        documentUploadedAt: new Date(),
      },
      select: {
        documentName: true, documentSize: true,
        documentContentType: true, documentUploadedAt: true,
      },
    });

    if (previousKey && previousKey !== key) {
      // Orphaning a file is a smaller problem than failing the request.
      await deleteObject(previousKey).catch((e) =>
        console.error('[quote-document] could not remove replaced object:', previousKey, e)
      );
    }

    return NextResponse.json({
      document: {
        name: updated.documentName,
        size: updated.documentSize,
        contentType: updated.documentContentType,
        uploadedAt: updated.documentUploadedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    const unavailable = storageUnavailable(err);
    if (unavailable) return unavailable;
    console.error('[quote-document] POST failed:', err);
    return NextResponse.json({ error: 'Could not upload the document' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { option, error } = await authorizeOption(request, id);
    if (error) return error;

    if (!option!.documentKey) {
      return NextResponse.json({ error: 'No document on this quote option' }, { status: 404 });
    }

    const url = await getDownloadUrl(option!.documentKey, option!.documentName ?? undefined);

    // 302 rather than returning the URL as JSON: the link is short-lived and
    // should not sit in client state where it can be copied or cached.
    return NextResponse.redirect(url, 302);
  } catch (err) {
    const unavailable = storageUnavailable(err);
    if (unavailable) return unavailable;
    console.error('[quote-document] GET failed:', err);
    return NextResponse.json({ error: 'Could not prepare the download' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { option, error } = await authorizeOption(request, id);
    if (error) return error;

    if (!option!.documentKey) {
      return NextResponse.json({ success: true });
    }

    // Clear the reference first. If the object delete fails we leave an orphan
    // in the bucket, which is recoverable; the reverse would leave the UI
    // pointing at a file that no longer exists.
    await prisma.quoteOption.update({
      where: { id: option!.id },
      data: {
        documentKey: null, documentName: null, documentSize: null,
        documentContentType: null, documentUploadedAt: null,
      },
    });

    await deleteObject(option!.documentKey).catch((e) =>
      console.error('[quote-document] could not remove object:', option!.documentKey, e)
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    const unavailable = storageUnavailable(err);
    if (unavailable) return unavailable;
    console.error('[quote-document] DELETE failed:', err);
    return NextResponse.json({ error: 'Could not remove the document' }, { status: 500 });
  }
}
