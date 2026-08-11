# Repository Cleanup Report

## 1. Objective

Audit the full Browser Automation SaaS repository and remove only files,
symbols, exports, configuration, and dependencies proven unused. Preserve the
root engine public API, dashboard behavior, Next.js routes, authentication,
Prisma schema, execution boundary, tests, generated output, and user artifacts.

Cleanup date: 2026-07-24.

## 2. Baseline State

The audit ran on branch `main` in the
`user-dashboard-saas-phase2-implementation` worktree.

The worktree was already dirty. It contained 42 tracked dashboard differences,
including prior authentication, execution, result-safety, and UI work; two old
dashboard files were already deleted; several new dashboard helpers, the
architecture document, and the result test were untracked. Those changes were
preserved and are not attributed to this cleanup.

Baseline checks:

| Check | Baseline |
| --- | --- |
| Root TypeScript | Passed |
| Dashboard no-emit TypeScript | Passed |
| Dashboard lint | Passed |
| Prisma validation | Passed |
| Run result tests | 14 passed |
| Root lint | Failed with 122,693 CRLF/Prettier errors |

## 3. Analysis Method

The audit combined:

- TypeScript AST import/export analysis for all dashboard TypeScript files.
- Strict `noUnusedLocals` and `noUnusedParameters` compilation.
- Static and type-only import, re-export, CSS, JSON, and package searches.
- Dynamic `import()`, `new Function`, `require()`, filesystem, and path-string
  searches.
- Next.js App Router convention inventory.
- Root package exports, binaries, scripts, build helpers, and provider registry
  review.
- Root and dashboard test reference review.
- `pnpm why`, direct dependency inventories, manifest/lockfile comparison, and
  frozen offline lockfile validation.
- Empty/generated/artifact directory classification.
- Explicit route, execution-chain, and compiled-module existence checks.

## 4. Files Removed

| Path | Reason | Evidence | Risk |
| --- | --- | --- | --- |
| `dashboard/src/lib/execution/index.ts` | Unused execution re-export barrel | Zero inbound static/dynamic references; no framework, package, test, script, or runtime discovery role | Low; active imports already use concrete files |

Two files already deleted in the baseline, `agent-card.tsx` and the old
browser-use execution adapter, are not cleanup removals.

## 5. Directories Removed

None. No empty non-generated source directory remained. Generated directories,
compiled `dist`, and artifact directories were retained.

## 6. Symbols and Exports Removed

| Area | Removed | Evidence |
| --- | --- | --- |
| UI | Six unused import bindings | Strict compiler diagnostics and no render use |
| Browser integration | Two unused local values | Strict compiler diagnostics |
| Route helpers | Four ownership wrapper/alias exports | No imports, calls, tests, dynamic references, or package API |
| Auth helpers | `verifyUserAccess` | No consumer; active auth helpers remain |
| Engine loader | Unused base-module cache, loader, and return property | `BaseChatModel` result had no consumer |
| Run persistence | No-op `appendFinalEvent`; unused completion parameter | No caller/read; terminal events already written elsewhere |
| Execution types | `AgentExecutionService` | No consumer or implementation annotation |
| Shared types | Unused agent record/configuration/status declarations | No imports or active references |
| Internal exports | Seven unnecessary export surfaces | Symbols remain private where internally used |
| Barrel | Two wildcard re-exports | Entire barrel had no consumer |

In total, 23 named symbols/exports and eight unused import/local bindings were
removed or made private.

## 7. Dependencies Removed

| Package | Scope | Evidence |
| --- | --- | --- |
| `@auth/prisma-adapter` | Dashboard | Better Auth adapter is active; no reference |
| `next-auth` | Dashboard | Better Auth replaced it; no reference |
| `react-hook-form` | Dashboard | Forms use React state; no reference |
| `class-variance-authority` | Dashboard | No component/configuration import |
| `date-fns` | Dashboard | Native date helper is active; no reference |
| `eventemitter3` | Root | No source/test/script/config/export/dynamic reference |
| `eslint-plugin-jsx-a11y` | Root development | Not loaded by ESLint configuration |

