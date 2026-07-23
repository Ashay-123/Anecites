# Implementation Plan - Anecites

This plan synthesizes the provided implementation plan, Phase 1 task list, and critical-problems review. It is the execution plan for building the repository step by step with test gates before each implementation stage.

## Confirmed Product Direction

| Area | Decision |
|---|---|
| Candidate and interviewer app | Tauri v2 + React + Vite + TypeScript desktop app |
| Native layer | Rust, user-mode only |
| First target OS | Windows 10/11, 64-bit |
| Reviewer/admin dashboard | Vite + React web app |
| Video/WebRTC | LiveKit Cloud for development, self-hosted LiveKit for production |
| Database | PostgreSQL with Prisma ORM and Prisma Migrate |
| Code execution | Self-hosted Piston for development; optional self-hosted Judge0 remains available for future Linux testing |
| Queues and streams | RabbitMQ for discrete jobs, Redis Streams for continuous telemetry |
| Object storage | S3-compatible storage, MinIO locally |
| Native fallback | None for v1; do not add Electron unless the Tauri path fails for a verified reason |

## Corrections From the Architecture Review

These corrections must be treated as requirements, not optional refinements.

1. Do not write raw per-keystroke rows to Postgres.
   - Buffer high-frequency events in memory or Redis.
   - Flush aggregated rolling features to Postgres every 1-2 seconds.
   - Store raw replay/evidence as append-only newline-delimited JSON in object storage.

2. Do not build two independent editor capture pipelines.
   - Use the Yjs update stream as the source of truth.
   - Derive document persistence, replay evidence, and behavioral telemetry from that stream.

3. Do not run core ML inference on the candidate machine.
   - The desktop app should run the interview UI, WebRTC, editor, and native helper only.
   - Face/gaze/audio inference should run server-side from LiveKit egress samples.
   - This avoids main-thread contention and reduces hardware-bias risk.

4. Do not publish raw high-frequency events as individual broker messages.
   - Use Redis Streams for continuous telemetry.
   - Use RabbitMQ for discrete jobs such as code execution requests, media-processing jobs, and risk-summary jobs.

5. Do not trust Docker configuration alone for code-execution isolation.
   - Piston or Judge0 must be reachable only from the backend and must not route to app Postgres, Redis, RabbitMQ, MinIO, or internal APIs.
   - Add gVisor, Firecracker, or an equivalent sandbox hardening layer before production candidate code runs.

6. Do not alert on a single raw signal.
   - Risk output must be composite, timestamped, explainable, and human-reviewed.
   - Calibration and shadow-mode evaluation are required before production enforcement.

## Target Architecture

```text
Tauri Desktop App
  React + Vite UI
  Monaco editor
  LiveKit client
  Rust user-mode native helper
    process scan
    window scan
    capture-affinity checks
    VM signals

Backend
  Express API server
  Yjs collaboration server
  Risk engine
  Media inference workers
  Code execution proxy

Data and infra
  Postgres: sessions, users, summaries, object references
  Redis: presence, short-lived buffers, Redis Streams telemetry
  RabbitMQ: discrete background jobs
  MinIO/S3: recordings, replay logs, evidence artifacts
  LiveKit: calls, screen share, egress samples
  Piston isolated stack: self-hosted execution API with persistent runtime packages
  Judge0 isolated stack: optional future Linux-only provider with separate database, Redis, and workers

Reviewer Dashboard
  Session list
  Evidence timeline
  Replay viewer
  Risk heatmap
  Confirm/dismiss workflow
```

## Execution Rule

Every task follows this sequence:

1. Define the acceptance criteria.
2. Add or document the failing test or verification command.
3. Implement the smallest code change that can pass it.
4. Run the relevant tests, type checks, lint checks, and smoke checks.
5. Update `docs/task.md` with the result.
6. Do not proceed to the next phase if the test gate fails.

If a framework behavior, API, package version, or configuration key is not confirmed from the current codebase or official documentation, do not implement it as fact. Mark it unconfirmed and verify first.

## Phase 0 - Repository Foundation

Goal: create a maintainable monorepo baseline with test commands before feature code exists.

Deliverables:
- Root `package.json` with workspaces.
- `turbo.json`.
- `tsconfig.base.json`.
- `.gitignore`.
- Root `.env.example`.
- Docker folder with profile-based local services.

Test-first checks:
- Root scripts exist for `lint`, `typecheck`, `test`, and `build`.
- Workspace package discovery works.
- Docker Compose config validates.
- Git status contains only intentional changes.

