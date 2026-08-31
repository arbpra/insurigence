/**
 * Agency branding and the proposal disclaimer.
 *
 * Both follow the same rule: the platform holds a default, an agency may
 * override it, and what a proposal was *sent* with is frozen onto the proposal.
 * That last part matters — a proposal an insured signed must keep the disclaimer
 * it carried at the time, even if the agency edits theirs the following week.
 */

/** Platform defaults. Used when an agency has set nothing of its own. */
export const DEFAULT_BRAND_PRIMARY = '#0D2137';
export const DEFAULT_BRAND_SECONDARY = '#00E6A7';

/**
 * The default proposal disclaimer, supplied verbatim by the client.
 *
 * Super Admin maintains this default; agencies may customise their own copy.
 * Do not reword it without instruction — it is a legal notice, not marketing.
 */
export const DEFAULT_PROPOSAL_DISCLAIMER =
  'This proposal is provided for informational purposes and is based on the insurance ' +
  'quotations and information available at the time of preparation. It is not an insurance ' +
  'policy, binder, or guarantee of coverage. Coverage is subject to the terms, conditions, ' +
  'limitations, exclusions, and underwriting requirements of the issuing insurance carrier. ' +
  'Please review all policy documents carefully. Final coverage is not effective until ' +
  'confirmed and bound by the appropriate insurance carrier or authorized insurance professional.';

/** A hex colour, or null if the value cannot be trusted in a style attribute. */
export function safeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Anchored 3- or 6-digit hex only. Anything else is rejected rather than
  // sanitised — these values are interpolated into inline styles and a
  // permissive parser here would be an injection route.
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed) ? trimmed : null;
}

export interface AgencyBrandingInput {
  name: string;
  logoUrl?: string | null;
  brandPrimaryColor?: string | null;
  brandSecondaryColor?: string | null;
  proposalFooterText?: string | null;
  proposalDisclaimerText?: string | null;
  phone?: string | null;
  primaryEmail?: string | null;
  website?: string | null;
}

export interface ResolvedBranding {
  agencyName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  footerText: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

/** Fill agency branding in from platform defaults, rejecting unusable colours. */
export function resolveBranding(agency: AgencyBrandingInput): ResolvedBranding {
  return {
    agencyName: agency.name,
    logoUrl: typeof agency.logoUrl === 'string' && agency.logoUrl.trim() !== '' ? agency.logoUrl : null,
    primaryColor: safeHexColor(agency.brandPrimaryColor) ?? DEFAULT_BRAND_PRIMARY,
    secondaryColor: safeHexColor(agency.brandSecondaryColor) ?? DEFAULT_BRAND_SECONDARY,
    footerText: agency.proposalFooterText?.trim() || null,
    phone: agency.phone?.trim() || null,
    email: agency.primaryEmail?.trim() || null,
    website: agency.website?.trim() || null,
  };
}

/**
 * The disclaimer a proposal should carry.
 *
 * `frozen` is the text already stored on a sent proposal. Once set it always
 * wins: the disclaimer shown to an insured must never change retroactively.
 */
export function resolveDisclaimer(
  agencyDisclaimer: string | null | undefined,
  frozen?: string | null
): string {
  if (frozen && frozen.trim() !== '') return frozen;
  if (agencyDisclaimer && agencyDisclaimer.trim() !== '') return agencyDisclaimer.trim();
  return DEFAULT_PROPOSAL_DISCLAIMER;
}
