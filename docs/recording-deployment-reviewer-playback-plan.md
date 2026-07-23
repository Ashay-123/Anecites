# Recording Deployment and Reviewer Playback Plan

**Status:** implementation design gate  
**Scope:** LiveKit candidate-track egress, private S3-compatible storage, reviewer playback, and recording completeness verification.  
**Out of scope:** retention/deletion, diarization, gaze, prohibited-app rules, risk scoring, and changes to `RiskTimelineEntry` or existing evidence-reference shapes.

## 1. Current Repository State Relevant to Egress and Storage

### What exists

- `apps/server/src/livekit.ts` already creates LiveKit egress requests using `S3Upload`. It supports both room-composite and participant-track egress.
- The active lifecycle in `apps/server/src/recording-lifecycle.ts` deliberately uses `startLiveKitCandidateRecording`, which starts **participant-track egress** for the one consented candidate. It writes a generated MP4 key under `LIVEKIT_RECORDING_KEY_PREFIX/<sessionId>/<timestamp>.mp4` and creates an `EvidenceObject` plus `SessionRecording` record.
- Recording start is already gated by active interviewer access and the existing media-consent requirements in `apps/server/src/sessions.ts` and `apps/server/src/media-consent.ts`. Automatic recording is guarded by `LIVEKIT_RECORDING_AUTO_LIFECYCLE_ENABLED`.
- `apps/server/src/livekit-webhooks.ts` verifies signed LiveKit webhook bodies and marks `SessionRecording` as `COMPLETED` after an `egress_ended` event with the complete status.
- `EvidenceObject` already stores the correct provider-neutral object identity: `storageBucket`, `storageKey`, `contentType`, optional `byteSize`, optional `durationMs`, and metadata. `SessionRecording` links exactly one recording evidence object to an egress attempt.
- `apps/media-inference` already uses a generic Boto3 S3 client, downloads an object privately, and uses `ffprobe` to determine real media duration. It does not currently expose duration verification as a job result.
- `apps/collab/src/replay-evidence.ts` has a narrow S3-compatible `putObject` abstraction for editor replay only. It cannot issue a signed GET URL, inspect objects, or serve recording evidence.
- The reviewer UI currently lists risk summaries in `apps/desktop/src/ReviewQueuePanel.tsx`; it does not yet request video evidence, render a video player, or seek to an evidence range.

### What is missing

- No server-owned generic S3 read/signing service for evidence playback.
- No `GET /sessions/:sessionId/evidence/:clipId` route.
- No recording reviewability/completeness state. `COMPLETED` currently means Egress ended, not that the object was verified complete.
- No queue/job that probes a finished recording, compares actual duration with expected duration, and refuses playback for incomplete media.
- No dashboard player or jump-to-evidence action.
- No end-to-end self-hosted deployment test proving that Egress can upload to the private bucket and that a reviewer can play it.

## 2. Storage Abstraction Design

### Interface

Add a server-owned `EvidenceStorage` interface, for example:

```ts
interface EvidenceStorage {
  createRecordingKey(sessionId: string, recordingId: string): string;
  headObject(ref: EvidenceObjectRef): Promise<StoredObjectMetadata>;
  createPresignedReadUrl(ref: EvidenceObjectRef, expiresInSeconds: number): Promise<string>;
  close(): void;
}

interface EvidenceObjectRef {
  bucket: string;
  key: string;
  contentType: string;
}
```

Only this service may build recording keys or construct S3 commands. Business code passes persisted `EvidenceObject.storageBucket` and `EvidenceObject.storageKey`; it must never construct `recordings/${sessionId}/...` itself.

### Implementation

- Implement `S3EvidenceStorage` with AWS SDK v3 `S3Client`, `HeadObjectCommand`, `GetObjectCommand`, and the AWS SDK presigner.
- Add the SDK packages to **`apps/server`**, not to desktop code. Storage credentials must remain in server/worker environments.
- Do not use MinIO SDK APIs, MinIO console APIs, bucket-public policies, or provider-specific object URLs.
- Preserve `EvidenceObject` as the database source of truth for the bucket/key. A signed URL is transient response data and is never persisted.
- Use server-generated opaque recording IDs in object keys, not a fixed `interview.mp4`. The documented convention will be:

```text
<RECORDING_STORAGE_KEY_PREFIX>/<sessionId>/<recordingId>.mp4
```

This is keyed by session, avoids retry collisions, and permits future multiple clips without a schema redesign. `clipId` in the API is the existing `EvidenceObject.id`, not a new model.

### Environment configuration

Use one provider-neutral credential and bucket configuration:

