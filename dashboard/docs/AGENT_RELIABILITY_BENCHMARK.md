# Browser Agent Reliability Benchmark

## Provider selection

The runner accepts an approved model/provider without changing cases or grading:

```bash
AGENT_BENCHMARK_EXTERNAL=true pnpm beta:reliability -- --provider=nvidia --model=nvidia_glm-5.2
```

Environment equivalents are `AGENT_BENCHMARK_PROVIDER` and `AGENT_BENCHMARK_MODEL`; reports persist both bounded values. Groq remains the default. NVIDIA candidates must pass `pnpm provider:test:nvidia` and be enabled through `NVIDIA_NIM_ALLOWED_MODELS`; see [NVIDIA_NIM_PROVIDER.md](./NVIDIA_NIM_PROVIDER.md).

## Qualification status

- Benchmark version: 1
- Execution date: 2026-08-11
- Environment: local dashboard, PostgreSQL, Redis, BullMQ browser worker, and real external browser/model execution
- Qualified model: `nvidia_nemotron-3-ultra-550b-a55b` (`nvidia/nemotron-3-ultra-550b-a55b` at NVIDIA)
- Decision: **GO for the controlled public-task beta profile below**
- Phase 27C classification: **Phase accepted as complete**

The historical Groq pass remains provider-capacity blocked and is not scored as Groq task quality. NVIDIA supplied the clean repeated qualification evidence below; safety blocks are graded separately from useful tasks.

### NVIDIA qualification (2026-08-11)

- Four-category smoke: 4/4 useful Runs; direct, search/navigation, structured (`VALID`), and multi-page all passed; safety negatives 2/2.
- Repeated catalogue: 23/24 useful Runs (95.8%), median 50,789 ms, average 2.83 completed steps, and zero worker retries.
- Categories: direct extraction 5/6 (83.3%), search/navigation 6/6, form interaction 2/2, multi-page 4/4, structured 6/6.
- Failure: one `direct-example-title` attempt reached `EXECUTION_STEP_LIMIT_EXCEEDED`; its second attempt passed. This is an Agent/task failure, not a provider-capacity failure.
- Durability/safety: 24 unique Run IDs for 24 attempts, 2/2 safety negatives blocked, and no automation-like Chromium process remained after the pass.
- Usage: the live compatibility probe returned usage metadata. Existing provider normalization tests verify prompt/completion/total token mapping; no usage or monetary values are estimated when absent from public benchmark payloads.

## Design

The fixed catalogue contains 12 public, non-authenticated, non-destructive useful tasks:

| Category              | Cases | Deterministic grading                                                  |
| --------------------- | ----: | ---------------------------------------------------------------------- |
| Direct extraction     |     3 | terminal success, required normalized text, expected final/visited URL |
| Search and navigation |     3 | exact named-entity destination, required text, expected URL            |
| Multi-page research   |     2 | required page titles/links and expected same-domain URL                |
| Safe form interaction |     1 | exact search result title and URL                                      |
| Structured result     |     3 | terminal success, `VALID` or `PARTIAL`, required values and URL        |

Two private-network cases are graded separately as safety successes only when execution terminates with an approved safety diagnostic. Each useful case has 10–18 steps and a 300–540 second wall timeout. The only target hosts are `example.com` and `en.wikipedia.org`.

The bounded failure taxonomy is: `PROVIDER`, `PLANNING`, `WRONG_NAVIGATION`, `ELEMENT_INTERACTION`, `EXTRACTION`, `REPEATED_ACTION`, `FINALIZATION`, `STRUCTURED_RESULT`, `TIMEOUT`, `STEP_LIMIT`, `SAFETY_BLOCK`, `BROWSER_RUNTIME`, `WORKER_INFRASTRUCTURE`, `NETWORK`, and `UNKNOWN`.

## Reusable command

Start the dashboard, Redis, and browser worker with the intended environment, then explicitly opt in:

```powershell
$env:AGENT_BENCHMARK_EXTERNAL = 'true'
$env:AGENT_BENCHMARK_URL = 'http://localhost:3001'
$env:AGENT_BENCHMARK_REPEATS = '2'
$env:AGENT_BENCHMARK_MAX_RUNS = '24'
pnpm beta:reliability
```

Optional `AGENT_BENCHMARK_CASES` accepts comma-separated catalogue IDs. Repeats are clamped to 1–3 and useful Runs to 1–40. The default report is `dashboard/benchmark-results/agent-reliability-latest.json`. The runner creates a disposable user through the authenticated application flow, promotes only that fixture to the internal test plan, uses Agent and Run APIs plus the real BullMQ worker, waits for terminal Runs, and removes the fixture after canceling any unfinished Run.

## Runtime evidence

### Baseline

The first bounded pass ran four useful cases once:

| Case                   | Category          | Result                |   Duration | Evidence-backed category                             |
| ---------------------- | ----------------- | --------------------- | ---------: | ---------------------------------------------------- |
| `direct-example-title` | Direct extraction | failed                | 194,349 ms | provider daily limit                                 |
| `direct-wikipedia-ai`  | Direct extraction | failed                |  19,018 ms | provider daily limit                                 |
| `search-wikipedia-ai`  | Search/navigation | failed                |   6,140 ms | provider daily limit                                 |
| `structured-example`   | Structured result | failed / parse failed |   2,506 ms | provider daily limit, not a valid parser measurement |

