# Live closed beta report

## Current decision

**LIVE BETA READY — AWAITING TESTERS**

This is a readiness checkpoint, not real-user evidence. As of 2026-08-11 the local database contains no beta invites, accepted testers, active testers, tester-owned Agents or Runs, or beta feedback. Phase 28 must not begin from synthetic benchmark evidence alone.

## Release and operating posture

- Release: `beta-2026-08-11-01`
- Deployment timestamp: pending deployment
- Benchmark version: 1
- Approved browser model: `nvidia_nemotron-3-ultra-550b-a55b`
- Initial capacity ceiling: 5 active beta users
- Migrations: 20 found; local database current
- Legal document versions: Terms, Privacy, and AUP `2026-08-10-beta.1`
- Closed-beta mode and capacity are prepared locally. A real beta environment still requires operator support/legal contacts, legal entity identity, backup target and verification, deployment health/readiness, and healthy worker checks.

Unapproved NVIDIA candidates remain hidden. Groq remains optional and must not be used as the beta qualification basis while its provider capacity is constrained. Signup must remain invite-bound and no tester receives INTERNAL or an automatic paid subscription.

## Evidence ledger

| Measure | Current real-user evidence |
| --- | ---: |
| Invites issued | 0 |
| Invites accepted | 0 |
| Registered testers | 0 |
| Active testers | 0 |
| Agents created | 0 |
| Useful Runs completed | 0 |
| Feedback submitted | 0 |

Run reliability, task correctness, structured-result quality, repeat usage, support burden, live capacity, user feedback, and beta cost sustainability are therefore **not yet measured**. The separate synthetic NVIDIA qualification remains 4/4 smoke and 23/24 repeated useful Runs, with 2/2 safety negatives; it is not counted as live-beta evidence.

## Initial tester guidance

- Supported: public-web extraction, public search/navigation, safe same-domain forms, structured extraction, and bounded public multi-page research.
- Experimental/monitored: general direct-extraction edge cases, highly dynamic SPAs, complex sites, and long research chains.
- Unsupported: private networks, purchases/payments, unsupported credential workflows, blocked uploads/downloads, CAPTCHA bypass, and destructive or consequential actions.

The desired first session is invite signup, legal acceptance, Agent creation, first safe Run, result inspection, optional structured output, and one feedback item. Existing privacy rules apply; do not add raw task-text analytics.

## Launch gates and collection plan

Collect evidence from at least 5 genuine invitees, at least 3 active testers, and preferably 30–50 representative useful Runs across multiple users and categories. Track existing funnel, bounded failure taxonomy, Nemotron provider outcomes, queue/worker metrics, structured status, Phase 21 usage, feedback, safety blocks, and repeat use. Do not issue placeholder invites or manufacture activity.

Public-launch evaluation starts at 90% core useful success, 85% direct extraction, 90% search/navigation, and 90% `VALID`/`PARTIAL` among schema-requested successful Runs, with zero duplicate effective executions, safety bypasses, cross-user leaks, known data-loss defects, unresolved SEV-1 defects, or repeated unresolved SEV-2 defects.

## Exact next action

Configure real support/legal contacts, legal entity identity, backup destination and deployment secrets; deploy this release to the protected beta environment; verify health/readiness and all enabled workers; then provide five genuine tester email addresses to an authorized operator for individual expiring invites. Update this report only from aggregate real-user evidence.
