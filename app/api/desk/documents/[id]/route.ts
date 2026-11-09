import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deskAccessResponse } from '@/lib/desk/access';
import { deskUserRequest } from '@/lib/desk/admin-api';
import { openTaskDocument, removeTaskDocument } from '@/lib/desk/task-documents';

type Context = { params: Promise<{ id: string }> };

/**
 * Opens a document: ?view=1 shows a PDF or image in the browser, otherwise it
 * downloads. A redirect, not JSON, so the short-lived link never sits in a page
 * where it could be copied.
 */
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    const url = await openTaskDocument(prisma, scope, id, { view: request.nextUrl.searchParams.get('view') === '1' }, ctx);
    const res = NextResponse.redirect(url, 302);
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('Referrer-Policy', 'no-referrer');
    return res;
  } catch (err) {
    return deskAccessResponse(err);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const { scope, ctx } = await deskUserRequest(prisma, request);
    return NextResponse.json(await removeTaskDocument(prisma, scope, id, ctx));
  } catch (err) {
    return deskAccessResponse(err);
  }
}