Implementation notes:
- Prefer npm workspaces unless there is a verified reason to choose another package manager.
- Docker Compose must use profiles so developers do not have to run Postgres, Redis, RabbitMQ, MinIO, LiveKit, and Judge0 for unrelated work.

## Phase 1 - Shared Contracts and Database

Goal: define the contracts before services start inventing their own shapes.

Deliverables:
- `packages/shared`
  - session types
  - participant types
  - editor events
  - telemetry events
  - risk event types
  - constants
- `packages/db`
  - Prisma schema
  - Prisma client export
  - initial migration

Test-first checks:
- Shared event schema tests.
- Prisma schema validation.
- Migration apply/reset against local dev database.

Implementation notes:
- Postgres stores normalized business data and low-frequency aggregates.
- Raw editor replay data belongs in object storage, referenced by Postgres.
- The schema must not include a high-volume `keystrokes` table.

## Phase 2 - API Server

Goal: create a narrow API boundary for sessions, auth, and code execution.

Deliverables:
- `apps/server`
  - Express app skeleton
  - environment validation
  - health endpoint
  - auth middleware
  - session routes
  - code execution provider proxy
  - WebSocket/event forwarding boundary if needed

Test-first checks:
- Health endpoint test.
- Invalid environment test.
- Auth rejection and authorization tests.
- Session state-machine route tests.
- code execution provider validation tests.

Implementation notes:
- Do not expose Piston or Judge0 directly to clients.
- Apply body-size limits and output-size limits.
- The server code-execution proxy must enforce a configured numeric language allowlist because clients continue sending numeric language IDs.
- Piston is the default provider for Windows development because Docker Desktop uses cgroup v2 and Piston is designed for that host mode.
- Runtime versions must be pinned for reproducible interviews. The current Piston mapping targets Node.js `20.11.1` and Python `3.12.0`.
- Judge0 remains an optional future provider for dedicated Linux hosts. Do not use Judge0 RapidAPI as the default and do not require paid API credentials.
- Treat the planned NextAuth/Auth.js choice as unconfirmed for a Vite + Express architecture until verified. If it does not fit cleanly, use an OIDC/JWT boundary or move the web app to a framework with first-class support.

Current status:
- `apps/server` has a protected `POST /code-executions` route that validates input, selects a configured execution provider, sends constrained submissions, and normalizes `stdout`, `stderr`, status, and optional timing/memory fields.
- `CODE_EXECUTION_PROVIDER=piston` is the default. `CODE_EXECUTION_PROVIDER=judge0` remains available for the optional self-hosted Judge0 path.
- Normal tests use an injected fetch client so validation, provider mapping, timeout handling, upstream-failure behavior, invalid responses, and oversized output are deterministic.
- Piston smoke is implemented as `npm run smoke:piston --workspace @anecites/server`. It requires the `piston` Docker profile to be running and Node.js `20.11.1` or the configured runtime to be installed in Piston.
- Local Judge0 smoke remains optional as `npm run smoke:judge0 --workspace @anecites/server`; it is not part of normal Windows development.

## Phase 3 - Collaboration Server

Goal: make collaborative editing reliable before building UI polish.

Deliverables:
- `apps/collab`
  - Yjs WebSocket server
  - room mapping by `sessionId` and `documentId`
  - authorization check
  - persistence from Yjs updates
  - telemetry derivation from Yjs updates

Test-first checks:
- Two-client sync test.
- Cross-session isolation test.
- Unauthorized room join rejection test.
- Atomic insert telemetry test.
- Aggregate flush test proving raw events are not written to Postgres.

Implementation notes:
- Yjs updates are the source of truth.
- Persist document snapshots and raw replay evidence without creating a second independent logging path.
- Redis Streams carries continuous telemetry to the risk engine.
- Large insert counts are derived from the applied Yjs text delta, not from net document-length changes, so same-length replacements remain observable.

## Phase 4 - Editor Core

Goal: build a reusable editor package before embedding it in the desktop app.

Deliverables:
- `packages/editor-core`
  - Monaco/Yjs component
  - awareness cursors
  - paste blocker
  - atomic insert detector
  - code execution API client
  - replay engine

Test-first checks:
- Component smoke test.
- Yjs sync unit test.
- DOM paste prevention test.
- Monaco command override test.
- Atomic insert detection test.
- Replay determinism test.

