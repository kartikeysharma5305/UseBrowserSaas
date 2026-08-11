# Closed beta go/no-go checklist

## Technical

- [ ] Staging preflight and current migration check pass.
- [ ] Backup and restore drill are current.
- [ ] Dashboard, workers, queues, scheduler, and notification/webhook consumers are healthy.
- [ ] Legal identity/contact configuration and public legal pages are reviewed.
- [ ] Invite signup, legal acceptance, suspension, feedback, export, and deletion drills pass.
- [ ] `SUPPORT_CONTACT_EMAIL`, `APP_RELEASE_ID`, beta capacity, plan quotas, and cost controls are configured.
- [ ] Operations visibility and alert routing work without sensitive labels.

## Operational

- [ ] Named operator owns invite issuance and feedback review.
- [ ] Operator understands SEV workflow, execution kill switch, worker drain, and rollback.
- [ ] Capacity is no more than measured worker/provider/storage support.
- [ ] Release identifier and change note are recorded.

## Legal/business

- [ ] Phase 25 beta legal decisions are complete for invited testing.
- [ ] Testers are not promised public availability or automatic paid conversion.
- [ ] No public-launch claim is made.

## Phase 28 launch gates

Starting thresholds are documented in `CLOSED_BETA.md` and must be adjusted using beta evidence. Go requires zero unresolved critical security/data-loss issues, stable queues, a valid restore drill, acceptable cohort reliability/cost, completed public-launch legal gates, and production infrastructure. Any failed gate is a no-go.
