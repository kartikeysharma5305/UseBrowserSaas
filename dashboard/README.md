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
  result        Json?       # Summary and visited URLs
  errorMessage  String?     # Error if failed
  events        AgentEvent[]
  artifacts     RunArtifact[]
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
  sequence  Int
  type      AgentEventType
  message   String
  data      Json?
  timestamp DateTime    @default(now())

  @@unique([runId, sequence])
}
```

Tracks bounded structured events in deterministic execution order.

### RunArtifact

```prisma
model RunArtifact {
  id            String          @id @default(cuid())
  runId         String
  run           Run             @relation(fields: [runId], references: [id], onDelete: Cascade)
  type          RunArtifactType
  storageKey    String          # Relative server-only key
  fileName      String
  mimeType      String
  size          Int
  stepNumber    Int?
  eventSequence Int?
  createdAt     DateTime        @default(now())
}
```

Stores screenshot metadata only. Image bytes remain in private artifact
storage and are served through authenticated APIs.

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

Billing is disabled in ordinary local development with `BILLING_ENABLED=false`;
Stripe variables are only required when explicitly enabling billing. See
`docs/BILLING_AND_SUBSCRIPTIONS.md` for the server-side billing workflow.
BETTER_AUTH_SECRET=your-random-secret-min-32-chars
BETTER_AUTH_URL=http://localhost:3001
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3001
DATABASE_URL=postgresql://user:password@localhost:5432/browser_use_dashboard
REDIS_URL=redis://127.0.0.1:6379
GROQ_API_KEY=your-groq-key
ARTIFACT_STORAGE_DRIVER=local
ARTIFACT_STORAGE_ROOT=./browseruse_agent_data/artifacts
ARTIFACT_MAX_BYTES_PER_RUN=26214400
```

Production S3-compatible settings are documented in
`docs/OBJECT_STORAGE.md`. Plan-based concurrency and retention come from the
server catalogue rather than environment variables.

Generate a secure secret:

```bash
openssl rand -base64 32
```

## 🚀 Getting Started

### One-command local development

The normal full-stack workflow is run from the repository root:

```bash
pnpm dev:all
```

It validates environment and service connectivity, builds `../dist`, runs
Prisma generate and a read-only migration status check, then supervises the
engine watcher, this Next.js dashboard, and the standalone worker. Their logs
are prefixed `engine`, `dashboard`, and `worker`. Open
`http://localhost:3001`; press `Ctrl+C` once to stop all three. Restart the
command after changing `.env.local`; Next.js and the worker read environment at
process startup.

External-service mode expects PostgreSQL on the configured `DATABASE_URL` and
Redis on `REDIS_URL`. Docker mode is available from the root:

```bash
pnpm dev:infra
pnpm setup:local
pnpm dev:all:docker
pnpm dev:infra:stop
pnpm dev:infra:reset
```

The development Compose file starts only PostgreSQL on port 5432 and Redis on
6379. It does not containerize the dashboard, worker, or engine. `dev:all` and
`dev:all:docker` never apply migrations; `setup:local` explicitly uses
`prisma migrate deploy` and never resets data. `dev:infra:reset` is destructive
because it removes the development PostgreSQL and Redis volumes.

Preflight failures are non-secret and actionable. Check `.env.local`, service
availability, S3 bucket access when selected, and whether port 3001 is already
occupied. If migration status reports pending migrations, run
`pnpm setup:local`. A child-process failure stops the complete command. Use
`pnpm dashboard:queue:health` from the repository root to verify Redis queue
health and connected worker counts. Local artifact storage uses
`ARTIFACT_STORAGE_DRIVER=local` and `ARTIFACT_STORAGE_ROOT`; S3-compatible
storage uses `ARTIFACT_STORAGE_DRIVER=s3` plus the private `S3_*` settings.

### Prerequisites

- Node.js 20+
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

Visit `http://localhost:3001`

### Available Commands