Implementation notes:
- Clipboard blocking is deterrence, not a security boundary.
- Atomic insert detection is required because OS-level paste injection may bypass DOM paste events.
- The candidate editor overrides Monaco's paste action and Ctrl/Cmd+V and Shift+Insert bindings, while the interviewer editor remains unrestricted.
- A blocked paste sends only an authenticated collaboration marker. The server derives session, participant, document, role, and timestamp before writing the raw Redis event and rolling Postgres aggregate.
- Monaco content changes are applied incrementally to Yjs so ordinary typing does not appear as a whole-document replacement.

## Phase 5 - Desktop App

Goal: ship the first working candidate/interviewer shell with editor integration.

Deliverables:
- `apps/desktop`
  - Tauri v2 scaffold
  - React/Vite UI
  - session join flow
  - editor/output split pane
  - Rust command modules
  - Windows-native scanner boundaries

Test-first checks:
- UI smoke test.
- Session join validation test.
- Rust command validation tests.
- Platform guard tests.

Implementation notes:
- Keep the first UI utilitarian and dense. This is an interview tool, not a landing page.
- Windows 10/11 is the first supported target. Unsupported platforms must fail clearly.
- Native helper work stays user-mode.

## Phase 6 - Module 1 Gate

Goal: prove the editor, collaboration, telemetry, and sandbox assumptions before starting video work.

Required passing tests:
- T-ED-01: Two clients edit the same document concurrently.
- T-ED-02: OS-level paste injection is flagged in telemetry.
- T-ED-03: Fork bomb is contained by the configured code-execution provider.
- T-ED-04: Network call is blocked in the sandbox.
- T-ED-05: 50 concurrent sessions load test passes.
- T-ED-06: Right-click paste is blocked and logged.
- T-ED-07: Keystroke replay matches original timing within tolerance.

Exit criteria:
- All Module 1 tests pass.
- The root `test`, `typecheck`, `lint`, and `build` commands pass.
- No high-frequency raw telemetry is stored directly in Postgres.
- The configured code-execution provider cannot route to main app services.

## Later Modules

### Module 2 - Video Call

Deliverables:
- LiveKit room/token flow.
- Desktop video UI.
- Candidate screen share.
- `getDisplayMedia` self-check.
- LiveKit egress recording.
- Network reconnect handling.

Gate:
- Throttled-network call test.
- Browser LiveKit reconnect smoke: `npm run smoke:livekit:browser --workspace @anecites/server`.
- Audio-priority degradation test.
- Screen-share correctness test.
- Recording completeness test.
- Reconnect test.

### Module 3 - AI Monitoring

Deliverables:
- Consent flow.
- Server-side face/gaze inference from LiveKit egress samples.
- Server-side audio VAD and diarization.
- Native helper v1 signals.
- Lag-loop detection.
- Composite risk engine.
- Reviewer dashboard.

Server-side media architecture:

```text
LiveKit room
  -> LiveKit egress recording
  -> MinIO/S3 recording object
  -> Postgres EvidenceObject reference
  -> RabbitMQ media-analysis job containing a bounded job id and object ids only
  -> apps/media-worker
       -> bounded audio/video sample extraction
       -> VAD / diarization adapter
       -> face / multi-face / gaze adapter
       -> shared MediaRiskSignalReport
  -> Express risk-summary service
  -> reviewer queue
```

Implementation order:

1. Persist LiveKit recording outputs as `EvidenceObject` rows.
   - The existing recording route currently returns the S3 filepath but does not persist an evidence reference.
   - Do this before media inference so every media signal can link to a specific recording object.

2. Add shared media-risk report types and mappers.
   - Keep raw frames, landmarks, waveform chunks, embeddings, and transcripts out of Postgres.
   - Store only bounded derived metadata in risk signals.
   - Extend the current `risk.media.second_voice` support with explicit face/multi-face/gaze signal types before UI work depends on them.

3. Add media-analysis configuration and queue contracts.
   - Use RabbitMQ for discrete media-analysis jobs.
   - Job payloads must contain `jobId`, `sessionId`, `recordingEvidenceObjectId`, and analysis options only.
   - Job payloads must not contain raw media bytes, frame dumps, access credentials, or provider secrets.

4. Add `apps/media-worker`.
   - The worker reads object references from Postgres and sends bounded object references to the isolated inference service; it does not receive object-storage credentials.
   - The worker runs sample extraction and model adapters off the Express request path.
   - Use injected adapters in tests before adding heavyweight CV/audio runtimes.

5. Add audio analysis first.
   - VAD is the first deliverable because it is easier to test deterministically than gaze.
   - Diarization / second-voice detection should operate on candidate audio windows and produce `risk.media.second_voice` only when confidence and duration thresholds are met.

