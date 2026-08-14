# Browser execution safety

## Threat model and trust boundaries

Agent goals, variables, target URLs, model actions, redirects, page content, and DNS answers are untrusted. The guarded risks are SSRF into loopback/private/link-local/metadata networks, hostname and suffix confusion, DNS answers that mix public and internal addresses, unsafe schemes, cross-domain redirects, popups, downloads/uploads, destructive forms, purchases, sensitive-domain access, URL credential leakage, cross-owner configuration access, and policy changes after a Run is queued.

The authenticated API validates owner-scoped Agent policy. Run admission resolves variables and stores the effective policy in `Run.executionSafetyPolicy`. BullMQ carries only the Run ID. The worker reads the immutable Run fields and supplies the policy to the existing browser engine boundary. The model is never trusted to enforce policy.

## Durable policy and defaults

`Agent.safetyPolicy` is additive JSON validated by a strict Zod contract. Null policies on pre-Phase-11 Agents normalize to a compatibility-safe policy whose sole allowed domain is the explicit target hostname. `Run.executionSafetyPolicy` is the immutable admission snapshot used by retries and scheduled Runs.

Defaults are exact target-domain only, no subdomains, same-domain redirects, `SAFE_ONLY` forms, 20 navigations, 3 pages, source-controlled sensitive domains blocked, destructive actions blocked, and downloads/uploads/payments always blocked. User policy cannot enable downloads, uploads, or payments in Phase 11.

## Domain, URL, DNS, and IP policy

Domains are lowercased, trailing dots are removed, Unicode is converted with `domainToASCII`, labels are validated, and duplicates/wildcards/paths/ports are rejected in domain fields. Matching is exact or label-aware subdomain matching; raw `endsWith(domain)` is not used. URL checks independently reject credentials and every scheme other than HTTP(S).

Before initial and model-requested navigation, the worker resolves DNS and fails closed if lookup fails, returns no answers, or any answer is loopback, RFC1918, carrier-grade NAT, link-local, multicast, reserved/documentation, IPv6 unique-local/link-local/multicast, or a mapped unsafe IPv4 address. The cloud metadata address is covered by link-local blocking. Every observed post-action URL is revalidated and re-resolved. The root engine's allowed/prohibited-domain and IP-literal controls remain active as a second boundary and roll disallowed pages back to `about:blank`.

Redirects are same-domain by default. `ALLOWED_DOMAINS` permits redirects only to another explicitly allowed domain. The dashboard guard uses a Chromium DevTools `Fetch` request-stage hook for document requests, so a redirected document is checked before its request is continued. New tabs pass the same checks and are bounded by `maxPages`; navigation identity changes are bounded by `maxNavigations`.

## Actions, files, and sensitive domains

Click metadata is checked before execution. Payment/purchase semantics are always rejected. Destructive semantics are rejected unless the Agent explicitly enables them. Form modes are `BLOCKED`, `SAFE_ONLY`, and `ALLOWED`; blocked mode rejects both text entry and submission, while safe-only permits ordinary forms such as login but rejects financial and destructive submission semantics. Secret-backed input is domain-scoped and each resolved value can be entered only once per Run. These checks use deterministic action/DOM metadata where available. Free-form coordinate clicks and arbitrary page semantics cannot be classified perfectly; deployment-level browser isolation remains required.

Browser downloads are disabled in the profile, no download directory is exposed, and blocked downloads never enter artifact persistence. Upload actions are rejected before filesystem access. The maintainable source-controlled sensitive-domain category currently covers representative payment, banking/crypto, password-manager, email, and cloud-console services; it is conservative rather than globally comprehensive.

## APIs, UI, and failures

Agent create/update APIs accept no user ID, verify ownership at both route and query boundaries, validate domains and bounds, and return sanitized errors. Create and detail screens expose a responsive Safety section and clearly mark worker-enforced/always-blocked capabilities. Existing Agent responses show their normalized effective policy.

