import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateSuperAdmin } from '@/lib/super-admin-auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = './uploads/appetite-guides';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; carrierId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { carrierId } = await params;

    const guides = await prisma.appetiteGuide.findMany({
      where: { carrierId },
      orderBy: { uploadedAt: 'desc' },
    });

    return NextResponse.json({ guides });
  } catch (error) {
    console.error('Error fetching appetite guides:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; carrierId: string }> }
) {
  const auth = await validateSuperAdmin(request);
  if (!auth.valid) return auth.response!;

  try {
    const { carrierId } = await params;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const notes = formData.get('notes') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Only PDF and Word documents are allowed' },
        { status: 400 }
      );
    }

    await mkdir(UPLOAD_DIR, { recursive: true });

    const timestamp = Date.now();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${carrierId}_${timestamp}_${safeFileName}`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const guide = await prisma.appetiteGuide.create({
      data: {
        carrierId,
        fileName: file.name,
        fileUrl: `/uploads/appetite-guides/${fileName}`,
        fileSize: file.size,
        mimeType: file.type,
        notes: notes || null,
      },
    });

    return NextResponse.json({ guide }, { status: 201 });
  } catch (error) {
    console.error('Error uploading appetite guide:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