```bash
# Development
pnpm dev              # Start dev server on :3001
pnpm lint             # Run ESLint
pnpm typecheck        # Check TypeScript

# Building
pnpm build            # Build for production
pnpm start            # Run production build

# Database
pnpm prisma:generate  # Generate Prisma client
pnpm prisma:migrate   # Create & run migrations

# Reliability maintenance
pnpm maintenance:recover-stale-runs
pnpm maintenance:cleanup-artifacts              # Dry-run
pnpm maintenance:cleanup-artifacts -- --apply   # Delete expired artifacts
pnpm artifacts:health                           # Verify configured private storage
pnpm artifacts:migrate                          # Dry-run local-to-S3 migration
pnpm usage:reconcile                            # Dry-run usage repair
pnpm plans:assign -- --email=user@example.com --plan=PRO

# Durable execution
pnpm worker:browser
pnpm queue:health
pnpm queue:recover                 # Dry-run
pnpm queue:recover -- --apply
pnpm queue:test                    # Isolated Redis delivery check
pnpm worker:test                   # Disposable Groq/Chromium worker check
pnpm phase4:test:runtime           # Authenticated 202 and web-restart drill
pnpm phase4:test:reliability       # Retry, backpressure, recovery fixtures
pnpm phase4:test:worker-recovery   # Forced worker-crash recovery
pnpm phase4:test:redis             # Isolated Redis interruption
pnpm phase4:test:shutdown          # Host SIGTERM behavior
pnpm phase4:linux:snapshot [pid]   # Linux PID/PGID/browser snapshot
pnpm phase4:linux:runtime          # Set PHASE4_LINUX_DRILL first
pnpm phase4:linux:cleanup          # Remove Linux drill-owned fixtures
```

### Groq Model Policy

The dashboard is Groq-only. Its policy is centralized in
`src/lib/execution/groq-models.ts` and was checked against the configured
account on 2026-07-25. The current model is
`groq_llama-3.3-70b-versatile`, executed in text-only mode. Create/update
validation, form options, worker normalization, and tests share that allowlist.
Stored stale models are not rewritten automatically: execution returns
`INVALID_AGENT_CONFIGURATION`, and the agent detail page lets an owner select
the supported model.

Account model availability does not guarantee capacity. A later closure drill
received a safe Groq `429` after the rolling token quota was consumed; workers
do not silently substitute another model.

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
    model: "groq_llama-3.3-70b-versatile"
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
Response: {
  data: {
    runId, status: "QUEUED", detailsUrl
  }
}
```

The route returns HTTP `202`. It creates a durable owned Run and a BullMQ job;
it never launches Chromium. Jobs contain only a version and Run ID. The
standalone worker loads trusted task/configuration data from PostgreSQL,
acquires a lease, heartbeats while executing, and persists terminal state.
The worker records the effective model on `RUN_STARTED`.

### Phase 4 Closure Status

Phase 4 is complete as of 2026-07-25. Ubuntu/WSL2 drills proved real Linux
`SIGTERM`, bounded active-run abort, zero worker-owned Chromium orphans,
`SIGKILL` lease recovery, concurrency 1 and 2 browser backpressure, live
admission controls, and a 3.082-second restart of the dedicated AOF-backed
Redis instance.

The final server-only fail-first verification used the supported
`groq_llama-3.3-70b-versatile` model and a reloaded Groq credential. Attempt 1
failed as retryable `EXECUTION_UNAVAILABLE`, produced no browser or artifact,
released its lease, and entered BullMQ backoff. Attempt 2 reused the same Run,
launched real Chromium, reached `SUCCESS` in 7,755 ms, persisted one PNG, and
left one terminal `RUN_COMPLETED` event with unique event sequences. Owner
artifact access returned 200, cross-user access returned 404, no orphan
Chromium remained, and disposable state was removed.

Linux production examples live under `deploy/systemd/`. The worker unit uses
`KillSignal=SIGTERM`, `TimeoutStopSec=45s`, and `KillMode=mixed`: Node receives
the graceful signal first, while systemd retains a bounded cgroup cleanup path
for descendants. Build root `dist/` before starting the worker.

Safe execution errors include:

| Code                       | HTTP | Meaning                                                                    |
| -------------------------- | ---: | -------------------------------------------------------------------------- |
| `AGENT_RUN_ALREADY_ACTIVE` |  409 | The agent already has an active run; the response may include its safe ID. |
| `USER_RUN_LIMIT_REACHED`   |  429 | The authenticated user reached their active-run limit.                     |
| `QUEUE_BACKPRESSURE`       |  429 | The configured waiting queue limit was reached.                            |
| `QUEUE_UNAVAILABLE`        |  503 | Redis is unavailable or misconfigured.                                     |
| `RUN_ENQUEUE_FAILED`       |  503 | The reserved run could not be submitted.                                   |
| `EXECUTION_TIMED_OUT`      |  504 | The run exceeded its configured wall-clock deadline.                       |
| `EXECUTION_UNAVAILABLE`    |  503 | Required local execution infrastructure is unavailable.                    |
| `EXECUTION_FAILED`         |  500 | Execution failed without exposing internal details.                        |

### Runs

**List User's Execution History**

```
GET /api/runs
Response: { data: Run[] }
```

**Get Run Details**

```
GET /api/runs/[id]
Response: { data: { ...Run, events: OrderedEvent[], artifacts: ArtifactMetadata[] } }
```

**List Run Artifacts**

```
GET /api/runs/[id]/artifacts
Response: { data: ArtifactMetadata[] }
```

**Read Screenshot Artifact**

```
GET /api/runs/[id]/artifacts/[artifactId]
Response: private PNG/JPEG image
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
   - API serializes per-user admission in PostgreSQL
   - Partial unique index blocks a second active run for the same agent
   - API creates a `QUEUED` Run and `RUN_CREATED` event
   - API submits `{ version, runId }` to BullMQ and returns `202`

