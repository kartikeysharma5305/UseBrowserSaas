# NVIDIA NIM model provider

## Architecture

NVIDIA hosted NIM is a second execution provider; Groq remains supported. Selection changes only the model-construction boundary:

`Agent configuration -> immutable Run executionConfiguration -> worker -> getLlmByName -> ChatGroq or ChatNvidia -> existing browser Agent`

There is no fallback or second execution pipeline. Manual, scheduled, and public-API Runs retain the existing admission, quota, BullMQ, timeout, step, storage, and safety controls.

NVIDIA's hosted chat endpoint is OpenAI-compatible at `https://integrate.api.nvidia.com/v1/chat/completions`. The adapter fixes that endpoint, uses non-streaming responses, a 60-second request timeout, and two SDK retries. Sources: [NVIDIA NIM LLM API reference](https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html) and [NVIDIA model catalog](https://build.nvidia.com/models).

## Configuration and approval

```dotenv
NVIDIA_API_KEY=<server-only-key>
NVIDIA_NIM_ALLOWED_MODELS=nvidia_glm-5.2
```

The key is optional when NVIDIA is unused. With execution enabled, deployment validation requires at least one of `GROQ_API_KEY` or `NVIDIA_API_KEY`. The NVIDIA key is never public, persisted, returned by APIs, or used as a metric label.

Candidates are bounded in code, but a candidate is not selectable until the compatibility probe reports `SUPPORTED` and its exact ID is recorded in `NVIDIA_NIM_ALLOWED_MODELS`. The authenticated model-options endpoint returns only approved models whose provider key is configured. Arbitrary provider names, models, base URLs, and customer-supplied credentials are rejected.

| Dashboard ID                        | NVIDIA API model                    | 2026-08-11 live result                                      |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| `nvidia_nemotron-3-ultra-550b-a55b` | `nvidia/nemotron-3-ultra-550b-a55b` | Supported and approved                                      |
| `nvidia_glm-5.2`                    | `z-ai/glm-5.2`                      | Incompatible: basic chat did not complete in the probe bound |
| `nvidia_minimax-m3`                 | `minimaxai/minimax-m3`              | Tool-loop supported; not approved after browser timeout     |
| `nvidia_laguna-xs-2.1`              | `poolside/laguna-xs-2.1`            | Temporarily unavailable: sanitized HTTP 503                 |

The credential was recognized without being printed. The bounded live probe completed basic chat, a forced function call with parsed arguments, the tool-result turn, and a final answer for Nemotron (31,794 ms) and MiniMax (33,536 ms); both responses included provider usage metadata. Nemotron is the sole locally approved NVIDIA model. Its hosted tool-calling template requires `enable_thinking: false`, which the adapter supplies only for that model family.

## Compatibility and runtime verification

```bash
pnpm provider:test:nvidia -- --model=glm-5.2
pnpm provider:probe:nvidia
```

The bounded probe checks basic chat, a forced function call with parsed arguments, a subsequent tool-result turn, and usage presence. It emits only provider, candidate alias, status, latency, and a usage-present boolean. It never prints response content or credentials.

After a candidate passes, add its dashboard ID to `NVIDIA_NIM_ALLOWED_MODELS`, restart the dashboard and workers, then run these mandatory cases before treating it as supported:

1. Direct extraction on the Artificial intelligence Wikipedia article.
2. Search from Wikipedia to the exact `/wiki/Artificial_intelligence` article.
3. A structured-result case that reaches `VALID`.

## Execution, errors, and usage

Run snapshots contain the dashboard model ID, provider (`groq` or `nvidia`), and exact provider model string. Later Agent edits do not alter admitted Runs. Removing a key blocks new admission and makes queued work fail safely; it never changes providers. Scheduled Runs follow the same rule.

Bounded failures are `PROVIDER_RATE_LIMITED`, `PROVIDER_AUTH_FAILED`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_BAD_RESPONSE`, and `PROVIDER_MODEL_UNAVAILABLE`. Timeout and transient unavailability use existing bounded worker retries. Rate limits fail fast. Public messages are generic; sanitized logs and `provider_run_outcomes_total` use only bounded provider/outcome labels.

NVIDIA `prompt_tokens`, `completion_tokens`, and `total_tokens` use the existing normalized usage path when present. Missing usage is not fabricated and monetary cost is not estimated. Phase 21 resource controls remain unchanged.

## Benchmark and limitations

```bash
AGENT_BENCHMARK_EXTERNAL=true pnpm beta:reliability -- --provider=nvidia --model=nvidia_glm-5.2
```

Reports record provider and model while retaining provider-independent cases and grading. Provider fallback, customer-managed keys, arbitrary compatible endpoints, cost routing, and automatic candidate approval are out of scope.

On 2026-08-11, Nemotron completed real queued browser Runs through the dashboard, BullMQ worker, safety layer, and root Agent. Smoke coverage passed direct extraction, exact search/navigation, structured extraction (`VALID`), and multi-page research (4/4), with 2/2 private-network negatives blocked. The repeated 24-Run catalogue passed 23/24 (95.8%); all 6 structured Runs were `VALID`/`PARTIAL`, and the sole failure was a bounded step-limit whose repeat passed. Compatibility-probe usage was provider-reported and the normalization boundary is test-covered; benchmark result payloads intentionally do not expose token accounting, so no token or monetary estimate was added.
