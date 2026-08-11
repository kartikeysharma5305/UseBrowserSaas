# Structured results

Phase 12 extends the ordinary Agent → Run admission → BullMQ worker path. It does not introduce another execution pipeline or make browser execution success depend on output validation.

## Data model and lifecycle

`Agent.outputSchema` stores a server-validated constrained schema. Admission validates it again and copies it to immutable `Run.outputSchemaSnapshot` plus `outputSchemaVersion`. Manual and scheduled admission share the same transaction, so edits affect future Runs only and retries retain the queued snapshot.

The worker preserves the normal Run summary and visited URLs, then the existing terminal persistence transaction stores a bounded raw result, parsed candidate, validated/partial result, structured errors, status and validation timestamp. Raw and candidate values are deliberately omitted from normal Run APIs and downloads because unvalidated text can repeat sensitive task input.

Statuses are `NOT_REQUESTED`, `PENDING`, `VALID`, `PARTIAL`, `INVALID`, `PARSE_FAILED`, and `TOO_LARGE`. A successful browser Run remains `SUCCESS` when structured validation fails; the independent structured status is displayed to the user.

## Schema contract

The internal version-1 format supports string, number, integer, boolean, HTTP(S) URL, `YYYY-MM-DD` date, enum, bounded array, and nested object fields. Fields may be required or optional. Numeric/string bounds, enum values, array item definitions, URL protocols, labels and descriptions are data rather than prompt instructions.

Central bounds are 50 total fields, depth 3, 20 enum values, 100 array items, 10,000 characters per string, 32 KB schema JSON and 128 KB raw output. Keys must begin with a letter and contain only letters, digits or underscores. Prototype keys, external references, regex, recursive definitions, executable expressions and unknown options are rejected. No coercion occurs.

`STRICT` makes any error invalid. `PARTIAL` retains only fields that independently validate and reports every rejected/missing field; it never retains an invalid value.

## Parsing policy

The deterministic parser accepts one direct JSON object, one fenced JSON block, or one balanced object embedded in surrounding prose. Zero or multiple candidates fail. Duplicate keys and prototype-pollution keys fail. Malformed JSON, non-finite numbers and oversized output never reach validation. Host timezone and provider-specific structured-output modes are irrelevant.

The server appends a bounded, generated JSON contract to the resolved execution task. Variables are resolved only in the task/target fields and never inside the schema. Prompting improves compliance but is not trusted; validation against the snapshot remains authoritative.

## API, UI, and downloads

Agent create/edit APIs accept `outputSchema` through Zod and the centralized compiler. The Agent UI supports enabling, strict/partial mode, adding, removing and reordering common fields, enum values, and a JSON preview. The API/compiler also supports bounded nested object/array definitions for future richer UI work.

Run detail shows the schema version, status, validated fields, partial warning and field errors. Raw-result handling is explained but raw text is not exposed. Owner-scoped `GET /api/runs/[id]/result.json` and `GET /api/runs/[id]/result.csv` use private, no-store attachment responses. CSV is available only for deterministic object/array-of-object results; it applies RFC-style quoting and prefixes cells beginning with `=`, `+`, `-`, `@`, tab or carriage return to prevent spreadsheet formula injection.

Three source-controlled templates provide simple schemas. Template-created Agents remain ordinary editable Agents.

## Deletion and security

Agent and account deletion already cascade to Runs, including all structured columns. Download routes and their service query both scope through `Agent.userId`, returning the same safe not-found behavior across owners. Provider payloads, stack traces, execution tasks, raw output and parsed candidates are excluded from public result records.

## Operations and verification

Commands:

```bash
pnpm test:structured-results
pnpm --dir dashboard exec prisma validate
pnpm --dir dashboard exec prisma generate
pnpm --dir dashboard exec tsc --noEmit
```

The Phase 12 migration is additive. Deploy it before starting workers built with the new client. The sanitized disposable runtime drill verified manual and scheduled admission snapshots, queued-schema immutability after an Agent edit, valid, malformed and partial persistence, JSON download generation, CSV formula protection, cross-user denial, account-deletion admission blocking and complete cleanup. This was deterministic fixture verification through the real producer and worker terminal-persistence boundary; no external model response was required.

## Limitations and future versions

The UI offers common fields directly and a server-validated JSON editor for nested object/array fields; a fully visual recursive builder remains future polish. Raw diagnostic access, schema migration tooling, provider-native response formats, arbitrary top-level arrays and public/data-destination exports are out of scope. Any future schema semantics require a new schema version; historical snapshots must never be rewritten.
