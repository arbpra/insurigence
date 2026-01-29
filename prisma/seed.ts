import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEV_AGENCY_ID = 'dev-agency-001';

async function main() {
  console.log('Seeding database...');

  // 1. Create demo agency
  const agency = await prisma.agency.upsert({
    where: { id: DEV_AGENCY_ID },
    update: {},
    create: {
      id: DEV_AGENCY_ID,
      name: 'Acme Insurance Agency',
      primaryEmail: 'contact@acmeinsurance.com',
      phone: '(555) 123-4567',
      website: 'https://acmeinsurance.com',
      brandPrimaryColor: '#1e40af',
      brandSecondaryColor: '#3b82f6',
      proposalFooterText: 'Thank you for choosing Acme Insurance Agency',
    },
  });
  console.log(`Created agency: ${agency.name} (ID: ${agency.id})`);

  // 2. Create Commercial GL intake form with definition JSON
  const intakeForm = await prisma.intakeForm.upsert({
    where: { id: 'intake-form-gl-001' },
    update: {},
    create: {
      id: 'intake-form-gl-001',
      agencyId: DEV_AGENCY_ID,
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
  console.log(`Created intake form: ${intakeForm.name}`);

  // 3. Create two carriers (one standard, one E&S)
  const standardCarrier = await prisma.carrier.upsert({
    where: { agencyId_name: { agencyId: DEV_AGENCY_ID, name: 'Nationwide Insurance' } },
    update: {},
    create: {
      id: 'carrier-standard-001',
      agencyId: DEV_AGENCY_ID,
      name: 'Nationwide Insurance',
      notes: 'Standard market carrier with broad appetite for commercial GL',
      isActive: true,
    },
  });
  console.log(`Created carrier: ${standardCarrier.name} (Standard Market)`);

  const esCarrier = await prisma.carrier.upsert({
    where: { agencyId_name: { agencyId: DEV_AGENCY_ID, name: 'Lexington Insurance (AIG)' } },
    update: {},
    create: {
      id: 'carrier-es-001',
      agencyId: DEV_AGENCY_ID,
      name: 'Lexington Insurance (AIG)',
      notes: 'Excess & Surplus lines carrier for hard-to-place risks',
      isActive: true,
    },
  });
  console.log(`Created carrier: ${esCarrier.name} (E&S Market)`);

  // 4. Create appetite rules for both carriers
  const standardAppetiteRule = await prisma.carrierAppetiteRule.upsert({
    where: { id: 'appetite-standard-001' },
    update: {},
    create: {
      id: 'appetite-standard-001',
      agencyId: DEV_AGENCY_ID,
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
  console.log(`Created appetite rule for: ${standardCarrier.name}`);

  const esAppetiteRule = await prisma.carrierAppetiteRule.upsert({
    where: { id: 'appetite-es-001' },
    update: {},
    create: {
      id: 'appetite-es-001',
      agencyId: DEV_AGENCY_ID,
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
  console.log(`Created appetite rule for: ${esCarrier.name}`);

  // 5. Create Super Admin user with password
  const superAdminPassword = 'admin123';
  const superAdminHash = await hashPassword(superAdminPassword);
  
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@insurigence.com' },
    update: {
      passwordHash: superAdminHash,
      mustChangePassword: false,
    },
    create: {
      id: 'super-admin-001',
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
      id: 'agency-admin-001',
      email: 'admin@acmeinsurance.com',
      passwordHash: agencyAdminHash,
      role: 'ADMIN',
      firstName: 'Agency',
      lastName: 'Admin',
      isActive: true,
      mustChangePassword: false,
      agencyId: DEV_AGENCY_ID,
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
      id: 'agent-001',
      email: 'agent@acmeinsurance.com',
      passwordHash: agentHash,
      role: 'AGENT',
      firstName: 'John',
      lastName: 'Agent',
      isActive: true,
      mustChangePassword: false,
      agencyId: DEV_AGENCY_ID,
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
    await pool.end();
  });