6. Add video analysis after audio.
   - Face presence and multi-face are lower-risk than gaze and should land first.
   - Gaze/off-screen detection requires a per-session calibration contract; do not claim gaze accuracy without calibration fixtures and shadow-mode evaluation.

7. Persist media-derived risk summaries.
   - Media signals should flow through the existing `createRiskSummary` service.
   - All media-derived summaries remain `humanReviewRequired=true`.
   - No single media signal may trigger an automated adverse action.

Candidate/client boundary:
- The Tauri/React client must not run face, gaze, VAD, diarization, or model inference for core proctoring decisions.
- The client may collect consent and calibration inputs, but processing and risk scoring stay backend-side.
- The frontend never receives model credentials, object-storage credentials, or direct media-worker access.

Controls enforced by Anecites backend:
- Consent required before recording/media analysis.
- Recording evidence object references only; no raw media in Postgres.
- Queue payload size limits.
- Sample-window and recording-duration limits.
- Confidence and duration thresholds for emitted media signals.
- Human-review-only risk summaries.
- Retention policy values are explicit configuration knobs:
  - `RECORDING_RETENTION_DAYS` defaults to 30.
  - `EVIDENCE_RETENTION_DAYS` and `REPLAY_RETENTION_DAYS` default to 90.
  - `TELEMETRY_RETENTION_DAYS` defaults to 180.
  - `RISK_SUMMARY_RETENTION_DAYS` defaults to 365.
  These values are policy/config only until a cleanup worker physically deletes expired Postgres rows and object-storage evidence.

Controls enforced by the media worker/runtime:
- CPU and memory limits in the worker container.
- Bounded FFmpeg/sample extraction.
- Model adapter timeout.
- No outbound network by default once required models are present locally.
- Manual RabbitMQ acknowledgement only after durable completion.
- Confirm-published delayed retries and sanitized dead letters.
- A 64 KiB queue-payload limit and bounded retry/prefetch settings.
- Fenced database leases and canonical payload hashes so successful redelivery cannot repeat inference or create duplicate summaries.

Implemented inference boundary:
- `apps/media-inference` is a small Python service because the selected MediaPipe and Silero runtimes are maintained for Python.
- The service reads only allowlisted MinIO/S3 object references using backend-only credentials, enforces object-size and duration bounds, processes temporary files on bounded container storage, and deletes those files after each request.
- MediaPipe face detection runs independently sampled frames in stateless image mode and returns sampled-window face counts, condition-support ratios, and detector scores. The worker uses condition support for face-missing/multiple-face thresholds; it does not invent a model probability for absence or carry video timestamps across recordings.
- Silero VAD returns speech-activity timestamps only. VAD output is not second-speaker evidence and is not mapped to `risk.media.second_voice`.
- Gaze output remains unavailable because no per-session calibrated gaze runtime exists.
- Calibration target acknowledgements are stored without raw landmarks and are bound to the active candidate-track recording that produced their future evidence. If that recording ends or is replaced, the calibration is abandoned and must restart against the new recording. This is audit lineage only; it is not a gaze score or risk signal.
- The internal HTTP client rejects malformed, oversized, timed-out, version-mismatched, and uncalibrated-gaze responses. Object-store credentials are never present in request payloads.
- The `media-inference` Compose profile publishes no host port, uses an internal network shared with MinIO, runs read-only with bounded temporary storage, drops all capabilities, and applies CPU, memory, and process limits.
- The `media-worker` Compose profile publishes no port, runs as a non-root user with a read-only filesystem and bounded resources, and uses separate internal-only networks for PostgreSQL/RabbitMQ control traffic and inference RPC.
- The worker currently wires only the real face-presence adapter. Audio second-voice and gaze requests fail closed because the available VAD runtime is not diarization and the gaze runtime is not calibrated.
- `media-analysis.jobs.retry` applies a bounded delay before dead-lettering back to the main queue; `media-analysis.jobs.dead` receives invalid, permanent, or retry-exhausted jobs without stack traces or provider secrets.

