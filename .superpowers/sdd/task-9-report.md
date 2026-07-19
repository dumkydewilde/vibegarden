# Task 9 Report: Browser ZIP Preparation and Upload Orchestration

Status: complete.

Implemented browser-side package preparation in `package.client.ts`. ZIP central-directory entries are fully inspected before any body extraction: unsafe paths, NFC duplicates, encrypted entries, unsafe Unix/external modes (including platform metadata that omits `unixMode`), malformed directories, count limits, ordinary-file limits, and aggregate limits fail before `getData`. Accepted ZIP entries are then extracted sequentially with Zip.js `BlobWriter`, MIME/classified with the shared validation rules, content-inspected, and SHA-256 hashed with WebCrypto. Plain HTML is mapped to `index.html`; standalone safe files retain a sanitized basename. Literal HTTPS origins are returned only as advisory suggestions and never as an approval field.

Implemented resumable sequential upload orchestration in `upload.client.ts`. It creates an idempotent session, preserves server acknowledgements in the returned resume state, skips acknowledged files on resume, sends exactly the four required artifact headers on each file PUT, reports acknowledgement-based progress, finalizes only after acknowledged uploads, and sends best-effort server abort cleanup when an `AbortSignal` fires.

TDD evidence: the first targeted run was red because the two new client modules did not exist. A later added malformed-directory-metadata case was red until directory Unix mode validation was added.

Verification: `npm test -- app/lib/artifacts/__tests__/package-client.test.ts app/lib/artifacts/__tests__/upload-client.test.ts` (10 passed) and `npm run typecheck` passed.
