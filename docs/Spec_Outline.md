# FM Comply - Facilities Management Compliance SaaS

## Specification Document v1.0

**Last Updated:** 2024-01-24  
**Status:** MVP Development  
**Architecture:** Single-Tenant, Portfolio Management (5-20 buildings)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [User Roles & Permissions](#2-user-roles--permissions)
3. [Database Schema](#3-database-schema)
4. [Core Modules](#4-core-modules)
5. [Checklist Templates](#5-checklist-templates)
6. [Forms Library](#6-forms-library)
7. [Integrations](#7-integrations)
8. [UI/UX Flow](#8-uiux-flow)
9. [Technical Architecture](#9-technical-architecture)
10. [Implementation Status](#10-implementation-status)
11. [Future Enhancements](#11-future-enhancements)

---

## 1. Project Overview

### 1.1 Purpose
FM Comply is a retail building maintenance compliance platform designed for facilities management teams. It streamlines checklist management, audit trails, issue escalation, and compliance reporting across a portfolio of buildings.

### 1.2 Key Features
- **Checklist Engine**: Dynamic templates for daily/weekly/monthly/quarterly/annual tasks
- **Audit & Traceability**: Automatic timestamping, digital signatures, 12+ month retention
- **Escalation Workflow**: Issue logging with corrective actions, deadlines, and automated reminders
- **Responsibility Matrix**: Role-based task assignment and visibility
- **Offline Capability**: PWA support for field staff in areas with poor connectivity
- **Reporting**: PDF/CSV exports for regulators and insurers

### 1.3 Target Users
- **Property Managers**: Dashboard oversight, audit reports, compliance tracking
- **Field Staff**: Mobile task completion, photo capture, issue reporting
- **Auditors/Reviewers**: Read-only access to compliance history

### 1.4 Localization
- **Primary Region**: City of Tshwane, South Africa
- **Timezone**: Africa/Johannesburg (default)
- **Statutory Requirements**: South African building compliance certificates

---

## 2. User Roles & Permissions

### 2.1 Role Definitions

| Role | Description | Access Level |
|------|-------------|--------------|
| **Admin** | Full system access, user management, organization settings | Full CRUD on all entities |
| **Manager** | Approve logs, run audits, view all buildings | View all, manage tasks/templates |
| **User** | Field staff - complete tasks, upload photos, report issues | Limited to assigned buildings |
| **Reviewer** | External auditors - read-only access to audit logs and reports | Read-only, export capability |

### 2.2 Permission Matrix

| Feature | Admin | Manager | User | Reviewer |
|---------|-------|---------|------|----------|
| View Dashboard | ✅ | ✅ | ✅ | ✅ |
| Manage Buildings | ✅ | ✅ (update only) | ❌ | ❌ |
| Create/Edit Templates | ✅ | ✅ | ❌ | ❌ |
| Complete Tasks | ✅ | ✅ | ✅ | ❌ |
| Report Issues | ✅ | ✅ | ✅ | ❌ |
| View Audit Logs | ✅ | ❌ | ❌ | ✅ |
| Manage Users | ✅ | ❌ | ❌ | ❌ |
| Export Reports | ✅ | ✅ | ❌ | ✅ |
| Organization Settings | ✅ | ✅ | ❌ | ❌ |

### 2.3 Building Access Control
- **Admins & Managers**: Access to ALL buildings automatically
- **Users**: Only see buildings explicitly assigned via `user_building_assignments`
- **Reviewers**: Read-only access to audit data (no building-specific restrictions)

---

## 3. Database Schema

### 3.1 Enums

```sql
-- User roles
CREATE TYPE app_role AS ENUM ('admin', 'manager', 'user', 'reviewer');

-- Task frequencies
CREATE TYPE task_frequency AS ENUM ('daily', 'weekly', 'monthly', 'quarterly', 'annually');

-- Task status
CREATE TYPE task_status AS ENUM ('pending', 'completed', 'overdue', 'issue_logged');

-- Issue priority
CREATE TYPE issue_priority AS ENUM ('low', 'medium', 'high', 'critical');

-- Issue status
CREATE TYPE issue_status AS ENUM ('open', 'in_progress', 'resolved', 'escalated');
```

### 3.2 Core Tables

#### profiles
Stores basic user information (created automatically on signup).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | - | References auth.users(id) |
| email | text | No | - | User email |
| full_name | text | Yes | - | Display name |
| avatar_url | text | Yes | - | Profile picture URL |
| phone | text | Yes | - | Contact number |
| created_at | timestamptz | No | now() | - |
| updated_at | timestamptz | No | now() | - |

#### user_roles
Separate table for role storage (security best practice).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | - |
| user_id | uuid | No | - | References auth.users(id) |
| role | app_role | No | 'user' | User's role |
| created_at | timestamptz | No | now() | - |

**Constraint**: UNIQUE (user_id, role)

#### organizations
Single-tenant organization settings.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | - |
| name | text | No | - | Organization name |
| logo_url | text | Yes | - | Branding logo |
| primary_color | text | Yes | '#2563eb' | Brand color |
| address | text | Yes | - | Physical address |
| phone | text | Yes | - | Contact number |
| email | text | Yes | - | Contact email |
| created_at | timestamptz | No | now() | - |
| updated_at | timestamptz | No | now() | - |

#### buildings
Portfolio of managed properties.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | - |
| organization_id | uuid | No | - | Parent organization |
| name | text | No | - | Building name |
| address | text | No | - | Street address |
| city | text | No | 'City of Tshwane' | City/region |
| timezone | text | No | 'Africa/Johannesburg' | Local timezone |
| latitude | double | Yes | - | Map coordinates |
| longitude | double | Yes | - | Map coordinates |
| logo_url | text | Yes | - | Building-specific logo |
| emergency_contacts | jsonb | Yes | '[]' | Emergency contact list |
| statutory_certificates | jsonb | Yes | '[]' | Certificate types/expiry |
| created_at | timestamptz | No | now() | - |
| updated_at | timestamptz | No | now() | - |

#### user_building_assignments
Links field staff to specific buildings.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | - |
| user_id | uuid | No | - | References auth.users(id) |
| building_id | uuid | No | - | References buildings(id) |
| created_at | timestamptz | No | now() | - |

**Constraint**: UNIQUE (user_id, building_id)

#### checklist_templates
Master templates for generating tasks.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | - |
| organization_id | uuid | No | - | Parent organization |
| name | text | No | - | Template name |
| description | text | Yes | - | Template description |
| frequency | task_frequency | No | - | daily/weekly/monthly/etc |
| responsible_role | app_role | No | - | Which role performs this |
| is_active | boolean | Yes | true | Active/inactive flag |
| created_at | timestamptz | No | now() | - |
| updated_at | timestamptz | No | now() | - |

#### template_items
Individual tasks within a template.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | - |
| template_id | uuid | No | - | Parent template |
| task_name | text | No | - | Task title |
| task_description | text | Yes | - | Detailed instructions |
| requires_photo | boolean | Yes | false | Photo evidence required |
| requires_signature | boolean | Yes | true | Digital sign-off required |
| display_order | integer | No | 0 | Sort order |
| created_at | timestamptz | No | now() | - |

#### task_instances
Generated tasks for specific dates/buildings.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | - |
| template_item_id | uuid | Yes | - | Source template item |
| building_id | uuid | No | - | Target building |
| task_name | text | No | - | Task title |
| task_description | text | Yes | - | Task details |
| frequency | task_frequency | No | - | Task frequency |
| responsible_role | app_role | No | - | Assigned role |
| due_date | date | No | - | Due date |
| status | task_status | No | 'pending' | Current status |
| requires_photo | boolean | Yes | false | Photo required |
| requires_signature | boolean | Yes | true | Signature required |
| created_at | timestamptz | No | now() | - |
| updated_at | timestamptz | No | now() | - |

#### task_completions
Audit log of completed tasks.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | - |
| task_instance_id | uuid | No | - | Completed task |
| completed_by | uuid | No | - | User who completed |
| completed_at | timestamptz | No | now() | Completion timestamp |
| notes | text | Yes | - | Optional notes |
| photo_urls | text[] | Yes | '{}' | Photo evidence URLs |
| signature_confirmed | boolean | Yes | false | Digital signature flag |
| created_at | timestamptz | No | now() | - |

#### issues
Escalation and corrective action tracking.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | - |
| task_instance_id | uuid | Yes | - | Related task (if any) |
| building_id | uuid | No | - | Target building |
| reported_by | uuid | No | - | User who reported |
| assigned_to | uuid | Yes | - | Assigned resolver |
| title | text | No | - | Issue title |
| description | text | No | - | Issue description |
| corrective_action | text | Yes | - | Required action |
| priority | issue_priority | No | 'medium' | Issue priority |
| status | issue_status | No | 'open' | Current status |
| deadline | date | Yes | - | Resolution deadline |
| resolved_at | timestamptz | Yes | - | Resolution timestamp |
| resolved_by | uuid | Yes | - | Who resolved |
| photo_urls | text[] | Yes | '{}' | Evidence photos |
| created_at | timestamptz | No | now() | - |
| updated_at | timestamptz | No | now() | - |

#### audit_logs
Immutable record of all system actions.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | - |
| user_id | uuid | Yes | - | Acting user |
| action | text | No | - | Action performed |
| entity_type | text | No | - | Entity type (task, issue, etc) |
| entity_id | uuid | No | - | Entity ID |
| details | jsonb | Yes | '{}' | Additional details |
| ip_address | text | Yes | - | Client IP |
| created_at | timestamptz | No | now() | - |

### 3.3 Security Functions

```sql
-- Check if user has specific role
has_role(user_id uuid, role app_role) → boolean

-- Check if user is admin or manager
is_admin_or_manager(user_id uuid) → boolean

-- Check if user has access to a building
has_building_access(user_id uuid, building_id uuid) → boolean

-- Get user's role
get_user_role(user_id uuid) → app_role
```

### 3.4 Triggers

- **on_auth_user_created**: Auto-creates profile and assigns 'user' role on signup
- **update_*_updated_at**: Updates `updated_at` timestamp on row changes

---

## 4. Core Modules

### 4.1 Dashboard
**Route**: `/`

- Portfolio overview with key metrics
- Pending tasks by frequency (today's count)
- Completed tasks today
- Open issues requiring attention
- Overall compliance score (%)
- Quick actions for field staff

### 4.2 Buildings
**Route**: `/buildings`

- List/grid view of all buildings
- Search and filter functionality
- Building details: name, address, location, emergency contacts
- Mapbox integration for location pinning
- Building-specific settings and logo

### 4.3 Checklists
**Route**: `/checklists`

- Tabbed interface: Daily | Weekly | Monthly | Quarterly | Annual
- Building filter dropdown
- Task list with tick-box completion
- Photo capture for safety-related tasks
- Digital signature confirmation
- Issue reporting from task context
- Progress indicator per frequency

### 4.4 Issues
**Route**: `/issues`

- Issue list with status filtering
- Priority badges (low/medium/high/critical)
- Status badges (open/in_progress/escalated/resolved)
- Create new issue form
- Assign responsible party
- Set deadline for resolution
- Corrective action tracking

### 4.5 Map View
**Route**: `/map`

- Mapbox-powered portfolio map
- Building pins with status indicators
- Click to view building details
- Compliance score overlay

### 4.6 Reports
**Route**: `/reports`

- Monthly Compliance Summary
- Issue Resolution Report
- Building Performance Report
- Audit Compliance Pack
- Export: PDF / CSV

### 4.7 Audit Archive
**Route**: `/audit`

- Searchable activity log
- Filter by date, user, building, action type
- 12+ month retention
- Export functionality

### 4.8 Forms Library
**Route**: `/forms`

- Printable FM forms (see Section 6)
- Download as PDF
- Print directly

### 4.9 User Management
**Route**: `/users` (Admin only)

- User list with role badges
- Invite new users by email
- Change user roles
- Remove users

### 4.10 Settings
**Route**: `/settings` (Admin/Manager)

- Organization details
- Branding (logo, primary color)
- Notification preferences
- Default timezone and city

---

## 5. Checklist Templates

### 5.1 Daily Checklist Template

| Task Name | Description | Responsible | Photo Required |
|-----------|-------------|-------------|----------------|
| Restroom Consumables Restock | Restock toilet paper, soap, paper towels | Cleaning Staff | No |
| Restroom Cleaning & Sanitise | Clean and sanitise restrooms and touchpoints | Cleaning Staff | Yes |
| Floors – Common Areas | Sweep, mop, vacuum common areas | Cleaning Staff | No |
| Waste & Recycling | Empty bins and record waste volumes | Cleaning Staff | No |
| Lighting – Function Check | Inspect all lighting (interior & exterior) | Maintenance | No |
| Emergency Exits – Clear & Lit | Check signage illumination & clear routes | Security/Operations | No |
| Vertical Transport – Function Check | Inspect escalators, elevators, auto doors | Maintenance | No |
| Fire Appliances – Visual Check | Check extinguishers/hydrants for tampering | Security/Maintenance | No |
| HVAC – Setpoints & Log | Confirm HVAC setpoints and temperatures | Maintenance | No |
| Parking – Cleanliness & Safety | Check lighting, spills, accessibility | Security/Maintenance | No |

### 5.2 Weekly Checklist Template

| Task Name | Description | Responsible | Photo Required |
|-----------|-------------|-------------|----------------|
| Alarm/Intercom/Paging Test | Test communication & alarm systems | Security | No |
| HVAC Filters – Inspect/Replace | Check and replace HVAC filters | Maintenance | Yes |
| Plumbing – Leaks/Pressure | Inspect plumbing fixtures | Maintenance | No |
| Fire Egress – Walkthrough | Inspect emergency stairs & exits | Security/Maintenance | No |
| Fire Hose Reels/Hydrants – Seals | Inspect hose reels/hydrants for tampering | Security/Maintenance | No |
| Tenant Feedback & Work Orders | Review tenant feedback logs | Operations | No |
| Presentation & Trip Hazards | Inspect storefronts and common areas | Operations | No |
| Grounds & Pest Status | Check landscaping & pest control | Contractors | No |

### 5.3 Monthly Checklist Template

| Task Name | Description | Responsible | Photo Required |
|-----------|-------------|-------------|----------------|
| Electrical Panels/Breakers | Inspect electrical panels & timers | Maintenance | No |
| Water & Irrigation Audit | Audit water usage & leak check | Maintenance | No |
| Roof/Gutters/Drainage | Inspect roofing & drainage systems | Contractors | Yes |
| Deep Clean – Floors/Upholstery | Deep clean carpets & high traffic floors | Cleaning Staff | No |
| Fire Extinguisher/Hydrant Service | Service extinguishers & hydrants | Fire Safety Contractor | Yes |
| Evacuation Drill & Notification Test | Test evacuation & mass notification | Security/Operations | No |
| CCTV & Access Control Review | Cyber/security systems inspection | Security/IT | No |
| Maintenance Log Review | Review recurring issues | Operations | No |
| Cleaning Equipment Audit | Inspect & service cleaning equipment | Cleaning Staff | No |
| Lighting/Energy Efficiency Audit | Review lighting cycles & sensors | Maintenance | No |

### 5.4 Quarterly Checklist Template

| Task Name | Description | Responsible | Photo Required |
|-----------|-------------|-------------|----------------|
| HVAC Preventative Maintenance | Full HVAC PM & refrigerant checks | HVAC Contractor | Yes |
| Generators/UPS – Load Test | Test generators & UPS under load | Electrical Contractor | Yes |
| Structure & Façade Survey | Inspect façade & structural elements | Structural Contractor | Yes |
| Emergency Plans – Review/Update | Update emergency response plans | Operations/Security | No |
| Accessibility Audit | Check accessibility & signage | Facilities/Consultant | No |

### 5.5 Annual Checklist Template

| Task Name | Description | Responsible | Photo Required |
|-----------|-------------|-------------|----------------|
| Fire Alarm Certification | Full fire alarm system certification | Fire Safety Contractor | Yes |
| Electrical Safety & Thermography | Electrical inspection & thermal scan | Electrical Contractor | Yes |
| Roof Condition Survey | Full roof condition & gutter maintenance | Roofing Contractor | Yes |
| Pest Control Review / Treatment | Annual pest contract review | Pest Control Contractor | No |
| Compliance Records Review | Review permits, insurance, statutory docs | Legal/Operations | No |

---

## 6. Forms Library

Printable forms for manual processes and documentation.

| Form Name | Purpose | Frequency | Owner |
|-----------|---------|-----------|-------|
| Key Access / Key Issuance Log | Track keys issued/returned, key ID, purpose | Per issuance | Security |
| Roof Access Journal | Record personnel, time in/out, work reason, permit | Every roof visit | Maintenance/Contractor |
| Daily Site Handover Log | Shift notes, outstanding tasks, incidents | Daily (shift change) | Operations/Security |
| Asset Inspection Report | Condition checks for HVAC, lifts, escalators | Daily/Weekly per asset | Maintenance |
| Cleaning & Hygiene Log | Restroom checks, consumables restocked, deep-clean notes | Multiple times daily | Cleaning staff |
| Access Control / Visitor Log | Visitor name, company, host, ID, badge issued | Per visit | Security/Reception |
| Work Order / Job Card | Request, scope, cost, vendor, completion evidence | As required | Operations |
| Incident / Near-miss Report | Safety incidents, photos, corrective actions | As required | Security/Operations |
| Evacuation Drill Record | Drill date, attendance, timing, lessons learned | Quarterly/Annually | Security/Operations |
| Permit to Work / Hot Work Permit | Authorisation for hazardous tasks, controls | Per task | Maintenance/Contractor |
| Certificate Register | Statutory certificates, issuer, expiry, renewal actions | Ongoing | Operations |
| Pest Control & Waste Log | Treatments, locations, hazardous waste disposals | Weekly/Monthly | Contractors/Cleaning |
| Roof & Gutter Maintenance Log | Inspections, debris removed, repairs | Monthly/After storms | Contractors |
| Parking & Vehicle Incident Log | Accidents, oil spills, tow actions | As required | Security |
| Training & PPE Issuance Record | Attendance, issued PPE, refresher dates | Monthly/Annually | HR/Operations |

---

## 7. Integrations

### 7.1 Resend API (Email Notifications)
**Priority**: Essential

**Use Cases**:
- Task due date reminders (before deadline)
- Overdue task alerts (to user and manager)
- Daily digest of pending tasks
- Issue escalation notifications
- Monthly compliance summary to stakeholders

**Implementation**:
- Edge function: `send-notification`
- Secrets: `RESEND_API_KEY`
- Templates for each notification type

### 7.2 PDFMake (Report Generation)
**Priority**: Essential

**Use Cases**:
- Compliance Pack Export (maintenance logs, certificates, drills)
- Monthly Compliance Summary
- Issue Resolution Report
- Printable forms with building branding
- Audit trail exports

**Implementation**:
- Client-side PDF generation
- Building logo/branding embedded
- Date range and filter support

### 7.3 Mapbox (Location Services)
**Priority**: Essential

**Use Cases**:
- Portfolio map view with building pins
- Building location selection (pin drop)
- Geocoding for address validation
- Compliance status overlay on map

**Implementation**:
- Mapbox GL JS
- Secrets: `MAPBOX_ACCESS_TOKEN` (publishable)
- Interactive map component

### 7.4 Future Integrations (Post-MVP)

| Integration | Purpose |
|-------------|---------|
| Supabase Storage | Photo uploads, document storage |
| PWA Service Worker | Offline task completion |
| Push Notifications | Mobile alerts for urgent issues |
| Calendar Sync | Export tasks to Google/Outlook calendar |

---

## 8. UI/UX Flow

### 8.1 Authentication Flow

```
/auth → Login/Signup tabs
  ↓
  Validate credentials (Zod schema)
  ↓
  Supabase auth.signUp / auth.signInWithPassword
  ↓
  Auto-create profile + default 'user' role (trigger)
  ↓
  Redirect to / (Dashboard)
```

### 8.2 Field Staff Daily Flow

```
Login → Dashboard (My Tasks Today)
  ↓
  Select Building (if multiple assigned)
  ↓
  View Daily Checklist
  ↓
  Complete tasks:
    - Tick checkbox
    - Add notes (optional)
    - Capture photo (if required)
    - Confirm signature
  ↓
  Report Issue (if needed):
    - Describe issue
    - Set priority
    - Upload photos
    - Submit
  ↓
  View progress (X/Y tasks complete)
```

### 8.3 Manager Dashboard Flow

```
Login → Dashboard (Portfolio Overview)
  ↓
  View metrics:
    - Total buildings
    - Pending tasks today
    - Open issues
    - Compliance score
  ↓
  Drill down:
    - Click building → Building details
    - Click issue → Issue management
    - View reports → Generate/download
```

### 8.4 Admin User Management Flow

```
/users → User list with role badges
  ↓
  Invite User:
    - Enter email
    - Select role
    - Send invitation
  ↓
  Manage existing:
    - Change role (dropdown)
    - Remove user
```

---

## 9. Technical Architecture

### 9.1 Frontend Stack

| Technology | Purpose |
|------------|---------|
| React 18 | UI framework |
| TypeScript | Type safety |
| Vite | Build tool |
| Tailwind CSS | Styling |
| shadcn/ui | Component library |
| React Router v6 | Routing |
| TanStack Query | Data fetching/caching |
| React Hook Form + Zod | Form validation |
| Lucide React | Icons |
| date-fns | Date formatting |
| Recharts | Charts and visualizations |

### 9.2 Backend Stack (Supabase — GMI-ops project)

| Technology | Purpose |
|------------|---------|
| Supabase PostgreSQL | Database |
| Supabase Auth | Authentication |
| Supabase Storage | File uploads (planned) |
| Edge Functions (Deno) | Serverless API |
| Row Level Security | Data access control |

### 9.3 Design System

**Color Palette** (HSL):
- Primary: `217 91% 50%` (Industrial Blue)
- Accent: `173 58% 39%` (Teal)
- Success: `142 71% 45%` (Green)
- Warning: `38 92% 50%` (Amber)
- Destructive: `0 84% 60%` (Red)
- Info: `199 89% 48%` (Cyan)

**Typography**: System font stack (native performance)

**Border Radius**: 0.5rem (--radius)

### 9.4 Security Measures

- **RLS Policies**: All tables protected with row-level security
- **Role Separation**: Roles stored in separate table (not on profile)
- **Security Definer Functions**: Prevent RLS recursion
- **Input Validation**: Zod schemas for all forms
- **HTTPS Only**: All API calls over TLS
- **No Client-Side Auth Checks**: All authorization server-side

---

## 10. Implementation Status

### 10.1 Completed (MVP Phase 1)

| Feature | Status | Notes |
|---------|--------|-------|
| Database Schema | ✅ Complete | All tables, RLS, functions, triggers |
| Authentication | ✅ Complete | Login, signup, role management |
| Auth Context | ✅ Complete | useAuth hook with role helpers |
| Protected Routes | ✅ Complete | Role-based route protection |
| Dashboard Layout | ✅ Complete | Sidebar navigation, user menu |
| Dashboard Page | ✅ Complete | Stats, task preview, issue preview |
| Buildings Page | ✅ Complete | List view, search, CRUD (UI only) |
| Checklists Page | ✅ Complete | Frequency tabs, task completion (mock) |
| Issues Page | ✅ Complete | List, filter, status tracking (mock) |
| Map View Page | ✅ Complete | Placeholder (Mapbox pending) |
| Reports Page | ✅ Complete | Report list, download buttons (mock) |
| Audit Archive Page | ✅ Complete | Searchable log table (mock) |
| Forms Library Page | ✅ Complete | Form cards with print/download |
| User Management Page | ✅ Complete | User list, invite, role change (mock) |
| Settings Page | ✅ Complete | Org settings, notifications, branding |
| Design System | ✅ Complete | Colors, tokens, dark mode support |

### 10.2 In Progress (MVP Phase 2)

| Feature | Status | Notes |
|---------|--------|-------|
| Building Creation Form | 🔄 Pending | With Mapbox location picker |
| Checklist Template Seeding | 🔄 Pending | Pre-populate from spec |
| Real Task Generation | 🔄 Pending | Generate from templates |
| Task Completion Flow | 🔄 Pending | Connect to database |
| Photo Upload | 🔄 Pending | Supabase Storage integration |
| Issue Creation Flow | 🔄 Pending | Connect to database |

### 10.3 Planned (MVP Phase 3)

| Feature | Status | Notes |
|---------|--------|-------|
| Mapbox Integration | 📋 Planned | Map view, building pin drop |
| Resend Email Integration | 📋 Planned | Notifications, reminders |
| PDFMake Reports | 📋 Planned | Compliance pack generation |
| PWA Offline Mode | 📋 Planned | Service worker, local storage |
| Gamification | 📋 Planned | Building scores, leaderboard |

---

## 11. Future Enhancements

### 11.1 Post-MVP Features

- **Asset Management**: Track individual assets (HVAC units, elevators, etc.)
- **Vendor Portal**: Contractor-specific login for certificate uploads
- **Calendar Integration**: Sync tasks to Google/Outlook
- **Mobile App**: Native iOS/Android with offline sync
- **Advanced Analytics**: Trend analysis, predictive maintenance
- **Multi-Tenant Support**: White-label for FM companies
- **API Access**: REST API for third-party integrations
- **Bulk Import**: CSV upload for buildings, users, assets

### 11.2 Compliance Extensions

- **Certificate Expiry Tracking**: Automated renewal reminders
- **Regulatory Updates**: Region-specific compliance templates
- **Audit Scheduling**: Book external audits, track findings
- **Insurance Integration**: Auto-generate documentation for claims

---

## Appendix A: API Endpoints (Edge Functions)

| Function | Method | Description |
|----------|--------|-------------|
| `send-notification` | POST | Send email via Resend |
| `generate-tasks` | POST | Generate task instances from templates |
| `export-compliance-pack` | POST | Generate PDF compliance report |
| `geocode-address` | POST | Validate and geocode building address |

---

## Appendix B: Environment Variables

| Variable | Type | Description |
|----------|------|-------------|
| `VITE_SUPABASE_URL` | Public | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public | Supabase anon key |
| `RESEND_API_KEY` | Secret | Resend email API key |
| `MAPBOX_ACCESS_TOKEN` | Public | Mapbox GL access token |

---

## Appendix C: Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2024-01-24 | 1.0 | Initial specification document |

---

*This document serves as the source of truth for FM Comply development. Update this spec when requirements change or features are completed.*
