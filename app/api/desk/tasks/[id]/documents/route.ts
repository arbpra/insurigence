import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { MAX_DOCUMENT_BYTES } from '@/lib/desk/document-files';
import { addTaskDocument, documentTarget } from '@/lib/desk/task-documents';

type Context = { params: Promise<{ id: string }> };

/** Room for the form's own fields around the file. */
const FORM_OVERHEAD = 64 * 1024;

/** Multipart form: file, sensitivity (GENERAL | POLICY | FINANCIAL | PERSONAL), and for staff visibility (INTERNAL | AGENCY). One file per call. */
export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    // Who is asking, and the size, come first, so nobody can make the server read a large body for nothing.
    await documentTarget(prisma, scope, id, ctx);
    const sent = Number(request.headers.get('content-length') ?? 0);
    if (sent > MAX_DOCUMENT_BYTES + FORM_OVERHEAD) {
      throw new DeskAccessError(400, `Files can be up to ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.`, 'TOO_LARGE');
    }
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File)) throw new DeskAccessError(400, 'Choose a file to attach.');
    const doc = await addTaskDocument(prisma, scope, id, {
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      sensitivity: form.get('sensitivity'),
      visibility: form.get('visibility') ?? undefined,
    }, ctx);
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
