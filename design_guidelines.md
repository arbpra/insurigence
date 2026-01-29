# Insurigence - Design Guidelines

## Design Approach: Professional Insurance Platform

**Selected System:** Fluent Design + Stripe's restraint for enterprise trust
**Rationale:** Insurance B2B requires credibility and efficiency. Client-facing proposal pages need polish while internal tools prioritize productivity.

## Typography

**Font Families:**
- Primary: Inter (Google Fonts CDN)
- Monospace: JetBrains Mono for policy numbers/IDs

**Hierarchy:**
- Hero/Page Titles: text-4xl font-bold
- Section Headers: text-2xl font-semibold
- Subsections: text-xl font-semibold
- Form Labels: text-sm font-medium
- Body Text: text-base
- Helper/Meta: text-sm text-gray-600
- Table Data: text-sm

## Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, 8, 12 (p-2, gap-6, py-12, etc.)

**Containers:**
- Forms/Focused Content: max-w-3xl mx-auto
- Dashboards/Tables: max-w-7xl mx-auto
- Client Proposals: max-w-5xl mx-auto
- Page Padding: px-6 lg:px-8, py-12

## Component Library

### Navigation (All Pages)
**Header:**
- White background with subtle bottom border (border-b border-gray-200)
- Logo "Insurigence" (left) with custom icon mark
- Desktop nav links: Dashboard, Intakes, Proposals (center)
- User dropdown with agency name (right)
- Sticky: sticky top-0 z-50, h-16

### Lead Management Dashboard
**Stats Row:**
- grid-cols-4 gap-6, above main content
- Cards: bg-white rounded-lg shadow-sm p-6
- Large metric (text-3xl font-bold) + label + trend indicator
- Metrics: Total Leads, Active Quotes, Conversion Rate, Avg Response Time

**Filters Bar:**
- Horizontal filter row with dropdowns: Status, Type, Date Range, Search
- flex gap-4 layout, white background card

**Leads Table:**
- Full-width with hover states
- Columns: Company, Industry, Coverage Type, Premium Est., Status Badge, Submitted Date, Actions
- Status badges: rounded-full px-3 py-1, color-coded (New: blue, In Review: yellow, Quoted: purple, Bound: green, Declined: gray)
- Row actions: "View Details" + "Create Proposal" buttons
- Pagination controls at bottom
- Empty state: Large icon + "No leads match filters" + "Create New Intake" CTA

### Intake Forms (/intake/[type])
**Layout:**
- Centered single-column (max-w-3xl)
- White card on gray-50 background
- Progress indicator at top (Step 1 of 4 style breadcrumb)
- Sections with clear dividers (border-t pt-8 mt-8)

**Form Sections (Commercial GL Example):**
1. Business Profile (name, industry, years, revenue)
2. Coverage Requirements (limits, deductibles, effective dates)
3. Risk Details (operations, locations, employees)
4. Claims History (table format if multiple)
5. Additional Information (attachments, notes)

**Form Elements:**
- Inputs: border-gray-300 rounded-lg px-4 py-2.5, focus:ring-2 focus:ring-blue-500
- Grouped inputs: Use grid-cols-2 gap-4 for related fields (e.g., First/Last Name)
- File upload: Dashed border dropzone with upload icon
- Primary button: Blue, full-width or right-aligned
- Secondary: Gray outline, left-aligned for "Save Draft"

### Proposal/Market Summary Pages (/proposals/[id])
**Client-Facing Polish:**

**Hero Section:**
- Two-column layout (text left, image right)
- Headline: "Your Commercial General Liability Proposal"
- Subheading with client company name and date
- Right side: Professional insurance industry image (handshake, business meeting, modern office)
- Background: Subtle gradient (gray-50 to white)
- Height: Natural content height, not forced viewport

**Content Sections:**
- Coverage Overview Cards: grid-cols-3 gap-6
  - Each card: Icon, coverage type, limit display
- Premium Breakdown: Clean pricing table with line items
- Market Comparison: Side-by-side carrier cards (if multiple quotes)
  - Cards show: Carrier logo, premium, key terms, "Select" CTA
- Policy Details: Expandable accordion sections
- Next Steps: Numbered list with clear CTAs

**Download/Share Actions:**
- Floating action bar (sticky bottom) with "Download PDF" and "Email to Client"
- Print-friendly layout considerations

**Trust Indicators:**
- Agency license numbers in footer
- Carrier logos/partnerships
- Professional certifications badges

### Settings/Admin Pages
**Simple Forms:**
- Agency profile editing
- User management table
- Integration settings (API keys, email templates)
- Standard form layouts matching intake patterns

## Visual System

**Neutral Foundation:**
- Grays: 50, 100, 200, 300, 600, 700, 900
- White backgrounds, gray borders throughout
- Subtle shadows: shadow-sm for cards, shadow-md for modals

**Brand Accent (Blue):**
- Primary CTAs: bg-blue-600 hover:bg-blue-700
- Links: text-blue-600 hover:text-blue-700
- Focus rings: ring-blue-500
- Status indicators where appropriate

**Supporting Colors:**
- Success/Bound: Green (emerald-500)
- Warning/Review: Yellow (amber-500)
- Info: Blue (sky-500)
- Error/Declined: Red (red-500)

## Images

**Use Professional Stock Photography:**
- Dashboard hero (optional): Modern office, insurance professionals
- Proposal pages: Handshake, business meeting, contract signing
- Empty states: Subtle illustrations
- All images: Subtle overlay for text legibility when needed

**Icons:** Heroicons via CDN
- Navigation, form fields, status indicators, table actions

## Accessibility
- Label/input associations with htmlFor
- Visible focus states (ring-2)
- WCAG AA contrast minimum
- Keyboard navigation throughout
- ARIA labels for icon buttons
- Screen reader announcements for dynamic content

## Responsive Behavior (Desktop-First)
- Tables: overflow-x-auto on mobile
- Multi-column grids: Stack to single column below lg breakpoint
- Navigation: Hamburger menu on mobile
- Forms: Full-width below md breakpoint