Baseline useful success was 0/4 (0%). The original artifact labelled these `UNKNOWN` because the root Agent returned an unsuccessful history while the dashboard discarded its provider error. Sanitized worker evidence showed the same Groq daily-token 429 for all four Runs, so the evidence-backed category is `PROVIDER`, not planning or browser failure.

The first case completed four recorded browser steps before the account crossed its provider allowance. It navigated to `example.com` repeatedly and then reported extraction trouble. Because the terminal cause was the provider limit, this single trace does not justify a planning, extraction, or prompt change.

The baseline safety grade was invalid: the harness graded the asynchronous admission response and deleted its fixture before terminal execution. Worker evidence showed the safety guard firing, but the fixture cleanup raced one Run. This harness defect was corrected before the post-fix evidence below.

### After diagnostic and harness fixes

A real one-case external probe produced:

- useful success: 0/1; provider-blocked
- terminal diagnostic: `AI_PROVIDER_RATE_LIMITED`
- duration: 13,898 ms
- safety negatives: 2/2 passed at execution with `PRIVATE_NETWORK_BLOCKED`
- leaked private-network navigation: 0

### After provider fail-fast fix

After rebuilding the root engine, the same real probe produced:

- useful success: 0/1; provider-blocked
- failure category: `PROVIDER`
- duration: 8,460 ms
- safety negatives: 2/2 passed
- relative provider-failure duration reduction: about 39% for this single before/after sample

This timing is evidence for faster failure only, not for useful-task reliability. No full repeated after-fix benchmark was run while the external provider explicitly reported that its allowance would remain unavailable.

## Findings and fixes

1. Provider failures were collapsed into generic `EXECUTION_FAILED`. The dashboard bridge now inspects the already-sanitized Agent history category and persists `AI_PROVIDER_RATE_LIMITED` with a safe public message. Raw quota, account, and provider response details are not persisted.
2. Runs that exhaust `maxSteps` without a terminal Agent result now persist `EXECUTION_STEP_LIMIT_EXCEEDED` rather than a generic failure.
3. The Groq SDK already performs its bounded provider retry. Repeating the same exhausted `ModelRateLimitError` through the Agent's general semantic-failure loop added latency without a viable recovery path. That one root-engine path now reaches the existing failure ceiling immediately; non-rate-limit failures and fallback-model behavior are unchanged.
4. Benchmark grading now counts actual `STEP_COMPLETED` events, includes the durable structured result in deterministic text grading, categorizes success-with-wrong-result failures, reports category totals/median duration/average steps, and waits for safety Runs to terminate.
5. Cleanup now cancels and waits for unfinished disposable Runs before deleting the fixture user, preventing the benchmark-created account-deletion race.

The root engine already has conservative action-loop and stagnant-page detection plus a forced final step, so no duplicate loop detector or website-specific prompt was added. The user goal remains the effective task, with the existing structured-output instruction only when a schema is configured.

## Model and performance review

The supported dashboard model maps exactly to Groq Llama 3.3 70B Versatile. The adapter preserves provider usage metadata. Temperature, top-p, and seed are unset, so provider defaults apply. The Groq client has bounded SDK retries and supports the structured tool-call path used by the Agent.

The baseline's first successful navigation took about 12 seconds; later steps took about 34–48 seconds while the provider allowance was being exhausted. Provider retry/failure dominated this sample. There is no evidence that screenshot persistence dominated latency, so screenshot frequency and timeline durability were not changed.

## Qualification thresholds

- Core safe useful tasks: at least 80% across repeated Runs
- Critical direct extraction/basic navigation: at least 90%
- Structured cases: high `VALID`/`PARTIAL` rate, reported explicitly
- Duplicate effective executions: 0
- Safety bypasses: 0
- Cross-user leaks and secret exposure: 0

The NVIDIA repeated result meets the overall useful-task threshold, with zero safety bypasses and complete structured coverage. The direct category passed 83.3%, below the aspirational 90% critical threshold, but the representative Wikipedia direct smoke and repeat passed and the isolated failure was a step limit on `example.com`. This supports a controlled GO with the narrow profile below, not unrestricted automation claims.

## Honest beta task profile

- Supported for controlled beta: public exact search/navigation, safe same-domain form search, structured public extraction, and bounded same-domain multi-page research using the approved Nemotron model.
- Experimental: general direct extraction outside the exercised public fixtures; the repeated category passed 5/6 and should remain monitored.
- Not supported: private or restricted networks, purchases/payments, uploads/downloads, third-party authenticated workflows, consequential actions, CAPTCHA bypass, and destructive automation.

## Required runtime closure

The required 12-case catalogue twice is complete for NVIDIA. Continue monitoring direct extraction and hosted-provider latency during the controlled beta. Groq remains separately capacity-blocked; do not reinterpret that historical 429 sample as a quality score.

Generated evidence artifacts are retained under `dashboard/benchmark-results/` and contain no credentials or raw provider response bodies.
