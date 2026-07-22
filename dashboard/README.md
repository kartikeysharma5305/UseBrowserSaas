# Browser-Use SaaS Dashboard

A professional SaaS dashboard for managing AI-powered browser automation agents. Built with Next.js, TypeScript, Tailwind CSS, and Prisma.

## 🎯 Project Overview

The Browser-Use SaaS Dashboard is a user-facing interface that sits on top of the browser automation engine. It provides:

- **User Authentication** - Secure account management with Better Auth
- **Agent Management** - Create, configure, and manage browser automation agents
- **Execution History** - Track and monitor agent execution results
- **Real-time Monitoring** - View agent status and execution results
- **Professional UI** - Clean, modern dashboard inspired by Vercel and Linear

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Dashboard UI (Next.js)                     │
│  Pages: Dashboard | Agents | Runs | Settings               │
│  Components: Reusable UI, Responsive Layout               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              API Layer (Next.js Route Handlers)              │
│  /api/agents | /api/runs | /api/auth                       │
│  Validation, Auth Checks, Authorization                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│               Service Layer (Business Logic)                │
│  Agent Execution Service, Run Management                   │
│  Database Queries via Prisma ORM                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│          Execution Boundary & Browser Engine                │
│  Agent Execution, Playwright Control, Result Capture      │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Folder Structure

```
dashboard/
├── src/
│   ├── app/
│   │   ├── dashboard/
│   │   │   ├── page.tsx              # Overview page with stats
│   │   │   ├── layout.tsx            # Protected dashboard layout
│   │   │   ├── agents/
│   │   │   │   ├── page.tsx          # Agent management table
│   │   │   │   ├── create/page.tsx   # Create agent form
│   │   │   │   └── [id]/page.tsx     # Agent detail & execution history
│   │   │   ├── runs/page.tsx         # Execution history with filters
│   │   │   └── settings/page.tsx     # Settings placeholder
│   │   ├── api/
│   │   │   ├── agents/
│   │   │   │   ├── route.ts          # Agent CRUD endpoints
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts      # Get/Update/Delete agent
│   │   │   │       └── run/route.ts  # Execute agent
│   │   │   ├── runs/
│   │   │   │   └── route.ts          # Run history endpoints
│   │   │   └── auth/[...all]/route.ts # Better Auth handler
│   │   ├── login/page.tsx            # Login page
│   │   ├── register/page.tsx         # Registration page
│   │   ├── layout.tsx                # Root layout
│   │   └── page.tsx                  # Home redirect
│   ├── components/
│   │   ├── layout/
│   │   │   ├── dashboard-shell.tsx   # Dashboard wrapper
│   │   │   ├── sidebar.tsx           # Navigation sidebar
│   │   │   ├── navbar.tsx            # Top navigation bar
│   │   │   └── mobile-navigation.tsx # Mobile drawer
│   │   ├── dashboard/
│   │   │   ├── stats-card.tsx        # Statistics display
│   │   │   ├── agent-table.tsx       # Agents table
│   │   │   ├── agent-card.tsx        # Agent card variant
│   │   │   ├── run-table.tsx         # Execution history table
│   │   │   ├── status-badge.tsx      # Status indicator
│   │   │   ├── agent-detail-client.tsx # Agent detail component
│   │   │   ├── empty-state.tsx       # Empty state UI
│   │   │   ├── error-state.tsx       # Error display
│   │   │   └── loading-skeleton.tsx  # Loading state
│   │   ├── auth/
│   │   │   ├── auth-forms.tsx        # Login/Register forms
│   │   │   └── logout-button.tsx     # Logout action
│   │   └── ui/
│   │       ├── button.tsx            # Button component
│   │       ├── card.tsx              # Card container
│   │       └── badge.tsx             # Status badge
│   └── lib/
│       ├── auth/
│       │   ├── index.ts              # Better Auth setup
│       │   └── helpers.ts            # Auth utilities
│       ├── api/
│       │   ├── route-helpers.ts      # Authorization helpers
│       │   └── schemas.ts            # Zod validation schemas
│       └── utils/
│           └── cn.ts                 # Class name utility
├── prisma/
│   ├── schema.prisma                 # Database schema
│   └── migrations/                   # Database migrations
├── public/                           # Static assets
├── .env.example                      # Environment template
├── .env.local                        # Local environment (git-ignored)
├── next.config.ts                    # Next.js configuration
├── tailwind.config.ts                # Tailwind CSS setup
├── tsconfig.json                     # TypeScript configuration
└── package.json                      # Dependencies
```

## 🗄️ Database Schema

Using **Prisma ORM** with PostgreSQL. Key models:

### User
```prisma
model User {
  id        String      @id @default(cuid())
  email     String      @unique
  name      String?
  agents    Agent[]
  runs      Run[]
  createdAt DateTime    @default(now())
}
```

Represents authenticated users. Managed by Better Auth.

