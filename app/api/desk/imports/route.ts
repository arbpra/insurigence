import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse, DeskAccessError } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { MAX_IMPORT_BYTES } from '@/lib/desk/import-headers';
import { importAgency, listImports, logImportRejected, stageImport } from '@/lib/desk/imports';

const TOO_LARGE = `Files can be up to ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Split this one into smaller files.`;
/** Room for the form's own fields around the file. */
const FORM_OVERHEAD = 64 * 1024;

const formText = (value: FormDataEntryValue | null) => (typeof value === 'string' && value.trim() ? value.trim() : null);

export async function GET(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await listImports(prisma, scope, { agencyId: request.nextUrl.searchParams.get('agencyId') }, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}

/** Multipart form: file, and optionally sheet. Insurigence admins name the agency with ?agencyId. */
export async function POST(request: NextRequest) {
  try {
    const { scope, ctx } = await deskUserRequest(prisma, request);
    // Who is asking and how big it is come first, so nobody can make the server read a large body for nothing.
    const requestedAgency = request.nextUrl.searchParams.get('agencyId');
    const agencyId = await importAgency(prisma, scope, requestedAgency, ctx);
    const sent = Number(request.headers.get('content-length') ?? 0);
    if (sent > MAX_IMPORT_BYTES + FORM_OVERHEAD) {
      await logImportRejected(prisma, scope, agencyId, 'TOO_LARGE', sent, ctx);
      throw new DeskAccessError(400, TOO_LARGE, 'TOO_LARGE');
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File)) throw new DeskAccessError(400, 'Choose a file to upload.');

    const saved = await stageImport(prisma, scope, {
      fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), sheet: formText(form.get('sheet')), agencyId: requestedAgency,
    }, ctx);
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    return deskAccessResponse(err);
  }
}