```env
OBJECT_STORAGE_ENDPOINT=http://minio:9000
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_BUCKET=anecites-dev
OBJECT_STORAGE_ACCESS_KEY_ID=...
OBJECT_STORAGE_SECRET_ACCESS_KEY=...
OBJECT_STORAGE_FORCE_PATH_STYLE=true
RECORDING_STORAGE_KEY_PREFIX=recordings
EVIDENCE_SIGNED_URL_TTL_SECONDS=900
```

`us-east-1` is the normal placeholder for MinIO because AWS request signing requires a region even though MinIO does not enforce AWS regions.

The Egress process cannot use the TypeScript client, so it must receive the same provider-neutral bucket/credentials as an `S3Upload` configuration. In an all-Docker deployment, it can use the same `OBJECT_STORAGE_ENDPOINT`. For the current mixed topology (host-run API plus Docker Egress), a separately configured `LIVEKIT_EGRESS_S3_ENDPOINT` may be necessary solely because `localhost` resolves differently inside Docker. It is a network-routing override, not a second storage provider or a MinIO-specific branch. The bucket, region, credentials, and key convention remain identical.

For AWS S3, R2, B2, or LiveKit Cloud, operators change endpoint, region, credentials, force-path style, and the Egress-reachable endpoint values. No application or dashboard code changes.

## 3. Egress Configuration Plan

### Recording choice

Keep **candidate participant-track egress** as the default. It is the correct continuation of the current consent and media-analysis model: the existing lifecycle requires one candidate and records only that candidate's track.

Do not switch the default to room-composite merely for playback. Room composite would include interviewer media and requires broader consent language, different privacy review, and changes to the existing candidate-specific media-analysis assumptions. That is outside this task.

### Trigger and lifecycle

1. Existing consent verification succeeds.
2. The existing interviewer-controlled start or the already gated automatic lifecycle invokes `startSessionRecording`.
3. `EvidenceStorage.createRecordingKey` produces one opaque session-scoped key before Egress starts.
4. `startLiveKitCandidateRecording` sends that key and one provider-neutral S3 output configuration to LiveKit Egress.
5. The database persists the exact returned Egress ID and storage object reference in the existing `EvidenceObject` and `SessionRecording` transaction.
6. The signed `egress_ended` webhook marks successful Egress completion as awaiting verification, then publishes a verification job. A failed Egress becomes failed/incomplete and is never reviewable.

The recording must not start before consent. No part of this task creates a bypass around `requireActiveRecordingConsents` or `requireActiveInterviewerRecordingAccess`.

### Self-hosted deployment

- Keep `livekit`, `livekit-egress`, `livekit-redis`, and MinIO behind the existing Docker profiles.
- Make `livekit-egress` reach the bucket through its configured endpoint on an internal Docker network.
- Keep MinIO API and console bound to loopback during development. Do not grant anonymous read access and do not publish the bucket.
- Configure the LiveKit webhook URL to a backend-reachable HTTPS API URL in any non-local deployment; LiveKit Cloud cannot call a private `localhost` webhook or a private MinIO endpoint.

### Failure handling

- Egress start failure creates no evidence record, as current tests already require.
- Persistence failure attempts Egress cleanup, as the existing lifecycle does.
- Egress failed/cancelled, missing object, invalid MP4, zero-byte object, probe timeout, or duration mismatch transitions the recording to an explicit non-reviewable state and records a bounded failure code. No signed URL is issued.
- Webhook processing and verification publishing must be idempotent by Egress ID/recording ID.

## 4. Evidence API Endpoint Design

### Endpoint

```text
GET /sessions/:sessionId/evidence/:clipId
```

`clipId` is the existing `EvidenceObject.id`. This intentionally permits future segmented or multi-track recordings without redefining the API. Today, only a session-recording evidence object is accepted.

### Authorization

1. Existing bearer-token middleware authenticates the request.
2. Reuse `requireReviewerAccess` semantics: only privileged reviewer roles are allowed.
3. Explicitly reject a candidate JWT with `403 FORBIDDEN`, even if the candidate belongs to the session.
4. Verify the requested evidence object belongs to `:sessionId`, is `SESSION_RECORDING`, and has a related `SessionRecording` marked reviewable.
5. Return `404` for a missing/mismatched clip after authorization. Never reveal object keys, bucket names, or storage credentials to the client.

The current privileged helper includes interviewer, reviewer, and admin. Product owners must decide before implementation whether interviewers are permitted playback after a session. The conservative default for this task is to use the existing privileged reviewer policy consistently; it does not grant candidates access.

### Response

```json
{
  "url": "https://object-store.example/...signed-query...",
  "expiresIn": 900,
  "startTime": 324.2,
  "endTime": 346.7
}
```

