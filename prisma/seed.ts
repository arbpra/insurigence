import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Get or create demo agency
  let agency = await prisma.agency.findFirst({
    where: { name: 'Acme Insurance Agency' },
  });
  if (!agency) {
    agency = await prisma.agency.create({
      data: {
        name: 'Acme Insurance Agency',
        primaryEmail: 'contact@acmeinsurance.com',
        phone: '(555) 123-4567',
        website: 'https://acmeinsurance.com',
        brandPrimaryColor: '#1e40af',
        brandSecondaryColor: '#3b82f6',
        proposalFooterText: 'Thank you for choosing Acme Insurance Agency',
      },
    });
  }
  console.log(`Created/found agency: ${agency.name} (ID: ${agency.id})`);

  // 2. Get or create Commercial GL intake form
  let intakeForm = await prisma.intakeForm.findFirst({
    where: { agencyId: agency.id, name: 'Commercial General Liability Application' },
  });
  if (!intakeForm) {
    intakeForm = await prisma.intakeForm.create({
      data: {
        agencyId: agency.id,
        lob: 'COMMERCIAL_GL',
        name: 'Commercial General Liability Application',
        isActive: true,
        definition: {
          version: '1.0',
          sections: [
            {
              id: 'business_info',
              title: 'Business Information',
              fields: [
                { id: 'companyName', type: 'text', label: 'Company Name', required: true },
                { id: 'yearsInBusiness', type: 'number', label: 'Years in Business', required: true },
                { id: 'industry', type: 'select', label: 'Industry', required: true, options: [
                  'construction', 'manufacturing', 'retail', 'professional_services', 'hospitality', 'healthcare', 'technology', 'other'
                ]},
                { id: 'annualRevenue', type: 'currency', label: 'Annual Revenue', required: true },
                { id: 'numberOfEmployees', type: 'number', label: 'Number of Employees', required: true },
              ],
            },
            {
              id: 'coverage_info',
              title: 'Coverage Information',
              fields: [
                { id: 'requestedLimits', type: 'select', label: 'Requested Limits', required: true, options: [
                  '500000', '1000000', '2000000', '5000000'
                ]},
                { id: 'effectiveDate', type: 'date', label: 'Requested Effective Date', required: true },
                { id: 'priorClaims', type: 'boolean', label: 'Any claims in the past 5 years?', required: true },
                { id: 'priorClaimsDetails', type: 'textarea', label: 'Claims Details', required: false, showIf: { field: 'priorClaims', value: true }},
              ],
            },
            {
              id: 'contact_info',
              title: 'Contact Information',
              fields: [
                { id: 'contactName', type: 'text', label: 'Contact Name', required: true },
                { id: 'contactEmail', type: 'email', label: 'Contact Email', required: true },
                { id: 'contactPhone', type: 'phone', label: 'Contact Phone', required: true },
                { id: 'additionalNotes', type: 'textarea', label: 'Additional Notes', required: false },
              ],
            },
          ],
        },
      },
    });
  }
  console.log(`Created/found intake form: ${intakeForm.name}`);

  // 3. Get or create two carriers (one standard, one E&S)
  let standardCarrier = await prisma.carrier.findFirst({
    where: { agencyId: agency.id, name: 'Nationwide Insurance' },
  });
  if (!standardCarrier) {
    standardCarrier = await prisma.carrier.create({
      data: {
        agencyId: agency.id,
        name: 'Nationwide Insurance',
        notes: 'Standard market carrier with broad appetite for commercial GL',
        isActive: true,
      },
    });
  }
  console.log(`Created/found carrier: ${standardCarrier.name} (Standard Market)`);

  let esCarrier = await prisma.carrier.findFirst({
    where: { agencyId: agency.id, name: 'Lexington Insurance (AIG)' },
  });
  if (!esCarrier) {
    esCarrier = await prisma.carrier.create({
      data: {
        agencyId: agency.id,
        name: 'Lexington Insurance (AIG)',
        notes: 'Excess & Surplus lines carrier for hard-to-place risks',
        isActive: true,
      },
    });
  }
  console.log(`Created/found carrier: ${esCarrier.name} (E&S Market)`);

  // 4. Get or create appetite rules for both carriers
  let standardAppetiteRule = await prisma.carrierAppetiteRule.findFirst({
    where: { carrierId: standardCarrier.id, lob: 'COMMERCIAL_GL', version: 1 },
  });
  if (!standardAppetiteRule) {
    standardAppetiteRule = await prisma.carrierAppetiteRule.create({
      data: {
        agencyId: agency.id,
        carrierId: standardCarrier.id,
        lob: 'COMMERCIAL_GL',
        isActive: true,
        summary: 'Preferred: Professional services, retail, technology. Avoid: Heavy construction, hazardous materials.',
        rules: {
          preferredIndustries: ['professional_services', 'retail', 'technology', 'hospitality'],
          declinedIndustries: ['heavy_construction', 'hazardous_materials', 'mining'],
          minYearsInBusiness: 2,
          maxAnnualRevenue: 50000000,
          minAnnualRevenue: 100000,
          claimsHistory: {
            maxClaimsLast5Years: 2,
            maxTotalPaidLast5Years: 100000,
          },
          limits: {
            minLimit: 500000,
            maxLimit: 2000000,
          },
          marketType: 'STANDARD',
        },
      },
    });
  }
  console.log(`Created/found appetite rule for: ${standardCarrier.name}`);

  let esAppetiteRule = await prisma.carrierAppetiteRule.findFirst({
    where: { carrierId: esCarrier.id, lob: 'COMMERCIAL_GL', version: 1 },
  });
  if (!esAppetiteRule) {
    esAppetiteRule = await prisma.carrierAppetiteRule.create({
      data: {
        agencyId: agency.id,
        carrierId: esCarrier.id,
        lob: 'COMMERCIAL_GL',
        isActive: true,
        summary: 'Broad appetite including construction, manufacturing, and risks declined by standard markets.',
        rules: {
          preferredIndustries: ['construction', 'manufacturing', 'entertainment', 'food_processing'],
          acceptedIndustries: ['all'],
          minYearsInBusiness: 1,
          maxAnnualRevenue: 500000000,
          minAnnualRevenue: 50000,
          claimsHistory: {
            maxClaimsLast5Years: 5,
            maxTotalPaidLast5Years: 500000,
          },
          limits: {
            minLimit: 1000000,
            maxLimit: 25000000,
          },
          marketType: 'EXCESS_SURPLUS',
          specialConditions: [
            'Accepts risks with adverse claims history',
            'Available for new ventures with experienced operators',
            'Higher premiums for high-risk classes',
          ],
        },
      },
    });
  }
  console.log(`Created/found appetite rule for: ${esCarrier.name}`);

  // 5. Create Super Admin user (upsert by email)
  const superAdminPassword = 'admin123';
  const superAdminHash = await hashPassword(superAdminPassword);
  
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@insurigence.com' },
    update: {
      passwordHash: superAdminHash,
      mustChangePassword: false,
    },
    create: {
      email: 'admin@insurigence.com',
      passwordHash: superAdminHash,
      role: 'SUPER_ADMIN',
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
      mustChangePassword: false,
      agencyId: null,
    },
  });
  console.log(`Created super admin user: ${superAdmin.email} (password: ${superAdminPassword})`);

  // 6. Create agency admin user
  const agencyAdminPassword = 'admin123';
  const agencyAdminHash = await hashPassword(agencyAdminPassword);
  
  const agencyAdmin = await prisma.user.upsert({
    where: { email: 'admin@acmeinsurance.com' },
    update: {
      passwordHash: agencyAdminHash,
      mustChangePassword: false,
    },
    create: {
      email: 'admin@acmeinsurance.com',
      passwordHash: agencyAdminHash,
      role: 'ADMIN',
      firstName: 'Agency',
      lastName: 'Admin',
      isActive: true,
      mustChangePassword: false,
      agencyId: agency.id,
    },
  });
  console.log(`Created agency admin user: ${agencyAdmin.email} (password: ${agencyAdminPassword})`);

  // 7. Create sample agent user
  const agentPassword = 'agent123';
  const agentHash = await hashPassword(agentPassword);
  
  const agent = await prisma.user.upsert({
    where: { email: 'agent@acmeinsurance.com' },
    update: {
      passwordHash: agentHash,
      mustChangePassword: false,
    },
    create: {
      email: 'agent@acmeinsurance.com',
      passwordHash: agentHash,
      role: 'AGENT',
      firstName: 'John',
      lastName: 'Agent',
      isActive: true,
      mustChangePassword: false,
      agencyId: agency.id,
    },
  });
  console.log(`Created agent user: ${agent.email} (password: ${agentPassword})`);

  console.log('\n========================================');
  console.log('Database seeded successfully!');
  console.log('========================================');
  console.log('\nTest Credentials:');
  console.log(`Super Admin: admin@insurigence.com / ${superAdminPassword}`);
  console.log(`Agency Admin: admin@acmeinsurance.com / ${agencyAdminPassword}`);
  console.log(`Agent: agent@acmeinsurance.com / ${agentPassword}`);
  console.log('========================================\n');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
