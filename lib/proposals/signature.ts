/**
 * Electronic signature capture and validation (requirement 9).
 *
 * The evidence a signature needs is not the image — it is the record of intent:
 * who signed, what exactly they were shown, that they consented to sign
 * electronically, and from where and when. Everything here exists to make that
 * record complete and unalterable after the fact.
 *
 * NOTE ON SCOPE: this implements the specification's own V1 signature — typed or
 * drawn, with an audit record. It is not a certified e-signature service. If the
 * client requires DocuSign-grade certification, that is a different build.
 */

export class SignatureValidationError extends Error {}

const MAX_NAME = 200;
const MAX_TITLE = 200;
const MAX_TYPED_SIGNATURE = 200;
/** A drawn signature is a PNG data URL. 2 MB is far more than a canvas produces. */
const MAX_DRAWN_BYTES = 2 * 1024 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The consent wording shown at signing, stored verbatim on every signature.
 *
 * Stored rather than referenced because consent is to *these words*: if the
 * wording is ever revised, a signature must still evidence what that signer
 * actually agreed to.
 */
export const ESIGN_CONSENT_TEXT =
  'By signing below, I agree to use electronic records and electronic signatures for this ' +
  'proposal, and I agree that my electronic signature has the same legal effect as a handwritten ' +
  'signature. I confirm I have reviewed the option I selected and the information presented in ' +
  'this proposal. I understand this proposal is not an insurance policy or binder, and that ' +
  'coverage is not in force until confirmed and bound by the insurance carrier.';

export type SignatureType = 'TYPED' | 'DRAWN';

export interface SignatureInput {
  signerName: string;
  signerTitle: string | null;
  signerEmail: string | null;
  signatureType: SignatureType;
  signatureData: string;
  consentAccepted: boolean;
}

/**
 * A drawn signature arrives as a data URL that will be rendered back into the
 * proposal and the PDF. Only PNG/JPEG image data URLs are accepted — anything
 * else (an SVG carrying script, an HTML data URL) is rejected outright rather
 * than sanitised, because there is no legitimate reason for it to be here.
 */
function validateDrawnSignature(data: string): void {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) {
    throw new SignatureValidationError('That signature image is not in a supported format.');
  }
  // base64 encodes 3 bytes per 4 characters.
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > MAX_DRAWN_BYTES) {
    throw new SignatureValidationError('That signature image is too large.');
  }
  if (bytes < 100) {
    throw new SignatureValidationError('Please draw your signature before continuing.');
  }
}

export function parseSignatureInput(body: Record<string, unknown>): SignatureInput {
  const name = typeof body.signerName === 'string' ? body.signerName.trim() : '';
  if (name === '') throw new SignatureValidationError('Please enter your full legal name.');
  if (name.length > MAX_NAME) throw new SignatureValidationError('That name is too long.');

  const type = body.signatureType === 'DRAWN' ? 'DRAWN' : 'TYPED';
  const data = typeof body.signatureData === 'string' ? body.signatureData.trim() : '';
  if (data === '') throw new SignatureValidationError('Please provide your signature.');

  if (type === 'DRAWN') {
    validateDrawnSignature(data);
  } else {
    if (data.length > MAX_TYPED_SIGNATURE) {
      throw new SignatureValidationError('That signature is too long.');
    }
    // A typed signature is the signer asserting their own name. Requiring the
    // two to match is what makes the typed form meaningful rather than a
    // free-text box that happens to sit near a name field.
    if (data.toLowerCase().replace(/\s+/g, ' ') !== name.toLowerCase().replace(/\s+/g, ' ')) {
      throw new SignatureValidationError(
        'Your typed signature must match your full legal name exactly.'
      );
    }
  }

  const title = typeof body.signerTitle === 'string' && body.signerTitle.trim() !== ''
    ? body.signerTitle.trim().slice(0, MAX_TITLE)
    : null;

  const email = typeof body.signerEmail === 'string' && body.signerEmail.trim() !== ''
    ? body.signerEmail.trim().toLowerCase()
    : null;
  if (email && !EMAIL_RE.test(email)) {
    throw new SignatureValidationError('That email address is not valid.');
  }

  // Consent is the legal basis for the whole signature. Without it there is
  // nothing to record.
  if (body.consentAccepted !== true) {
    throw new SignatureValidationError(
      'Please tick the box to agree to sign electronically.'
    );
  }

  return {
    signerName: name,
    signerTitle: title,
    signerEmail: email,
    signatureType: type,
    signatureData: data,
    consentAccepted: true,
  };
}

/**
 * The audit summary rendered on the signed proposal and the PDF certification
 * page. Everything here is drawn from the stored signature record, never
 * recomputed, so it reflects the moment of signing.
 */
export interface SignatureAudit {
  signerName: string;
  signerTitle: string | null;
  signerEmail: string | null;
  signedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  proposalVersion: number;
  selectedOptionLabel: string | null;
  consentText: string | null;
  signatureType: SignatureType;
}

/** Shorten a user-agent string for display without losing what it identifies. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser =
    /Edg\//.test(userAgent) ? 'Edge' :
    /Chrome\//.test(userAgent) ? 'Chrome' :
    /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent) ? 'Safari' :
    /Firefox\//.test(userAgent) ? 'Firefox' : 'Browser';
  const os =
    /iPhone|iPad|iOS/.test(userAgent) ? 'iOS' :
    /Android/.test(userAgent) ? 'Android' :
    /Mac OS X|Macintosh/.test(userAgent) ? 'macOS' :
    /Windows/.test(userAgent) ? 'Windows' :
    /Linux/.test(userAgent) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}