Pnpm also removed a stale dashboard lockfile-only `browser-use: file:..`
importer that was absent from `dashboard/package.json`. The dashboard continues
to load root compiled modules through `EngineLoader`.

Phase 5 later added `ioredis` as an intentional direct dashboard dependency.
BullMQ already depended on it transitively, but the application now imports it
directly for bounded Redis Pub/Sub invalidation and worker cancellation
notification connections; it is therefore active and must not be pruned.

## 8. Scripts and Configuration Removed

No scripts were removed.

Five unused root-source aliases were removed from `dashboard/tsconfig.json`:
`browser-use`, `browser-use/agent`, `browser-use/browser`,
`browser-use/llm/models`, and `browser-use/llm/base`. The active `@/*` alias
remains.

## 9. Candidates Retained

| Candidate | Classification | Reason retained |
| --- | --- | --- |
| Root provider adapters | RETAINED — ARCHITECTURALLY SIGNIFICANT | Public exports, optional providers, registries, and tests |
| Root CLI/skill CLI | RETAINED — ARCHITECTURALLY SIGNIFICANT | Package binaries, exports, scripts, and tests |
| Root `llm/base` | RETAINED — ACTIVE PUBLIC API | Root agent/tests and package export use it |
| Root test suite | RETAINED — ACTIVE TESTS | Protects supported engine behavior |
| Vite/coverage/ambient type packages | RETAINED — TOOLCHAIN USE | Peer, CLI, coverage, or ambient TypeScript behavior |
| Next.js route/layout/page files | RETAINED — FRAMEWORK CONVENTION | App Router discovers them without imports |
| Run-detail route | RETAINED — ACTIVE BUT WEAKLY LINKED | Direct route and API are valid |
| Generated output and caches | GENERATED — DO NOT DELETE | Regenerable, ignored, and not source cleanup |
| Root/dashboard artifact directories | RETAINED — POSSIBLY USER DATA | No evidence screenshots are disposable |
| Root scripts | RETAINED — DEVELOPER API | Standalone commands need not be called by another script |

## 10. Verification Results

| Verification | Result |
| --- | --- |
| Root TypeScript | Passed |
| Dashboard strict no-unused TypeScript | Passed |
| Dashboard lint | Passed |
| Safe targeted tests | 52 passed, 2 skipped |
| Prisma validation | Passed |
| Frozen dashboard lockfile | Passed offline |
| Root lint | Pre-existing CRLF failure unchanged |
| Production build | Blocked by process lock on `.next/trace` |
| Route files | 16 of 16 present |
| Execution files | 7 of 7 present |
| Dynamic compiled modules | 3 of 3 present |
| Migrations, browser automation, Groq calls | None |

## 11. Architecture Documentation Updates

`COMPLETE_PROJECT_ARCHITECTURE.md` was updated in:

- Module and Dependency Map.
- Complete File Connection Map.
- Evidence and Verification Notes.
- The new permanent `Repository Cleanup and Removal Log`.

References to deleted aliases, helpers, barrel exports, dependencies, inactive
imports, and the dashboard base-model load were removed or corrected.

## 12. Remaining Cleanup Opportunities

These require future confirmation and were not removed:

- Root dependencies without ordinary imports but with ambient, peer, CLI,
  coverage, or package-tooling roles.
- Generated `.next` and incremental output once no development process is using
  them.
- Periodic invocation of the Phase 3B artifact-retention command; the ownership,
  path validation, age policy, active-run exclusion, and dry-run/apply behavior
  are now implemented.
- Weakly discoverable run details and inert navigation controls; these are
  product wiring concerns, not dead-code proof.

## 13. Risks and Rollback Notes

The earlier production-build verification gap is resolved. The Next.js process
from this dashboard worktree was identified on port 3001 and stopped, after
which `pnpm build` completed successfully without deleting `.next`.

Rollback is localized:

- Restore `dashboard/src/lib/execution/index.ts` only if a future external
  consumer deliberately adopts the barrel.
- Re-add a removed package with pnpm only when a concrete import or tool
  configuration is introduced.
- Restore a removed helper from Git history only if a real caller is added.
- Root engine source, public exports, routes, Prisma, auth, environment, and
  artifacts require no rollback because they were not removed.