Still unconfirmed or incomplete:
- Second-speaker detection requires a separately reviewed diarization model. Silero VAD alone cannot identify speakers.
- Gaze/off-screen detection requires per-session calibration fixtures and shadow-mode evaluation before risk signals can be emitted.
- Model accuracy, demographic performance, and operational thresholds require representative evaluation data; package integration tests do not establish production accuracy.
- Automatic RabbitMQ publication is implemented for recordings stopped through the application: after LiveKit reports `EGRESS_COMPLETE`, the server confirm-publishes one deterministic, bounded `MediaAnalysisJob` referencing the persisted recording evidence. The job requests only the available face-presence detector and contains no raw media, object-store credentials, or unavailable diarization/gaze requests.
- Recordings that finish independently of the application stop-recording request are covered by `POST /webhooks/livekit`. The route consumes the exact `application/webhook+json` body before Express JSON parsing, verifies LiveKit's signed `Authorization` token and payload hash with the installed server SDK, acknowledges irrelevant or unsuccessful egress events, and publishes only completed recording evidence.
- LiveKit webhook delivery can be retried or duplicated and is not guaranteed. Both the stop route and webhook use the same deterministic job ID; RabbitMQ redelivery is tolerated by the media worker's durable job-ID and payload-hash idempotency. Production operations must configure the public API webhook URL in LiveKit and monitor repeated `5xx` delivery failures.

Gate:
- Gaze calibration accuracy test.
- Second-voice detection test.
- Native helper controlled detection and false-positive test.
- Full mock interview with planted cheat attempt.
- Shadow-mode calibration before production enforcement.

Legal/privacy/adverse-action gate:
- Anecites is not pilot-ready until qualified legal/privacy counsel approves candidate notice, consent language, recording/media inference, biometric/sensitive-data handling, retention/deletion windows, reviewer access, appeals, and adverse-action workflows for the intended launch jurisdictions.
- Engineering checks may prove that consent, retention knobs, human-review-only summaries, and evidence boundaries are implemented; they must not be represented as legal compliance.
- Reviewer workflows must continue to present risk summaries as evidence requiring human judgment, not as automated employment or interview decisions.
- Product copy must not claim that gaze, face, voice, native, or composite risk signals are bias-free, conclusive, or sufficient for adverse action without human review.

Accessibility gate:
- Anecites is not pilot-ready until candidate, interviewer, and reviewer flows pass keyboard-only, screen-reader, visible-focus, dialog-focus, contrast, captions/accommodation, and reduced-motion review.
- The review must include the editor, code execution controls, LiveKit media controls, screen-share controls, native-monitoring consent/status, risk summaries, reviewer queue, and review actions.
- Webcam/gaze/audio/native-monitoring signals require an accessibility accommodation path before they can affect human-review workflows.
- Do not mark an accessibility blocker resolved in docs or release notes until it is verified against the built UI.

Sandbox/security gate:
- Local-development Piston is privileged and exposed only on localhost; this is acceptable for development but not sufficient for production candidate code execution.
- Production code execution requires a dedicated security review covering outbound-network blocking, CPU/memory/process/file/wall-time/output limits, container privilege, seccomp/AppArmor/gVisor/Firecracker or equivalent isolation, and network isolation from Postgres, Redis, RabbitMQ, MinIO/S3, LiveKit, and internal APIs.
- Piston or Judge0 must remain backend-only. The Tauri/React client must never receive provider URLs, provider credentials, object-storage credentials, or internal service addresses.
- Media workers must remain separate from the Express request path and from code-execution containers. They must not expose direct client endpoints, and their object-storage access must be scoped to evidence objects required for a job.
- Model/runtime packages for media inference must be reviewed for licensing, outbound-network behavior, update source, CPU/memory behavior, and reproducible packaging before production use.

Signing/update-process gate:
- The Tauri desktop app is not production-distributable until release engineering verifies platform signing, artifact provenance, update-channel policy, authenticated update manifests, rollback, and key/signature rotation.
- Release provenance must identify the source commit, build machine or CI runner, dependency lockfiles, generated artifact checksums, and reviewer approval.
- Development or pilot builds without signing or authenticated updates must be labeled non-production.
- No unsigned or unauthenticated auto-update path may be enabled for production.

## Known Risks and Required Follow-Up

- The existing documentation still needs a consistency pass before code implementation if it conflicts with this plan.
- Auth framework fit is not confirmed from the current codebase.
- Package versions are not confirmed from the current codebase.
- Piston hardening details require a dedicated security review before production use. Piston runs as a privileged container and is acceptable for local development, not a complete production trust boundary.
- Local Judge0 starts and publishes the API port, but its sandbox runtime fails on Docker Desktop cgroup v2. Keep Judge0 only as an optional future provider for a dedicated Linux host.
- Biometric processing, recording retention, candidate notice, consent, appeals, and adverse-action workflows require legal/privacy counsel approval before pilot deployment.
- Accessibility, sandbox/security, and signing/update-process gates require explicit review before pilot or production distribution.