Stable persisted codes are `DOMAIN_NOT_ALLOWED`, `DOMAIN_BLOCKED`, `PRIVATE_NETWORK_BLOCKED`, `UNSAFE_SCHEME_BLOCKED`, `REDIRECT_BLOCKED`, `NAVIGATION_LIMIT_EXCEEDED`, `PAGE_LIMIT_EXCEEDED`, `DOWNLOAD_BLOCKED`, `UPLOAD_BLOCKED`, `FORM_SUBMISSION_BLOCKED`, `DESTRUCTIVE_ACTION_BLOCKED`, `PAYMENT_ACTION_BLOCKED`, and `SENSITIVE_DOMAIN_BLOCKED`. Public messages contain no full URL, DNS answer, private IP, path, stack, or rule internals.

## Scheduling, templates, variables, deletion, and recovery

Manual and scheduled admissions share `PrismaRunProducer`, so both snapshot policy after variable interpolation. A rendered URL that escapes the allowlist fails admission. Templates and legacy Agents receive safe normalization even when no policy row was previously written. Edits affect future Runs only; retries keep the same Run snapshot. Agent/account deletion relies on existing cascading Agent/Run behavior and admission blocking. No blocked download artifact is created.

## Operations and verification

Focused tests: `pnpm test:execution-safety`. Normal development remains `pnpm dev:all`. Prisma deployment applies `20260807010000_phase11_execution_safety` before workers start.

Phase 11 automated coverage includes canonical domains and IDNs, suffix attacks, URL credentials/schemes, public/private IPv4 and IPv6, mixed DNS answers, DNS failure, redirect/navigation/page limits, payment/destructive/form/upload guards, immutable worker snapshots, ownership, and responsive UI contracts.

Sanitized local runtime evidence (2026-08-06): the authenticated API drill created two disposable users, persisted an owner policy, returned the project-standard cross-owner 404, preserved a queued Run policy after an Agent edit, rejected a URL-variable allowlist escape and unsafe scheme, and produced a real worker-terminal `PRIVATE_NETWORK_BLOCKED` result without persisting the attempted address. Both disposable users and their cascading resources were removed. A separate real Chromium session reached the public example domain and blocked a cross-domain target, localhost, the metadata address, an unsafe scheme, and a second page at the configured limit. No real private or financial service was contacted.

Focused live-browser closure used a loopback-only disposable HTTP server plus Chromium host mapping for controlled `.test` hostnames; the safety resolver received a deterministic public test answer so no private service was contacted. The allowed redirect origin was requested once, while the disallowed redirected document was stopped at the CDP request stage and its server route received zero requests. Exact-parent navigation succeeded, the controlled subdomain was rejected with subdomains disabled and succeeded when enabled, and a suffix-confusion hostname received zero requests. A queued application Run retained `allowSubdomains=false` after its Agent was edited to `true`.

Two distinct document navigations succeeded under a limit of two; the third and a repeated attempt both returned `NAVIGATION_LIMIT_EXCEEDED`, and the third route received zero requests. A real tiny attachment response raised a browser download, was canceled, returned `DOWNLOAD_BLOCKED`, produced no retained download path or browser download entry, did not change `RunArtifact` count, and left the scoped disposable download directory empty. A real controlled purchase form supplied tag, accessible-name, form-role, and structured action metadata; `PAYMENT_ACTION_BLOCKED` was raised before click/submission and the submission route received zero requests. The five stable closure codes were stored with public messages only; stored evidence contained no controlled hostname, redirect query, resolved address, download path, form value, stack, or secret. Disposable database and filesystem fixtures were removed.

## Residual risk and deferred work

Pre-navigation DNS resolution plus request-stage and post-navigation re-resolution reduces but does not eliminate DNS rebinding between lookup and the browser connection; production should add egress firewalling, resolver pinning, and container/network isolation. Semantic classification is strongest for indexed DOM actions with deterministic attributes and cannot perfectly infer every consequence of coordinate/keyboard interaction, custom canvas controls, or non-English labels. Phase 11 does not add credentials, authenticated profiles, unrestricted file transfer, payment automation, CAPTCHA bypass, proxies, or arbitrary security scripts.