- `url` is a signed GET URL produced by `S3EvidenceStorage` and expires after `EVIDENCE_SIGNED_URL_TTL_SECONDS`, default 900 seconds and bounded in config.
- `startTime` and `endTime` are seconds. They are derived by the reviewer client from the selected risk summary/event's existing recording-backed evidence and its temporal window; no `RiskTimelineEntry` or `evidenceRef` schema change is required.
- When no precise range exists, the endpoint returns `null` range values and the player starts at zero. The endpoint does not infer a risk range itself.
- A signed URL is a bearer capability. It must never be logged, cached in persistent browser storage, placed in a risk summary, or returned to candidates.

### Reviewer playback

- Add an evidence action to `ReviewQueuePanel` only for reviewer-capable sessions.
- The desktop client requests the endpoint with its backend JWT, creates a normal `<video controls>` element using the returned signed URL, and on `loadedmetadata` seeks to `startTime`.
- Display the selected range and let the reviewer replay it. It is a reviewer aid, not an automated verdict.
- The client handles a `403`, `404`, and `409 EVIDENCE_NOT_REVIEWABLE` without exposing storage details. If the signed URL expires during use, it makes a fresh authorized API request rather than retrying the stale URL.

## 5. Completeness-Check Job Design

### Persistence

Add a verification state to `SessionRecording`; do not overload `COMPLETED` to mean playable. Suggested values:

```text
PENDING | VERIFYING | REVIEWABLE | INCOMPLETE | FAILED
```

Persist:

- `verificationState`
- `verificationStartedAt`, `verificationCompletedAt`
- `expectedDurationMs`
- `recordedDurationMs`
- `verificationFailureCode`

`EvidenceObject.durationMs` is populated only from verified media metadata. Existing risk schema and evidence-reference structures remain untouched.

### Job trigger and execution

1. Signed `egress_ended` with complete status marks the recording Egress-complete and queues one idempotent `recording-verification:<evidenceObjectId>` job.
2. The job calculates expected duration from the persisted recording start/stop (or session end when that is the authoritative close time), reads the private object, probes MP4 duration with `ffprobe`, and obtains object size/checksum metadata when available.
3. Reuse the existing private media-inference download-and-`ffprobe` capability behind a small authenticated recording-verification RPC. This avoids placing S3 credentials in the desktop or duplicating object-download code. The job contract carries evidence ID/reference only, never credentials or a permanent URL.
4. On success, update metadata and mark `REVIEWABLE` only if the object is non-empty, has a valid duration, and satisfies both configured tolerance checks.
5. On timeout, probe failure, missing object, or a duration mismatch, mark `INCOMPLETE` or `FAILED`. The playback endpoint returns `409 EVIDENCE_NOT_REVIEWABLE`.

### Tolerance configuration

```env
RECORDING_COMPLETENESS_ABSOLUTE_TOLERANCE_MS=5000
RECORDING_COMPLETENESS_RELATIVE_TOLERANCE_PERCENT=2
RECORDING_VERIFICATION_TIMEOUT_MS=30000
```

Acceptance uses the more permissive configured threshold:

```text
abs(recordedDurationMs - expectedDurationMs)
  <= max(absoluteToleranceMs, expectedDurationMs * relativeTolerancePercent / 100)
```

The values are bounded and validated in server configuration. Operators can tune tolerance without a code release.

## 6. Files to Add or Modify

### Add

- `apps/server/src/evidence-storage.ts`: provider-neutral S3-compatible interface, S3 implementation, key builder, object metadata read, signed GET creation.
- `apps/server/src/evidence-playback.ts`: evidence lookup, reviewer authorization boundary, reviewability checks, range normalization, endpoint service.
- `apps/server/src/recording-verification.ts`: job contract, idempotent state transition, expected-duration calculation, and result persistence.
- `apps/server/src/recording-verification-publisher.ts`: RabbitMQ publisher for verification work, separate from media-analysis publishing.
- `apps/media-worker/src/recording-verification-consumer.ts` or a clearly named equivalent integrated into the existing worker: consumes verification jobs without changing risk scoring.
- `apps/desktop/src/evidence-playback.ts`: typed backend client for signed playback responses.
- `apps/desktop/src/ReviewerEvidencePlayer.tsx`: accessible reviewer-only player with seek and expiry recovery.
- Focused unit/integration test files next to the relevant server, desktop, worker, and media-inference modules.

### Modify