### Agent
```prisma
model Agent {
  id              String      @id @default(cuid())
  userId          String
  name            String
  description     String?
  goal            String
  targetWebsite   String
  status          String      @default("PAUSED")
  configuration   Json        # Model, max steps, timeout, browser settings
  scheduleType    String      @default("MANUAL")
  scheduleConfig  Json?       # Future: scheduling configuration
  lastRunAt       DateTime?
  runs            Run[]
  events          AgentEvent[]
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
}
```

Represents a browser automation agent. Each agent is owned by one user.

### Run
```prisma
model Run {
  id            String      @id @default(cuid())
  agentId       String
  agent         Agent       @relation(fields: [agentId], references: [id], onDelete: Cascade)
  status        String      # RUNNING, SUCCESS, FAILED, COMPLETED
  startedAt     DateTime    @default(now())
  completedAt   DateTime?
  duration      Int?        # Milliseconds
  result        String?     # Execution result summary
  errorMessage  String?     # Error if failed
  events        AgentEvent[]
  createdAt     DateTime    @default(now())
}
```

Represents a single execution of an agent. Tracks status, timing, and results.

### AgentEvent
```prisma
model AgentEvent {
  id        String      @id @default(cuid())
  runId     String
  run       Run         @relation(fields: [runId], references: [id], onDelete: Cascade)
  agentId   String
  agent     Agent       @relation(fields: [agentId], references: [id], onDelete: Cascade)
  type      String      # step_started, action_taken, error, completed
  message   String
  timestamp DateTime    @default(now())
}
```

Tracks detailed events during agent execution for monitoring and debugging.

## 🔐 Authentication

Using **Better Auth** for secure authentication:

- **Session Management** - Secure cookie-based sessions
- **User Registration** - Email/password signup
- **Login/Logout** - Protected routes with automatic redirects
- **Server-side Validation** - All auth checks happen server-side

### Protected Routes

All dashboard routes require authentication via middleware:

```typescript
// Example: /dashboard/layout.tsx
await requireAuth(); // Throws redirect if not authenticated
const user = await getCurrentUser();
```

### Environment Setup

Required environment variables in `.env.local`:

```
BETTER_AUTH_SECRET=your-random-secret-min-32-chars
BETTER_AUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://user:password@localhost:5432/browser_use_dashboard
```

Generate a secure secret:
```bash
openssl rand -base64 32
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL (or compatible database)
- pnpm (or npm/yarn)

### Installation

1. **Clone & Install Dependencies**
```bash
cd dashboard
pnpm install
```

2. **Set Up Environment**
```bash
# Copy template
cp .env.example .env.local

# Edit .env.local with your values
# DATABASE_URL=postgresql://...
# BETTER_AUTH_SECRET=your-secret...
```

3. **Set Up Database**
```bash
# Generate Prisma client
pnpm prisma:generate

# Run migrations
pnpm prisma:migrate
```

4. **Start Development Server**
```bash
pnpm dev
```

Visit `http://localhost:3000`

### Available Commands

```bash
# Development
pnpm dev              # Start dev server on :3000
pnpm lint             # Run ESLint
pnpm typecheck        # Check TypeScript

# Building
pnpm build            # Build for production
pnpm start            # Run production build

# Database
pnpm prisma:generate  # Generate Prisma client
pnpm prisma:migrate   # Create & run migrations
```

## 📡 API Endpoints

All endpoints require authentication and validate user ownership.

### Agents

**List User's Agents**
```
GET /api/agents
Response: { data: Agent[] }
```

**Create Agent**
```
POST /api/agents
Body: {
  name: string
  description?: string
  goal: string
  targetWebsite: string
  status?: "ACTIVE" | "PAUSED"
  configuration: {
    model: string
    maxSteps: number
    timeoutMs: number
    browserSettings: { headless, viewportWidth, viewportHeight }
  }
  scheduleType?: "MANUAL" | "DAILY" | "WEEKLY"
}
Response: { data: Agent }
```

**Get Agent**
```
GET /api/agents/[id]
Response: { data: Agent }
```

**Update Agent**
```
PATCH /api/agents/[id]
Body: Partial Agent fields
Response: { data: Agent }
```

**Delete Agent**
```
DELETE /api/agents/[id]
Response: { success: boolean }
```

**Execute Agent**
```
POST /api/agents/[id]/run
Body: {}
Response: { data: { runId: string, status: string } }
```

### Runs

**List User's Execution History**
```
GET /api/runs
Response: { data: Run[] }
```

**Get Run Details**
```
GET /api/runs/[id]
Response: { data: Run }
```

## 🎨 UI Components

### Layout Components
- **DashboardShell** - Main layout wrapper with sidebar & navbar
- **Sidebar** - Navigation with active state
- **Navbar** - User profile menu & logout
- **MobileNavigation** - Mobile drawer navigation

### Dashboard Components
- **StatsCard** - Display metrics (agents, runs, success rate)
- **AgentTable** - Agents list with actions
- **RunTable** - Execution history with sorting
- **StatusBadge** - Color-coded status indicator
- **EmptyState** - Helpful empty state messaging
- **ErrorState** - Error display with retry option
- **LoadingSkeleton** - Loading placeholder

