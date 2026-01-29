# Insurigence - Insurance Placement Intelligence

## Overview
Insurigence is a Next.js application designed to streamline the intake and lead management process for insurance agencies. It provides a comprehensive platform for managing potential customers, evaluating their insurance needs against carrier appetites, generating proposals, and administering agency settings. The project aims to modernize insurance intake, improve efficiency, and enhance client communication with a professional SaaS-grade user experience. Key features include intake form management, an intelligent carrier appetite engine, and a robust Super Admin Console for platform-wide oversight.

## User Preferences
I prefer simple language and detailed explanations. I want iterative development. Ask before making major changes.

## System Architecture

### Brand System
The application adheres to a consistent brand identity using a defined color palette:
- **Primary**: `#0D2137` (Dark navy)
- **Accent**: `#00E6A7` (Bright mint green)
- **Background**: `#F5F7FA` (Light gray)
- **Market Classification Colors**: Green for Standard, Amber for E&S, Blue for Borderline.

### UI Component System
A unified component system ensures UI consistency, utilizing:
- **AppLayout**: Provides a consistent shell with a sidebar navigation, header, and main content area.
- **Reusable Components**: Includes `PageHeader`, `StatCard`, `DataTable`, `Badge`, and `Button` for common UI patterns.
- **CSS Classes**: Defined in `globals.css` for primary/accent buttons, card styling, KPI tiles, and market classification badges.

### Technical Implementation
- **Framework**: Next.js App Router.
- **Styling**: Tailwind CSS for utility-first styling.
- **ORM**: Prisma ORM with PostgreSQL for database interactions.
- **Database Schema**: Key models include `Agency`, `Lead`, `IntakeSubmission`, `IntakeForm`, `ActivityEvent`, `Carrier`, `AppetiteRule`, `User`, and `Session`.
- **API Endpoints**: RESTful API design for managing intake submissions, leads, proposals, and super admin functionalities.
- **Environment Variables**: `DATABASE_URL` for database connection.

### Authentication System
The application uses a dual authentication system with the following features:

**Replit Auth (Primary - Social Login)**:
- **OIDC Integration**: Uses Replit as OpenID Connect provider
- **Social Login**: Supports Google, GitHub, X, Apple, and email/password via Replit
- **API Routes**: /api/login (start auth), /api/callback (handle response), /api/logout (end session)
- **Auto User Creation**: New users are automatically created with AGENT role on first login

**Email/Password Auth (Legacy)**:
- **Password Hashing**: Scrypt algorithm with random salt for secure password storage
- **Session Management**: HTTP-only cookies with 7-day expiration, stored in Session table
- **Role-Based Access Control (RBAC)**: Three roles - SUPER_ADMIN, ADMIN, AGENT
- **Test Credentials**:
  - Super Admin: admin@insurigence.com / admin123
  - Agency Admin: admin@acmeinsurance.com / admin123
  - Agent: agent@acmeinsurance.com / agent123

**Common Features**:
- **Middleware Protection**: Next.js middleware protects all routes except public paths
- **Tenant Isolation**: Users can only access data from their own agency (except SUPER_ADMIN)
- **Public Paths**: Homepage (/), Login (/login), Change Password (/change-password), Public Intake Forms (/intake/public/*), Proposal Views (/proposal/*), Marketing Pages (/pricing, /request-demo, /how-it-works, /who-its-for, /why-insurigence, /sample-proposal, /faq, /compare, /for-producers, /use-cases)
- **Protected Paths**: All dashboard routes require authentication; Super Admin routes require SUPER_ADMIN role

### Marketing Website
Public-facing marketing pages located in `app/(landing)/`:
- **Homepage** (`/`): Main landing page with hero, problem/solution, features, social proof
- **Pricing** (`/pricing`): Plan comparison with Monthly/Annual toggle, 3 tiers (Solo $199/mo, Growth $299/mo, Multi-Location $499/mo), FAQ accordion
- **Request Demo** (`/request-demo`): Demo request page with placeholder for scheduling link
- **How It Works** (`/how-it-works`): Platform workflow explanation
- **Who It's For** (`/who-its-for`): Target audience pages
- **Why Insurigence** (`/why-insurigence`): Value proposition
- **Sample Proposal** (`/sample-proposal`): Example proposal output
- **Compare** (`/compare`): Competitive comparison
- **For Producers** (`/for-producers`): Producer-specific messaging
- **FAQ** (`/faq`): Frequently asked questions
- **Use Cases** (`/use-cases`): Industry use cases

### Core Features
- **Lead Management Dashboard**: Overview of leads, their status, and key performance indicators.
- **Intake Forms**: Commercial General Liability intake form with support for public-facing forms and external submissions.
  - **Dual Presentation Modes**: Forms support STANDARD (full form layout) and FLASH (flash-card style, one question at a time) modes
  - **Mode Configuration**: Super admin can set presentationMode (STANDARD/FLASH/BOTH) and allowModeToggle per form
  - **URL Override**: Public intake pages support ?mode=flash or ?mode=standard query parameter override
  - **LocalStorage Auto-save**: Flash mode automatically saves progress with key format: insurigence_intake_{formId}_{tokenPrefix}
  - **Dynamic Rendering**: Both modes render from shared IntakeForm.definition JSON (lib/formDefinition.ts utility)
- **Proposal/Market Summary**: Allows agents to generate and share market summaries with clients, tracking proposal status.
- **Super Admin Console**: A centralized administration hub for managing agencies, users, activities, and platform-wide settings with role-based access control (SUPER_ADMIN, ADMIN, AGENT).
- **Carrier Appetite Engine**: Evaluates leads against structured appetite rules (industry, geography, financial limits, loss history) to classify market fit (Standard, E&S, Borderline) and recommend carriers. Rules support versioning and agency-specific overrides.

## External Dependencies

- **PostgreSQL**: Primary database for all application data, managed via Prisma.
- **Prisma**: ORM for database access and migrations.
- **Next.js**: React framework for full-stack application development.
- **Tailwind CSS**: Utility-first CSS framework for styling.