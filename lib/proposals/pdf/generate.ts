/**
 * Produces the PDF for a proposal, from whichever source is correct for its
 * state, and archives the signed copy when storage is configured.
 *
 * Generation is on demand rather than at signing time. Because the signed
 * version renders from the frozen snapshot, rebuilding it always yields the same
 * document — so the archived copy in R2 is a convenience for the agency's
 * records, not the source of truth. That also means PDFs work before R2 is
 * configured; only archiving waits on it.
 */

import prisma from '../../prisma';
import type { Proposal } from '@prisma/client';
import { assembleProposal, type AssembledProposal } from '../assemble';
import { buildProposalPdf, proposalPdfFilename, type SignatureForPdf } from './proposalPdf';
import { isStorageConfigured, putObject } from '../../storage/r2';

export interface GeneratedPdf {
  bytes: Uint8Array;
  filename: string;
  signed: boolean;
}

/** Where an agency's signed proposals live in the bucket. */
export function signedPdfKey(agencyId: string, leadId: string, proposalId: string, version: number): string {
  return `agencies/${agencyId}/leads/${leadId}/proposals/${proposalId}-v${version}-signed.pdf`;
}

/**
 * Build the assembled document a PDF should render.
 *
 * A signed proposal renders from `signedSnapshot` — never re-assembled — so the
 * PDF matches what the insured agreed to even if the quotes have since changed.
 */
async function documentFor(proposal: Proposal): Promise<AssembledProposal | null> {
  if (proposal.lockedAt && proposal.signedSnapshot) {
    return proposal.signedSnapshot as unknown as AssembledProposal;
  }

  const [lead, agency, options, createdBy] = await Promise.all([
    prisma.lead.findUnique({ where: { id: proposal.leadId } }),
    prisma.agency.findUnique({ where: { id: proposal.agencyId } }),
    prisma.quoteOption.findMany({
      where: { leadId: proposal.leadId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    proposal.createdByUserId
      ? prisma.user.findUnique({
          where: { id: proposal.createdByUserId },
          select: { firstName: true, lastName: true, email: true },
        })
      : null,
  ]);
  if (!lead || !agency) return null;

  // The PDF goes to the insured, so it is built with the client audience —
  // internal notes and AI provenance are excluded by construction.
  return assembleProposal({ proposal, lead, agency, options, createdBy }, { audience: 'client' });
}

export async function generateProposalPdf(proposal: Proposal): Promise<GeneratedPdf | null> {
  const document = await documentFor(proposal);
  if (!document) return null;

  let signature: SignatureForPdf | null = null;
  if (proposal.lockedAt) {
    const record = await prisma.proposalSignature.findFirst({
      where: { proposalId: proposal.id },
      orderBy: { signedAt: 'desc' },
    });
    if (record) {
      const selected = record.selectedQuoteOptionId
        ? document.options.find((o) => o.id === record.selectedQuoteOptionId)
        : null;
      signature = {
        signerName: record.signerName,
        signerTitle: record.signerTitle,
        signerEmail: record.signerEmail,
        signedAt: record.signedAt,
        ipAddress: record.ipAddress,
        userAgent: record.userAgent,
        proposalVersion: record.proposalVersion,
        consentText: record.consentText,
        signatureType: record.signatureType,
        signatureData: record.signatureData,
        selectedOptionLabel: selected?.label ?? null,
      };
    }
  }

  const bytes = await buildProposalPdf(document, signature);
  const signed = Boolean(signature);

  // Archive the signed copy so the agency has it against the lead. Failure is
  // logged and swallowed: the download in the caller's hands still succeeds.
  if (signed && isStorageConfigured()) {
    const key = signedPdfKey(proposal.agencyId, proposal.leadId, proposal.id, proposal.version);
    await putObject({ key, body: bytes, contentType: 'application/pdf' }).catch((e) =>
      console.error('[proposal-pdf] archiving signed PDF failed:', key, e)
    );
  }

  return { bytes, filename: proposalPdfFilename(document, signed), signed };
}

/** Headers that make a browser download the file under the right name. */
export function pdfDownloadHeaders(filename: string, bytes: Uint8Array): HeadersInit {
  return {
    'Content-Type': 'application/pdf',
    // Quotes are stripped from the filename upstream, so this cannot break out
    // of the header value.
    'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
    'Content-Length': String(bytes.byteLength),
    // A proposal is private; no shared cache should hold a copy.
    'Cache-Control': 'private, no-store',
  };
}
