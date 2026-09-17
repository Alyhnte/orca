# Crashpad file-read limit

The local crash-report reader checked a dump's directory-stat size against its existing
64 MiB limit, then later read the path without a limit. A file that grew or was replaced
between those operations could allocate more than 64 MiB in the main process. The same
stat/filter/read sequence exists in `v1.4.198`.

This patch reuses `readNodeFileWithinLimit` at the read itself. An oversized read skips only
that candidate, releases its reservation, and allows selection of the next valid dump. A
successful result reports the byte count actually parsed. The quota, claim policy, other
I/O error handling and partial-header retry policy remain unchanged.

## Reproduction

```sh
ORCA_BACKGROUND_LAUNCH=1 node docs/audits/crashpad-read-limit/reproduce.mjs
```

The runner reverses only `fix.patch` in memory through a temporary Vite configuration; it
never edits production source. Both source versions must match the expected SHA-256 hashes.
It runs the actual capture function, parser and filesystem against synthetic temporary files
using the committed `crashpad-capture-read-limit.test.ts`. No ignored notes, native crash,
real crash dump, app window, network request or external host is needed. Largest file: **65 MiB**.

| Phase    | Pass | Fail | Skip | Exit |
| -------- | ---: | ---: | ---: | ---: |
| Baseline |    4 |    3 |    1 |    1 |
| Fixed    |    8 |    0 |    0 |    0 |

Seven cases run against both versions. Baseline failures are growth/replacement beyond the
limit and stale size metadata after allowed growth. The two oversized reads delivered
68,157,440-byte buffers to the real parser despite the 67,108,864-byte limit. The fixed version
skips them and selects the next 131-byte renderer dump.

The eighth case exercises **growth after the same open descriptor's stat**. It is fixed-only:
the old `readFile` call does not expose that descriptor-stat boundary, so the baseline skips
it rather than manufacturing a failure. This case grows a real file to 65 MiB, verifies no
oversized buffer reaches the parser, checks both descriptors close, and confirms that a later
valid same-path file remains available after the failed read releases its reservation.

Other controls accept exactly 64 MiB, skip an already oversized file, and preserve existing
partial-header behavior. A short invalid header is rejected only for the current capture
window; a fresh capture can retry it. Promotion to a different completed path can recover
within the original polling window. The proof does not add a file-completion policy.

`results.json` records source hashes, exact counts, failed case names, process exit codes and
non-timeout status. The runner refuses changed source hashes or unexpected results.

## Reachability and memory scope

Crashpad's macOS database prepares a `.dmp` in its `new` directory while writing, then renames
it after completion. Orca recursively scans these directories. Crashpad's seekable writer
keeps the signature invalid until the body is complete, then rewrites the header. The growth
fixture follows that ordering: a small invalid-header file is statted, grows, then receives
its completed header before capture reads it. These are upstream implementation facts, not an
exact vendored-build or field-incident reproduction. See the primary
[database implementation](https://chromium.googlesource.com/crashpad/crashpad/+/refs/heads/main/client/crash_report_database_mac.mm)
and [minidump writer](https://chromium.googlesource.com/crashpad/crashpad/+/HEAD/minidump/minidump_file_writer.cc).
Same-path replacement is a separate admitted filesystem race; natural UUID reuse is not claimed.

This fixes a potentially large **transient allocation after a process crash**. The parser
returns a bounded text signature and does not retain the whole dump. The bounded reader limits
individual buffer capacity and returned content; old and expanded buffers may briefly coexist,
and independent crash captures can overlap. This is not a claim of a 64 MiB aggregate RSS cap,
a long-lived leak, or an explanation of #19831/#19768's reported memory growth.

## Validation and applicability

```sh
ORCA_BACKGROUND_LAUNCH=1 node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/crash-reporting/crashpad-capture-read-limit.test.ts src/main/crash-reporting/crashpad-capture.test.ts src/main/crash-reporting/minidump-crash-signature.test.ts src/shared/node-bounded-file-reader.test.ts
ORCA_BACKGROUND_LAUNCH=1 node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json
```

The focused suites pass **51 tests across four files**, including the existing bounded-reader
failure/descriptor-close controls. Node typecheck, focused lint and formatting pass.

The caller before this patch is byte-identical on main
`291b4ddd6f1c1af480169885e0fda7f9c78ff053`, and the reused bounded reader exists there. The exact
production patch passes an alternate-index apply check against that base; no earlier audit
fix is required.
