/**
 * Renders a proposal to PDF (requirement 11).
 *
 * Two versions come from one renderer:
 *   UNSIGNED — available before the insured decides.
 *   SIGNED   — the same document plus the signature and an e-signature
 *              certification page summarising the audit record.
 *
 * The signed version renders from the proposal's frozen `signedSnapshot`, so
 * regenerating it a year later produces the same document the insured agreed to.
 * That also means a stored copy is a convenience rather than the source of
 * truth — the PDF can always be rebuilt.
 */

import { rgb } from 'pdf-lib';
import { PdfWriter, hexToRgb, INK, MUTED, FAINT, toWinAnsi } from './layout';
import type { AssembledProposal } from '../assemble';
import { describeDevice } from '../signature';

export interface SignatureForPdf {
  signerName: string;
  signerTitle: string | null;
  signerEmail: string | null;
  signedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  proposalVersion: number;
  consentText: string | null;
  signatureType: 'TYPED' | 'DRAWN';
  signatureData: string;
  selectedOptionLabel: string | null;
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '-'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * Dates and times in this document are rendered in UTC explicitly.
 *
 * Without `timeZone: 'UTC'` these format in whatever zone the server happens to
 * run in, which on a certificate labelled "UTC" is simply a false statement —
 * and near midnight would name the wrong day entirely. A signature certificate
 * is evidence; its timestamps have to mean what they say.
 */
const longDate = (d: Date | string | null) => {
  if (!d) return '-';
  const date = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      });
};

export const exactTime = (d: Date) =>
  `${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} at ` +
  `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`;

/**
 * Embed the agency logo if it can be fetched quickly.
 *
 * Best-effort by design: the logo is decoration, and a slow or broken URL must
 * not fail a document the insured is waiting on. Only PNG and JPEG are
 * attempted, since those are what pdf-lib embeds.
 */
async function tryEmbedLogo(writer: PdfWriter, url: string | null): Promise<void> {
  if (!url) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return;

    const type = res.headers.get('content-type') ?? '';
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 2 * 1024 * 1024) return;

    const image = type.includes('png')
      ? await writer.doc.embedPng(bytes)
      : type.includes('jpeg') || type.includes('jpg')
        ? await writer.doc.embedJpg(bytes)
        : null;
    if (!image) return;

    const maxW = 130, maxH = 44;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const w = image.width * scale, h = image.height * scale;

    writer.ensure(h + 8);
    writer.page.drawImage(image, { x: writer.left, y: writer.y - h, width: w, height: h });
    writer.space(h + 8);
  } catch {
    // Logo unavailable — the agency name is drawn instead.
  }
}

