# Task 3 recovery report

Task 3 was committed before this execution ledger was introduced. The original implementer report and TDD evidence are unavailable.

Controller verification after resuming:

- `npm test -- app/lib/artifacts/__tests__/validation.test.ts app/lib/artifacts/__tests__/manifest.test.ts`: 2 files, 50 tests passed.
- `npm run typecheck`: passed.

Commit under review: `910e7dd feat: validate artifact packages`.

## Task review findings

The task reviewer found three Important issues that require a fix and re-review:

1. `ArtifactError.toPublic()` exposes `code`, although the public projection is limited to safe message, status, and retryability.
2. Path validation accepts Windows drive-qualified paths and unpaired UTF-16 surrogate code units.
3. Mutation fingerprinting uses a narrow content-field denylist and may hash raw content under other keys.

## Task 3 review fixes — 2026-07-19

### Scope

Resolved all three Important review findings:

1. `ArtifactError.toPublic()` now returns only `message`, `status`, and `retryable`.
2. `normalizeArtifactPath()` rejects drive-qualified Windows paths and unpaired UTF-16 high or low surrogates before NFC normalization or UTF-8 byte-length checks.
3. Mutation fingerprints now canonicalize an explicit metadata-only schema. Unknown root fields and unknown file fields are rejected, so raw content cannot be introduced through arbitrary keys.

### TDD evidence

RED (before implementation):

```text
npm test -- app/lib/artifacts/__tests__/validation.test.ts app/lib/artifacts/__tests__/manifest.test.ts
exit 1
2 test files failed; 9 tests failed and 49 passed.
```

The expected failures showed that public errors still included `code`, drive-qualified and unpaired-surrogate paths were accepted, and fingerprints resolved for `htmlContent`, `sourceBody`, `payload`, and nested file `payload` fields.

GREEN (after implementation):

```text
npm test -- app/lib/artifacts/__tests__/validation.test.ts app/lib/artifacts/__tests__/manifest.test.ts
2 test files passed; 58 tests passed.

npm run typecheck
react-router typegen && tsc
exit 0
```

`git diff --check` also completed with exit 0.

### Files changed

- `app/lib/artifacts/contracts.ts`
- `app/lib/artifacts/validation.ts`
- `app/lib/artifacts/__tests__/validation.test.ts`
- `app/lib/artifacts/__tests__/manifest.test.ts`

### Commit

`2116db3 fix: harden artifact validation`

### Self-review

- The public projection omits the stable internal error code while retaining the required safe response fields.
- Path rejection runs before normalization and all path byte/segment identity work; valid surrogate pairs remain unaffected.
- The fingerprint path permits only `title`, `description`, `allowedDataOrigins`, and metadata-only file fields (`path`, `mimeType`, `byteSize`, `sha256`). It rejects unrecognized root and nested file keys before canonical JSON is hashed.
- No unrelated production behavior or the pre-existing untracked documentation plan was changed.

## Re-review findings

The re-review found two further issues that require a fix and another review:

1. `mutationFingerprint()` may hash raw content placed in otherwise permitted metadata fields because it does not semantically validate and normalize path, MIME type, checksum, or title and description limits before hashing.
2. `canonicalManifest()` sorts with default-locale `localeCompare`, which is not deterministic across runtimes.

## Re-review fixes — 2026-07-19

### Scope

Resolved both re-review findings:

1. Mutation fingerprint file entries now require all metadata fields (`path`, `mimeType`, `byteSize`, and `sha256`). Paths are NFC-normalized through `normalizeArtifactPath()`, MIME types must be known and match their path extension, checksums must be SHA-256 values and are lowercased, and byte sizes remain non-negative safe integers. Titles and descriptions now reject values over their configured character limits before hashing.
2. Canonical manifest path sorting now uses an explicit code-unit comparator (`<` / `>`) instead of locale-dependent `localeCompare`.

### TDD evidence

RED (tests added before production changes):

```text
npm test -- app/lib/artifacts/__tests__/validation.test.ts app/lib/artifacts/__tests__/manifest.test.ts
exit 1
2 test files run; 1 passed and 1 failed.
64 tests run; 58 passed and 6 failed.

Expected failures:
- manifest ordering began with `ä.txt` rather than `Z.txt`, demonstrating default-locale ordering;
- fingerprints resolved instead of rejecting raw HTML in file `path`, `mimeType`, and `sha256`;
- fingerprints resolved instead of rejecting title and description values over their limits.
```

GREEN (after the smallest validation and comparator changes):

```text
npm test -- app/lib/artifacts/__tests__/validation.test.ts app/lib/artifacts/__tests__/manifest.test.ts
exit 0
2 test files passed; 64 tests passed.

npm run typecheck
react-router typegen && tsc
exit 0

git diff --check
exit 0
```

### Files changed

- `app/lib/artifacts/validation.ts`
- `app/lib/artifacts/__tests__/manifest.test.ts`

### Commit

`31d936f fix: harden artifact manifest fingerprints`

### Self-review