3. **Browser Automation**
   - A separately supervised worker claims the Run with a database lease
   - Worker loads owned agent configuration from PostgreSQL
   - Calls browser automation engine behind the configured hard deadline
   - Engine controls browser using Playwright
   - Persists bounded events and screenshot metadata during execution
   - Timeout or owned cancellation requests cooperative stop, browser close,
     and listener detach

4. **Result Capture**
   - Browser automation completes
   - Results saved to Run record
   - Status updated atomically: SUCCESS, FAILED, TIMED_OUT, or CANCELED
   - Duration calculated
   - Guarded transitions prevent late terminal writes from overwriting timeout
     or cancellation

5. **UI Updates**
   - Run detail opens an authenticated SSE stream
   - Event sequence IDs support reconnect-safe replay
   - Redis lowers update latency; PostgreSQL polling recovers missed notices
   - The owner can cancel a queued or running Run

### State Flow

```
QUEUED (accepted by API)
   ├─ CANCELED (owner cancels before claim)
   ↓ worker lease
RUNNING (worker execution)
   ↘ QUEUED (bounded infrastructure retry)
   ↓
SUCCESS/FAILED/TIMED_OUT/CANCELED (terminal)
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
- Check BETTER_AUTH_TRUSTED_ORIGINS includes your domain
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
BETTER_AUTH_TRUSTED_ORIGINS=https://yourdomain.com
REDIS_URL=rediss://your-managed-redis
ARTIFACT_STORAGE_DRIVER=s3
S3_REGION=us-east-1
S3_BUCKET=your-private-artifact-bucket
S3_ACCESS_KEY_ID=server-only-access-key
S3_SECRET_ACCESS_KEY=server-only-secret-key
SSE_HEARTBEAT_MS=15000
SSE_FALLBACK_POLL_MS=2000
SSE_MAX_CONNECTIONS_PER_USER=5
SSE_MAX_CONNECTIONS_PER_RUN=3
SSE_MAX_CONNECTION_DURATION_MS=1800000
CANCELLATION_CHECK_INTERVAL_MS=1000
```

### Build & Deploy

```bash
# Build
pnpm build

# Start
pnpm start

# In a separately supervised process
pnpm worker:browser
```

### SSE Reverse Proxy

The stream route requires a long-running Next.js Node process. Disable reverse
proxy buffering and keep the read timeout above the configured heartbeat:

```nginx
location ~ ^/api/runs/[^/]+/stream$ {
    proxy_pass http://dashboard;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 31m;
    add_header X-Accel-Buffering no;
}
```

Multiple dashboard instances do not require sticky sessions. Redis notifies
instances about changes and PostgreSQL replays durable events after reconnect.

## 📚 Next Step

Phase 6B: billing-provider integration, subscription lifecycle, and durable
account-deletion cleanup for remote artifacts. Phase 6A object storage, usage
metering, plans, quotas, retention, and reconciliation are implemented.

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