/** Build the PDF. Pass a signature to produce the signed version. */
export async function buildProposalPdf(
  proposal: AssembledProposal,
  signature?: SignatureForPdf | null
): Promise<Uint8Array> {
  const writer = await PdfWriter.create();
  const primary = hexToRgb(proposal.branding.primaryColor, INK);
  const accent = hexToRgb(proposal.branding.secondaryColor, rgb(0, 0.9, 0.65));

  // ── Header ──
  await tryEmbedLogo(writer, proposal.preparedBy.logoUrl);
  if (!proposal.preparedBy.logoUrl) {
    writer.text(proposal.branding.agencyName, {
      font: writer.fonts.bold, size: 15, color: primary, lineHeight: 20,
    });
  }
  writer.space(4);
  writer.text(proposal.title, { font: writer.fonts.bold, size: 20, color: primary, lineHeight: 26 });

  if (signature) {
    writer.space(2);
    writer.text('SIGNED AND APPROVED', {
      font: writer.fonts.bold, size: 8, color: rgb(0.06, 0.62, 0.47), lineHeight: 12,
    });
  }
  writer.space(8);
  writer.rule();
  writer.space(8);

  // ── Prepared by / for ──
  const half = writer.width / 2;
  const topOfBlock = writer.y;

  writer.field('Prepared by', proposal.branding.agencyName, { x: writer.left, width: half - 12 });
  if (proposal.preparedBy.agentName) {
    writer.line(proposal.preparedBy.agentName, { size: 10, color: MUTED, maxWidth: half - 12 });
  }
  for (const contact of [proposal.preparedBy.phone, proposal.preparedBy.agentEmail ?? proposal.preparedBy.email]) {
    if (contact) writer.line(contact, { size: 9, color: MUTED, maxWidth: half - 12 });
  }
  const leftBottom = writer.y;

  // Right column, drawn from the same starting height.
  writer.y = topOfBlock;
  writer.field('Prepared for', proposal.preparedFor.insuredName, {
    x: writer.left + half, width: half,
  });
  writer.line(`Proposal date: ${longDate(proposal.preparedFor.proposalDate)}`, {
    size: 9, color: MUTED, x: writer.left + half, maxWidth: half,
  });
  if (proposal.preparedFor.effectiveDate) {
    writer.line(`Coverage starts: ${longDate(proposal.preparedFor.effectiveDate)}`, {
      size: 9, color: MUTED, x: writer.left + half, maxWidth: half,
    });
  }
  writer.y = Math.min(leftBottom, writer.y) - 10;

  if (proposal.clientMessage) {
    writer.rule();
    writer.space(6);
    writer.text(proposal.clientMessage, { size: 10, color: rgb(0.25, 0.3, 0.36), spaceAfter: 6 });
  }

  // ── Sections, in the order the agent arranged them ──
  for (const section of proposal.sections.filter((s) => s.enabled)) {
    switch (section.key) {
      case 'agencyHeader':
      case 'clientInformation':
        break; // Already rendered above.

      case 'recommendation': {
        if (!proposal.recommendation) break;
        writer.heading(section.title, primary);
        writer.text(proposal.recommendation.optionLabel, {
          font: writer.fonts.bold, size: 11, color: primary, lineHeight: 15,
        });
        if (proposal.recommendation.rationale) {
          writer.text(proposal.recommendation.rationale, { size: 10, color: rgb(0.2, 0.25, 0.31), spaceAfter: 4 });
        }
        break;
      }

      case 'quoteOptions': {
        writer.heading(section.title, primary);
        writer.table(
          ['Option', 'Carrier', 'Premium', 'Total / yr'],
          proposal.options.map((o) => [
            o.label + (o.isRecommended ? ' *' : ''),
            o.carrierName ?? '-',
            money(o.premiumAnnual),
            money(o.totalAnnual),
          ]),
          [0.3, 0.3, 0.2, 0.2],
          accent
        );
        if (proposal.options.some((o) => o.isRecommended)) {
          writer.text('* Recommended by your agent', { size: 8, color: FAINT, spaceAfter: 4 });
        }
        if (proposal.keyDifferences.length > 0) {
          writer.space(4);
          writer.text('Key differences', { font: writer.fonts.bold, size: 9, color: FAINT, lineHeight: 13 });
          for (const d of proposal.keyDifferences) {
            writer.text(`- ${d}`, { size: 9, color: rgb(0.3, 0.35, 0.41), lineHeight: 12 });
          }
          writer.space(4);
        }
        break;
      }

      case 'coverageBreakdown': {
        const withCoverages = proposal.options.filter((o) => o.coverages.length > 0);
        if (withCoverages.length === 0) break;
        writer.heading(section.title, primary);
        for (const option of withCoverages) {
          writer.ensure(40);
          writer.text(option.label, { font: writer.fonts.bold, size: 10, color: primary, lineHeight: 14 });
          for (const c of option.coverages) {
            writer.ensure(30);
            const detail = c.included
              ? [c.limit, c.deductible ? `${c.deductible} deductible` : null].filter(Boolean).join(' | ') || 'Included'
              : 'Not included';
            writer.text(`${c.name}  —  ${detail}`, {
              font: writer.fonts.bold, size: 9, color: INK, lineHeight: 13,
            });
            if (c.plainLanguage) writer.text(c.plainLanguage, { size: 9, color: rgb(0.3, 0.35, 0.41), lineHeight: 12 });
            if (c.whyItMatters) writer.text(c.whyItMatters, { size: 9, color: MUTED, lineHeight: 12 });
            if (c.differsFromOthers) {
              writer.text(c.differsFromOthers, { size: 9, color: MUTED, lineHeight: 12, x: writer.left + 10, width: writer.width - 10 });
            }
            writer.space(5);
          }
          writer.space(4);
        }
        break;
      }

      default: {
        const body = (section.body ?? '').trim();
        if (body === '') break;
        writer.heading(section.title, primary);
        writer.text(body, { size: 10, color: rgb(0.2, 0.25, 0.31), spaceAfter: 4 });
      }
    }
  }

  // ── Signature block ──
  if (signature) {
    writer.heading('Signature', primary);
    writer.space(2);

    if (signature.signatureType === 'DRAWN') {
      try {
        const base64 = signature.signatureData.split(',')[1] ?? '';
        const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
        const image = signature.signatureData.startsWith('data:image/png')
          ? await writer.doc.embedPng(bytes)
          : await writer.doc.embedJpg(bytes);
        const scale = Math.min(200 / image.width, 60 / image.height, 1);
        const w = image.width * scale, h = image.height * scale;
        writer.ensure(h + 6);
        writer.page.drawImage(image, { x: writer.left, y: writer.y - h, width: w, height: h });
        writer.space(h + 6);
      } catch {
        // A signature image that will not embed still has a complete audit
        // record below; the name and timestamp carry the evidence.
        writer.text('[signature image could not be rendered]', { size: 9, color: FAINT, lineHeight: 12 });
      }
    } else {
      writer.text(signature.signatureData, {
        font: writer.fonts.italic, size: 18, color: INK, lineHeight: 24,
      });
    }

    writer.page.drawLine({
      start: { x: writer.left, y: writer.y }, end: { x: writer.left + 220, y: writer.y },
      thickness: 0.75, color: rgb(0.7, 0.74, 0.78),
    });
    writer.space(10);
    writer.text(signature.signerName, { font: writer.fonts.bold, size: 10, lineHeight: 13 });
    if (signature.signerTitle) writer.text(signature.signerTitle, { size: 9, color: MUTED, lineHeight: 12 });
    writer.text(`Signed ${longDate(signature.signedAt)}`, { size: 9, color: MUTED, lineHeight: 12, spaceAfter: 4 });
  }

  // ── Disclaimer + footer text ──
  writer.space(6);
  writer.rule();
  writer.space(6);
  if (proposal.branding.footerText) {
    writer.text(proposal.branding.footerText, { size: 8, color: MUTED, lineHeight: 11, spaceAfter: 4 });
  }
  writer.text(proposal.disclaimer, { size: 7.5, color: FAINT, lineHeight: 10.5 });

  // ── Certification page (requirement 11) ──
  if (signature) {
    writer.breakPage();
    writer.text('Electronic Signature Certificate', {
      font: writer.fonts.bold, size: 16, color: primary, lineHeight: 22,
    });
    writer.text(
      'This page records the electronic signature applied to this proposal and the ' +
      'information captured at the time of signing.',
      { size: 9, color: MUTED, spaceAfter: 8 }
    );
    writer.rule();
    writer.space(8);

    const rows: [string, string][] = [
      ['Document', proposal.title],
      ['Proposal version', String(signature.proposalVersion)],
      ['Prepared for', proposal.preparedFor.insuredName],
      ['Prepared by', proposal.branding.agencyName],
      ['Option selected', signature.selectedOptionLabel ?? '-'],
      ['Signer name', signature.signerName],
      ['Signer title', signature.signerTitle ?? '-'],
      ['Signer email', signature.signerEmail ?? '-'],
      ['Signature method', signature.signatureType === 'DRAWN' ? 'Drawn' : 'Typed'],
      ['Date and time', exactTime(signature.signedAt)],
      ['IP address', signature.ipAddress ?? 'Not recorded'],
      ['Device', describeDevice(signature.userAgent)],
      ['Consent accepted', 'Yes'],
    ];
    for (const [label, value] of rows) writer.field(label, value);

    if (signature.consentText) {
      writer.space(6);
      writer.text('Consent agreed to by the signer', {
        font: writer.fonts.bold, size: 8, color: FAINT, lineHeight: 12,
      });
      writer.text(signature.consentText, { size: 8.5, color: rgb(0.25, 0.3, 0.36), lineHeight: 12 });
    }

    writer.space(10);
    writer.text(
      'This certificate is generated from the signature record stored with this proposal. ' +
      'The proposal content shown in this document was frozen at the moment of signing and ' +
      'cannot be altered afterwards.',
      { size: 8, color: FAINT, lineHeight: 11 }
    );
  }

  writer.finishFooters(
    `${toWinAnsi(proposal.branding.agencyName)} | ${toWinAnsi(proposal.preparedFor.insuredName)}` +
    (signature ? ' | Signed' : ''),
    accent
  );

  return writer.save();
}

/** Filename an insured or agent should see when downloading. */
export function proposalPdfFilename(proposal: AssembledProposal, signed: boolean): string {
  const base = `${proposal.preparedFor.insuredName} Proposal`
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${base}${signed ? '-Signed' : ''}.pdf`;
}