- `apps/server/package.json` and lockfile: add the AWS SDK S3 presigner dependency used only server-side.
- `apps/server/src/config.ts`: replace duplicated recording S3 fields with validated provider-neutral object-storage settings plus Egress endpoint override and verification tolerances. Preserve backward-compatible aliases only for a documented migration window, then remove them deliberately.
- `.env.example`: document private generic storage configuration, MinIO `us-east-1` convention, network-reachable Egress endpoint, and no public bucket policy.
- `apps/server/src/livekit.ts`: obtain recording paths and S3 Egress output from the storage configuration/service rather than constructing keys directly.
- `apps/server/src/recording-lifecycle.ts`: persist verification-pending state and preserve the generated key as evidence metadata.
- `apps/server/src/livekit-webhooks.ts`: enqueue verification on successful Egress completion; never declare evidence reviewable merely from Egress completion.
- `apps/server/src/app.ts` and `apps/server/src/sessions.ts`: register the authenticated evidence endpoint and inject storage/verification dependencies using existing app patterns.
- `packages/db/prisma/schema.prisma` plus a migration: add recording verification fields/state only.
- `apps/media-inference/src/anecites_media_inference/{app.py,analyzer.py,contract.py}`: expose an authenticated, bounded duration-probe operation reusing its current private S3 + `ffprobe` code.
- `apps/media-worker/src/{index.ts,inference-client.ts}` and its configuration/tests: consume the separate verification job and send only allowed evidence references to media inference.
- `apps/desktop/src/{review.ts,ReviewQueuePanel.tsx,App.tsx}` and CSS: request evidence on reviewer action, render the player, and jump to the selected evidence window.
- `docker/docker-compose.yml`, `docker/livekit-egress.yaml`, and `docker/livekit.yaml` only as needed to pass generic env values, connect Egress to the private object-store network, and run the verifier. No MinIO-only APIs or public ports are added.
- Existing server/desktop/webhook/config/media-worker/schema tests named above.

## 7. Test Plan

### Unit and integration

- A consented completed candidate-track recording creates one session-scoped object key and an `EvidenceObject`; no Egress starts without the existing consent gate.
- A successful Egress webhook queues exactly one idempotent verification job. Verification stores real duration and marks the recording `REVIEWABLE` only within configured tolerance.
- A completed session's recording can be requested by an authorized reviewer, the returned URL loads into the player, and the player seeks to the evidence start timestamp.
- An interrupted Egress, missing object, zero-byte object, invalid MP4, probe timeout, or duration mismatch is marked `INCOMPLETE`/`FAILED`; the endpoint responds with `409 EVIDENCE_NOT_REVIEWABLE` and never returns a URL.
- An unauthenticated request returns `401`.
- A reviewer from an unauthorized context is rejected according to the established reviewer permission model.
- **A candidate JWT attempting to access reviewer evidence returns `403 FORBIDDEN`, including when that candidate belongs to the recording session.**
- A signed URL expires. Fetching the old URL after expiry fails. Requesting the authorized evidence endpoint again returns a fresh URL, and the new URL works.
- The bucket/object is never made public. Tests inspect the SDK calls/configuration and do not use an anonymous object URL.
- Storage credentials, object keys, and presigned URLs are absent from API error payloads, logs, risk summaries, and desktop persistent storage.
- Run the same storage tests against MinIO and a mock S3-compatible endpoint by changing only environment values. No source change is permitted between the two runs.
- Webhook retries and verification-job retries are idempotent; they cannot create duplicate evidence records or transition an incomplete recording back to reviewable without a successful new verification.

### Self-hosted smoke test

1. Start the self-hosted `livekit` and `infra` profiles with a private MinIO bucket.
2. Host and join a consented interview with camera media.
3. Stop recording and wait for the signed Egress webhook plus verification job.
4. Use a reviewer JWT to request the evidence endpoint and verify the MP4 plays and seeks to a selected timestamp.
5. Terminate Egress mid-recording in a controlled test and verify that playback is denied as incomplete.

## 8. Risks and Limits

- A LiveKit Cloud Egress service cannot write to a developer's private Docker MinIO hostname. Cloud deployment requires a publicly reachable S3-compatible endpoint and a backend-reachable webhook URL. That is an infrastructure requirement, not something a code abstraction can bypass.
- A 15-minute signed URL can still be copied by a reviewer during its validity. Short expiry, reviewer-only API access, audit logging, and no persistent storage reduce but do not eliminate bearer-URL exposure.
- Candidate-track recording preserves the current consent scope but does not create a combined interviewer/candidate room recording. Any move to room composite requires a separate privacy and consent decision.
- `ffprobe` validates media duration, not interview integrity. It cannot prove that every moment contains useful video or that recording reflects every LiveKit participant.

## 9. Clear Next Action

Implement the server-owned `EvidenceStorage` configuration and `SessionRecording` verification-state migration first; they are the boundary that lets Egress, verification, and reviewer playback share one provider-neutral object reference safely.

## Final Review

**request changes** — first resolve the deployment topology by running the API/worker in the same private Docker network as self-hosted MinIO (or explicitly approve the documented Egress endpoint override); that decision is the highest-priority follow-up because a Cloud LiveKit Egress service cannot reach the current private `minio:9000` endpoint.
