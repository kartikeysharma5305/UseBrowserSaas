# University demonstration checklist

Target duration: 5–10 minutes. Use only the dedicated university demo account and the deployed Railway URL.

## Before presenting

- Confirm web readiness, browser-worker heartbeat, Redis/PostgreSQL health, and NVIDIA availability.
- Confirm the Wikipedia showcase Agent has a recent successful Run with visible Railway-Bucket-backed screenshots and a `VALID` structured result.
- Keep one fresh Run available for the live demonstration; do not rely solely on a pre-recorded result.
- Close unrelated tabs, notifications, secrets, Railway logs, and personal accounts.

## Demo sequence

1. Open the HTTPS Railway URL and explain invite-controlled access.
2. Log in with the dedicated `UNIVERSITY DEMO` account.
3. Show dashboard Run/Agent/usage summaries.
4. Open Agents and briefly show the Wikipedia research Agent.
5. Optionally create an Agent from a template to demonstrate onboarding.
6. Show the approved NVIDIA Nemotron provider/model and bounded safety settings.
7. Start the Agent and show that admission uses the durable Run queue.
8. Open the live Run view and point out status changes and the event timeline.
9. Show a browser screenshot event without exposing unrelated data.
10. Show the completed natural-language result and final public URL.
11. Show the validated structured result and its schema status.
12. Open Schedules and explain durable one-time/daily/weekly execution without triggering an unnecessary Run.
13. Open Usage and explain quotas, steps, execution duration, storage, and provider-reported tokens where available.
14. Optionally show API keys/webhook configuration without revealing any token or secret.
15. Finish with Settings, privacy/export/deletion controls, and the legal pages.

If the live provider is slow, keep the Run page open and use the prior successful Run for the remaining explanation. Never switch to an unapproved model or weaken safety during the presentation.
