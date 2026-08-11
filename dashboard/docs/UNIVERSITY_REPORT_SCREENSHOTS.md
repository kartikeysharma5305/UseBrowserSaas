# University report screenshot checklist

Capture these from the deployed application using only the dedicated demo account. Redact email addresses, IDs, API keys, webhook secrets, cookies, URLs containing tokens, and unrelated browser content.

| Figure | Screen | Suggested caption | Demonstrates |
| ---: | --- | --- | --- |
| 1 | Login | Secure authentication entry point | Controlled access and production HTTPS |
| 2 | Dashboard | Browser Automation SaaS dashboard | Product overview and aggregate status |
| 3 | Agents | User-owned automation Agents | Agent catalogue and ownership scope |
| 4 | Agent creation | Configuring a browser Agent | Goal, safe target, model, and limits |
| 5 | Templates | Reusable Agent templates | First-run onboarding and fast setup |
| 6 | Agent detail | Wikipedia research Agent configuration | Qualified Nemotron model and bounded task |
| 7 | Run starting | Durable Run admitted to the queue | PostgreSQL/BullMQ execution lifecycle |
| 8 | Live timeline | Real-time execution events | SSE updates and browser reasoning progress |
| 9 | Browser screenshot | Captured browser state during execution | Playwright/Chromium artifact collection |
| 10 | Completed result | Successful public-web research output | End-to-end Agent result |
| 11 | Structured result | Schema-validated extracted data | Structured extraction and validation |
| 12 | Runs history | Durable execution history | Status, duration, retries, and auditability |
| 13 | Schedules | Scheduled Agent execution | Durable recurrence, pause, and skip controls |
| 14 | Notifications | In-app operational notifications | User-visible completion/failure feedback |
| 15 | Usage and plans | Resource and quota dashboard | Cost controls and measured consumption |
| 16 | API keys | Programmatic access management | Scoped public API authentication; redact keys |
| 17 | Webhooks | Outbound webhook management | Customer integration and delivery controls |
| 18 | Settings/privacy | Account privacy and lifecycle controls | Export, deletion, sessions, and preferences |
| 19 | Legal page | Terms, Privacy, or Acceptable Use | Governance and responsible-use policy |
| 20 | Architecture diagram | Deployed Railway architecture | Web, workers, PostgreSQL, Redis, Storage Bucket, and NVIDIA |

For Figures 7–11, use the same deployed Run so the report presents one coherent execution trail. Prefer a `SUCCESS` Run with `VALID` structured output and private Railway-Bucket-backed screenshots.