- Raw HTML cannot become part of a fingerprint through path, MIME type, or checksum metadata: all three are semantically constrained before canonical JSON is created.
- File metadata is complete rather than partially optional, preventing a raw value from being placed in an omitted or weakly validated field.
- Checksum case and path normalization are canonicalized before hashing, while MIME is constrained to the explicit extension/MIME allowlists.
- The code-unit comparator is independent of the host locale; the regression test exercises a path pair ordered differently by the prior default-locale comparator.
- Focused artifact tests, typechecking, and whitespace validation were run after the final implementation. The pre-existing untracked `docs/plans/2026-07-18-artifact-upload-and-rendering.md` was not changed or committed.

## Final review finding

The final reviewer found one Important malformed-input gap: `validateArtifactPackage()` and `canonicalManifest()` dereference an array entry before proving it is an object, so `null` entries can throw a native `TypeError` instead of a stable `ArtifactError`.

## Final review fix — 2026-07-19

### Scope

Added runtime record guards before either public boundary dereferences an array entry. `validateArtifactPackage()` and `canonicalManifest()` now reject `null`, primitives, and array entries as stable `invalid_manifest` `ArtifactError`s.

### TDD evidence

RED (tests added before production changes):

```text
npm test -- app/lib/artifacts/__tests__/validation.test.ts app/lib/artifacts/__tests__/manifest.test.ts
exit 1
2 test files failed; 3 tests failed and 65 passed.

Expected failures:
- `validateArtifactPackage()` and `canonicalManifest()` threw native TypeErrors for `null` entries;
- `canonicalManifest()` reported a primitive entry as `invalid_path` instead of the stable `invalid_manifest` error.
```

GREEN (after the minimal record guards):

```text
npm test -- app/lib/artifacts/__tests__/validation.test.ts app/lib/artifacts/__tests__/manifest.test.ts
exit 0
2 test files passed; 68 tests passed.

npm run typecheck
react-router typegen && tsc
exit 0

git diff --check
exit 0
```

### Files changed

- `app/lib/artifacts/validation.ts`
- `app/lib/artifacts/__tests__/validation.test.ts`
- `app/lib/artifacts/__tests__/manifest.test.ts`

### Commit

`1f06e6a fix: reject malformed artifact entries`

### Self-review

- Both public array-processing boundaries perform the safe-record check before field access, preventing native TypeErrors for malformed entries.
- Focused regression coverage exercises `null` and a primitive at each boundary and asserts the stable `invalid_manifest` code.
- No unrelated tracked files were changed. The pre-existing untracked `docs/plans/2026-07-18-artifact-upload-and-rendering.md` remains uncommitted.

## Approval review findings

The approval review found two Important malformed-input consistency gaps:

1. `canonicalManifest()` permits non-string MIME or checksum fields to reach native coercion or regex operations rather than returning a stable `ArtifactError`.
2. `mutationFingerprint()` accepts file paths that collide after NFC normalization.

## Approval review fixes — 2026-07-19

### Scope

Resolved both remaining approval findings:

1. `canonicalManifest()` now checks that MIME and checksum fields are strings before map/regex/string operations. MIME is constrained by the explicit merged extension maps and must match the normalized file path before canonical serialization. Non-string MIME rejects as `invalid_manifest`; non-string checksums reject as `invalid_checksum`.
2. `mutationFingerprint()` now rejects duplicate normalized file paths as `invalid_input` before canonical JSON is hashed.

### TDD evidence

RED (tests added before production changes):

```text
npm test -- app/lib/artifacts/__tests__/validation.test.ts app/lib/artifacts/__tests__/manifest.test.ts
exit 1
2 test files run; 1 passed and 1 failed.
71 tests run; 68 passed and 3 failed.

Expected failures:
- Symbol-valued `mimeType` and `sha256` produced native "Cannot convert a Symbol value to a string" TypeErrors instead of ArtifactErrors;
- mutation fingerprinting resolved when two file paths collided after NFC normalization.
```

GREEN:

```text
npm test -- app/lib/artifacts/__tests__/validation.test.ts app/lib/artifacts/__tests__/manifest.test.ts
exit 0
2 test files passed; 72 tests passed.

npm run typecheck
react-router typegen && tsc
exit 0

git diff --check
exit 0
```

### Files changed

- `app/lib/artifacts/validation.ts`
- `app/lib/artifacts/__tests__/manifest.test.ts`
- `.superpowers/sdd/task-3-report.md`

### Commit

`HEAD` — `fix: harden artifact manifest validation`

### Self-review

- MIME is type-checked and checked against the explicit extension/MIME allowlists before canonical manifest lines are interpolated.
- Checksums are type-checked before their SHA-256 regular expression is evaluated, preventing Symbol coercion failures.
- Fingerprint paths are normalized by the existing canonical file helper, then checked as a set before hashing, so canonically equivalent paths cannot produce a misleading fingerprint.
- The direct manifest regression also asserts MIME/path mismatch rejection. The unrelated untracked documentation plan remains excluded.
