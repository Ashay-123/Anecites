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
  - room mapping by `sessionId`
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

Gate:
- Gaze calibration accuracy test.
- Second-voice detection test.
- Native helper controlled detection and false-positive test.
- Full mock interview with planted cheat attempt.
- Shadow-mode calibration before production enforcement.

## Known Risks and Required Follow-Up

- The existing documentation still needs a consistency pass before code implementation if it conflicts with this plan.
- Auth framework fit is not confirmed from the current codebase.
- Package versions are not confirmed from the current codebase.
- Piston hardening details require a dedicated security review before production use. Piston runs as a privileged container and is acceptable for local development, not a complete production trust boundary.
- Local Judge0 starts and publishes the API port, but its sandbox runtime fails on Docker Desktop cgroup v2. Keep Judge0 only as an optional future provider for a dedicated Linux host.
- Biometric processing, recording retention, and adverse-action workflows require legal review before pilot deployment.