### UI Primitives
- **Button** - 4 variants (primary, secondary, ghost, danger)
- **Card** - Container component
- **Badge** - Status/tag indicator

## 🔄 How Browser Execution Works

### Complete Workflow

1. **Agent Creation**
   - User fills form with agent details
   - Agent saved to database in PAUSED state
   - Configuration stored as JSON

2. **Agent Execution**
   - User clicks "Run" button
   - POST request to `/api/agents/[id]/run`
   - API creates new Run record in database
   - Run status: RUNNING

3. **Browser Automation**
   - Execution service receives agent configuration
   - Calls browser automation engine via execution boundary
   - Engine controls browser using Playwright
   - Captures results and events

4. **Result Capture**
   - Browser automation completes
   - Results saved to Run record
   - Status updated: SUCCESS or FAILED
   - Duration calculated

5. **UI Updates**
   - Dashboard polls or fetches latest data
   - Shows execution history
   - Displays results and status

### State Flow

```
PAUSED (initial)
   ↓
RUNNING (during execution)
   ↓
SUCCESS/FAILED (completed)
   ↓
Display in history
```

## 🧑‍💻 Development Guide

### Adding a New Dashboard Page

1. Create folder in `src/app/dashboard/[page-name]/`
2. Add `page.tsx` with your component
3. Page automatically protected by layout middleware
4. Use existing API endpoints for data

Example:
```typescript
// src/app/dashboard/analytics/page.tsx
export default function AnalyticsPage() {
  return <div>Analytics</div>
}
```

### Adding a New API Route

1. Create file in `src/app/api/[resource]/route.ts`
2. Import auth helpers for validation:
   ```typescript
   import { verifyAgentAccess, requireAuth } from '@/lib/api/route-helpers';
   ```
3. Validate authentication and ownership
4. Return JSON responses

Example:
```typescript
// GET handler
export async function GET(req: Request) {
  const user = await requireAuth();
  // ... fetch data
  return Response.json({ data: agents });
}
```

### Adding a New Database Model

1. Update `prisma/schema.prisma`
2. Create migration:
   ```bash
   pnpm prisma:migrate dev --name your_migration_name
   ```
3. Use generated types in your code

### Adding a Dashboard Component

1. Create file in `src/components/dashboard/`
2. Export React component
3. Use in pages or other components
4. Stick to functional components

## 🐛 Troubleshooting

### Database Connection Error
```
Error: P1002 Can't reach database server
```
**Solution:**
- Verify DATABASE_URL in .env.local
- Ensure PostgreSQL is running
- Check credentials and port

### Authentication Redirect Loop
```
Infinite redirect between /login and /dashboard
```
**Solution:**
- Verify BETTER_AUTH_SECRET is set
- Check BETTER_AUTH_URL matches your domain
- Clear browser cookies

### Prisma Type Errors
```
Cannot find module '@prisma/client'
```
**Solution:**
```bash
pnpm prisma:generate
```

### Port Already in Use
```
Error: listen EADDRINUSE: address already in use :::3000
```
**Solution:**
```bash
# Use different port
PORT=3001 pnpm dev

# Or kill existing process
lsof -ti:3000 | xargs kill -9
```

## 🔒 Security

- **Authentication**: All dashboard routes protected
- **Authorization**: Users can only access their own agents/runs
- **Input Validation**: Zod schemas validate all inputs
- **SQL Injection**: Prisma ORM prevents injection attacks
- **CSRF**: Next.js built-in CSRF protection
- **Secrets**: Environment variables never committed

## 📈 Performance

- **Server Components**: Pages use React Server Components where possible
- **Client Components**: Only interactive UI marked with 'use client'
- **Code Splitting**: Automatic Next.js code splitting
- **Caching**: Static pages cached, dynamic routes optimized
- **Bundle Size**: ~113KB First Load JS for dashboard

## 🚀 Deployment

### Environment Setup

Create `.env.production`:
```
DATABASE_URL=postgresql://prod-user:prod-pass@prod-host:5432/db
BETTER_AUTH_SECRET=your-production-secret
BETTER_AUTH_URL=https://yourdomain.com
```

### Build & Deploy

```bash
# Build
pnpm build

# Start
pnpm start
```

### Vercel Deployment

```bash
# Deploy to Vercel
vercel
```

Automatically detects Next.js app and deploys.

## 📚 Next Steps (Phase 3)

- [ ] Email notifications for agent runs
- [ ] Advanced scheduling (cron support)
- [ ] Team collaboration & sharing
- [ ] Audit logs for compliance
- [ ] Usage analytics & billing
- [ ] API keys for headless use
- [ ] Webhooks for external integrations
- [ ] Custom agent templates
- [ ] Execution logs viewer
- [ ] Performance monitoring dashboard

## 📝 License

MIT - See LICENSE file

## 🤝 Contributing

See CONTRIBUTING.md for guidelines

## 📞 Support

For issues or questions:
1. Check troubleshooting section
2. Review GitHub issues
3. Open new issue with details

---

Built with ❤️ for AI-powered web automation
