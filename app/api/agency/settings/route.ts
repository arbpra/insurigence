import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getAuthContext } from '@/lib/super-admin-auth';
import {
  safeHexColor,
  DEFAULT_PROPOSAL_DISCLAIMER,
} from '@/lib/proposals/branding';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const user = auth.user;
    
    if (!user.agencyId && user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'No agency assigned' }, { status: 403 });
    }

    const agencyId = user.agencyId || request.nextUrl.searchParams.get('agencyId');
    
    if (!agencyId) {
      return NextResponse.json({ error: 'Agency not configured' }, { status: 400 });
    }

    if (user.role !== 'SUPER_ADMIN' && user.agencyId !== agencyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: {
        id: true,
        name: true,
        riskTolerance: true,
        allowedMarkets: true,
        esRecommendationsEnabled: true,
        placementNotes: true,
        subscriptionTier: true,
        status: true,
        // Proposal branding + disclaimer
        logoUrl: true,
        brandPrimaryColor: true,
        brandSecondaryColor: true,
        proposalFooterText: true,
        proposalDisclaimerText: true,
        phone: true,
        primaryEmail: true,
        website: true,
      },
    });

    if (!agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
    }

    return NextResponse.json({
      agency,
      // So the settings screen can show what applies when the agency sets nothing.
      defaultDisclaimer: DEFAULT_PROPOSAL_DISCLAIMER,
    });
  } catch (error) {
    console.error('Error fetching agency settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthContext(request);
    if (!auth.valid || !auth.user) return auth.response!;

    const user = auth.user;
    
    if (!user.agencyId && user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'No agency assigned' }, { status: 403 });
    }

    const agencyId = user.agencyId || request.nextUrl.searchParams.get('agencyId');
    
    if (!agencyId) {
      return NextResponse.json({ error: 'Agency not configured' }, { status: 400 });
    }

    if (user.role !== 'SUPER_ADMIN' && user.agencyId !== agencyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (user.role === 'AGENT') {
      return NextResponse.json({ error: 'Only admins can update settings' }, { status: 403 });
    }

    const body = await request.json();
    const {
      riskTolerance,
      esRecommendationsEnabled,
      placementNotes,
      logoUrl,
      brandPrimaryColor,
      brandSecondaryColor,
      proposalFooterText,
      proposalDisclaimerText,
      phone,
      primaryEmail,
      website,
    } = body;

    // Colours are interpolated into inline styles on the client-facing proposal,
    // so anything that is not a plain hex value is rejected rather than stored.
    for (const [label, value] of [
      ['Primary colour', brandPrimaryColor],
      ['Secondary colour', brandSecondaryColor],
    ] as const) {
      if (value !== undefined && value !== null && value !== '' && !safeHexColor(value)) {
        return NextResponse.json(
          { error: `${label} must be a hex colour such as #0D2137` },
          { status: 400 }
        );
      }
    }

    /** Empty string clears the override and restores the platform default. */
    const orNull = (v: unknown) =>
      v === null || (typeof v === 'string' && v.trim() === '') ? null : v;

    const agency = await prisma.agency.update({
      where: { id: agencyId },
      data: {
        ...(riskTolerance !== undefined && { riskTolerance }),
        ...(esRecommendationsEnabled !== undefined && { esRecommendationsEnabled }),
        ...(placementNotes !== undefined && { placementNotes }),
        ...(logoUrl !== undefined && { logoUrl: orNull(logoUrl) as string | null }),
        ...(brandPrimaryColor !== undefined && { brandPrimaryColor: orNull(brandPrimaryColor) as string | null }),
        ...(brandSecondaryColor !== undefined && { brandSecondaryColor: orNull(brandSecondaryColor) as string | null }),
        ...(proposalFooterText !== undefined && { proposalFooterText: orNull(proposalFooterText) as string | null }),
        ...(proposalDisclaimerText !== undefined && { proposalDisclaimerText: orNull(proposalDisclaimerText) as string | null }),
        ...(phone !== undefined && { phone: orNull(phone) as string | null }),
        ...(primaryEmail !== undefined && { primaryEmail: orNull(primaryEmail) as string | null }),
        ...(website !== undefined && { website: orNull(website) as string | null }),
      },
      select: {
        id: true,
        name: true,
        riskTolerance: true,
        allowedMarkets: true,
        esRecommendationsEnabled: true,
        placementNotes: true,
        subscriptionTier: true,
        status: true,
        // Proposal branding + disclaimer
        logoUrl: true,
        brandPrimaryColor: true,
        brandSecondaryColor: true,
        proposalFooterText: true,
        proposalDisclaimerText: true,
        phone: true,
        primaryEmail: true,
        website: true,
      },
    });

    return NextResponse.json({ agency });
  } catch (error) {
    console.error('Error updating agency settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
