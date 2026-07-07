# Task Plan - Anecites Phase 1

Status legend:
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[blocked]` Blocked by an unresolved decision, missing dependency, or failed test gate

Working rule: every implementation task must start by defining the verification command or failing test. A task is not done until its tests, type checks, and relevant smoke checks pass.

## Current Baseline

- [x] Read the provided source inputs:
  - `D:\downloads_new\implementation_plan.md`
  - `C:\Users\sansk\OneDrive\Desktop\tasks.txt`
  - `C:\Users\sansk\OneDrive\Desktop\critical_problems to tabkle.txt`
- [x] Inspect the current repository shape.
- [x] Confirm the repo currently contains documentation only, plus `.gitattributes`.
- [x] Create this task plan in `docs/task.md`.
- [x] Create the implementation plan in `docs/implementation_plan.md`.

## Non-Negotiable Implementation Gates

- [ ] No feature is implemented before its acceptance test or verification check is written down.
- [ ] No module starts until the previous module's test gate passes.
- [ ] No raw high-frequency telemetry is stored directly in Postgres.
- [ ] No candidate-side ML inference is required for core proctoring decisions.
- [ ] No Judge0 execution path can reach the main app database, Redis, RabbitMQ, or internal APIs.
- [ ] No automated adverse action is allowed from a single signal or black-box score.

## Phase 0 - Repository Foundation

### T-00.01 Decide package manager and workspace convention

- [x] Confirm npm, pnpm, or yarn from project requirements.
- [x] Document the choice in the root `package.json`.
- Test first:
  - [x] Add a root command that can list all workspace packages.
- Done when:
  - [x] Workspace discovery works from the repository root.

### T-00.02 Add root project configuration

- [x] Create root `package.json`.
- [x] Create `package-lock.json`.
- [x] Create `turbo.json`.
- [x] Create `tsconfig.base.json`.
- [x] Create `.gitignore`.
- [x] Create `.env.example`.
- Test first:
  - [x] Add placeholder `lint`, `typecheck`, `test`, and `build` scripts that fail clearly until workspaces exist.
- Done when:
  - [x] Root scripts run without ambiguous missing-script errors.
  - [x] `git status` shows only intended files changed.

### T-00.03 Add Docker development structure

- [x] Create `docker/docker-compose.yml` with profiles.
- [x] Create `docker/.env.example`.
- [x] Create `docker/judge0.conf`.
- Test first:
  - [x] Add a documented `docker compose config` verification command.
- Done when:
  - [x] Compose config validates.
  - [x] Services are split by profiles so local development does not require the full stack.

### Phase 0 Verification Log

- [x] `npm run workspaces`
- [x] `npm run verify:root`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npx tsc --version`
- [x] `npx turbo --version`
- [x] `npm audit --audit-level=moderate`
- [x] `npm run verify:docker`
- [x] `docker compose --env-file docker/.env.example -f docker/docker-compose.yml --profile infra --profile judge0 config`

## Phase 1 - Shared Contracts and Persistence

### T-01.01 Create `packages/shared`

- [x] Add shared session, user, room, editor, telemetry, and risk event types.
- [x] Model high-frequency telemetry as buffered source events plus aggregated rolling features.
- [x] Define event names once and export them from the package.
- Test first:
  - [x] Add type-level or unit tests for event payload schemas.
- Done when:
  - [x] All packages can import shared types from a stable package entry point.

### Phase 1 Verification Log

- [x] Observed expected failing test before implementation: `npm run test --workspace @anecites/shared`
- [x] Observed expected failing test for missing user/room exports: `npm run test --workspace @anecites/shared`
- [x] `npm run test --workspace @anecites/shared`
- [x] `npm run typecheck --workspace @anecites/shared`
- [x] `npm run lint --workspace @anecites/shared`
- [x] `npm run build --workspace @anecites/shared`
- [x] `npm run workspaces`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run verify`
- [x] `npm audit --audit-level=moderate`

### T-01.02 Create `packages/db`

- [x] Add Prisma schema for Module 1 entities:
  - [x] users
  - [x] sessions
  - [x] participants
  - [x] editor documents
  - [x] code submissions
  - [x] risk summaries
  - [x] evidence object references
- [x] Do not model raw keystrokes as Postgres rows.
- [x] Store raw replay/evidence references as object-storage pointers.
- Test first:
  - [x] Add Prisma schema validation command.
  - [x] Add migration verification command.
- Done when:
  - [x] Prisma validation passes.
  - [x] Initial migration can be applied to a local dev database.

### Phase 1 DB Verification Log

- [x] Observed expected failing test before implementation: `npm run test --workspace @anecites/db`
- [x] Observed expected Prisma validation failure before schema creation: `npm run prisma:validate --workspace @anecites/db`
- [x] Verified and rejected `prisma@7.8.0` / `@prisma/client@7.8.0` because `npm audit --audit-level=moderate` reported 3 moderate vulnerabilities.
- [x] Pinned `prisma@6.19.3` and `@prisma/client@6.19.3`; `npm audit --audit-level=moderate` reports 0 vulnerabilities.
- [x] `npm run test:schema --workspace @anecites/db`
- [x] `npm run prisma:validate --workspace @anecites/db`
- [x] `npm run prisma:migrate:diff --workspace @anecites/db`
- [x] `npm run prisma:migrate:create --workspace @anecites/db`
- [x] `npm run prisma:migrate:deploy --workspace @anecites/db`
- [x] `docker exec anecites-postgres-1 psql -U anecites -d anecites -c "\dt"`
- [x] `npm run test --workspace @anecites/db`
- [x] `npm run typecheck --workspace @anecites/db`
- [x] `npm run lint --workspace @anecites/db`
- [x] `npm run build --workspace @anecites/db`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run verify`
- [x] `npm audit --audit-level=moderate`

## Phase 2 - API Server

### T-02.01 Create `apps/server`

- [x] Add Express app skeleton.
- [x] Add health endpoint.
- [x] Add request logging, error handling, CORS, and JSON body limits.
- [x] Add environment validation.
- Test first:
  - [x] Add health endpoint test.
  - [x] Add invalid-env startup test.
- Done when:
  - [x] Server starts locally.
  - [x] Health test passes.

### Phase 2 API Foundation Verification Log

- [x] Observed expected failing test before implementation: `npm run test --workspace @anecites/server`
- [x] Verified package versions before installation:
  - [x] `express@5.2.1`
  - [x] `@types/express@5.0.6`
  - [x] `@types/node@24.13.2`
- [x] `npm audit --audit-level=moderate`
- [x] `npm run test --workspace @anecites/server`
- [x] `npm run typecheck --workspace @anecites/server`
- [x] `npm run lint --workspace @anecites/server`
- [x] `npm run build --workspace @anecites/server`
- [x] CLI smoke test: started `node apps/server/dist/index.js`, requested `GET /health`, received HTTP 200, then stopped the process.
- [x] `npm run workspaces`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run verify`
- [x] `npm audit --audit-level=moderate`

### T-02.02 Add session routes

- [x] Create session CRUD routes.
- [x] Add explicit session state transitions.
- [x] Reject invalid state transitions.
- Test first:
  - [x] Add route tests for create, read, join, start, end, and invalid transition.
- Done when:
  - [x] Session routes pass tests against a test database.

### Phase 2 Session Route Verification Log

- [x] Observed expected failing test before implementation: `npm run test --workspace @anecites/server`
- [x] Confirmed local Postgres health: `docker inspect --format='{{.State.Health.Status}}' anecites-postgres-1`
- [x] Added database-backed route tests for:
  - [x] create session
  - [x] read session
  - [x] join session as participant
  - [x] valid state transitions through `scheduled`, `lobby`, `active`, and `ended`
  - [x] invalid transition rejection
  - [x] missing session rejection
- [x] `npm run test --workspace @anecites/server`
- [x] `npm run typecheck --workspace @anecites/server`
- [x] `npm run lint --workspace @anecites/server`
- [x] `npm run build --workspace @anecites/server`
- [x] `npm run workspaces`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run verify`
- [x] `npm audit --audit-level=moderate`

### T-02.03 Add authentication boundary

- [x] Verify the auth framework choice before implementation.
- [x] If using a Vite dashboard plus Express API, do not assume NextAuth/Auth.js fits without checking official docs.
- [x] For Phase 1, prefer a boring JWT/OIDC boundary unless the repo moves the web app to a framework with first-class Auth.js support.
- Test first:
  - [x] Add tests for unauthenticated, invalid-token, and authorized requests.
- Done when:
  - [x] Protected routes reject unauthenticated traffic.
  - [x] Tokens include only necessary claims.

### Phase 2 Auth Verification Log

- [x] Verified Auth.js Express status from official docs: `@auth/express` is currently experimental, so Phase 1 uses a narrow JWT bearer boundary instead.
- [x] Verified `jose@6.2.3` before installation.
- [x] Observed expected failing auth test before middleware implementation: `npm run test --workspace @anecites/server`
- [x] Added tests for missing bearer token, invalid bearer token, and valid bearer token.
- [x] Added `AUTH_JWT_SECRET` environment validation with a 32-character minimum.
- [x] `npm run test --workspace @anecites/server`
- [x] `npm run typecheck --workspace @anecites/server`
- [x] `npm run lint --workspace @anecites/server`
- [x] `npm run build --workspace @anecites/server`
- [x] `npm run workspaces`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run verify`
- [x] `npm audit --audit-level=moderate`

### T-02.04 Add Judge0 proxy

- [x] Add API endpoint that submits code to Judge0.
- [x] Enforce language allowlist, time limit, memory limit, and output size limit.
- [x] Do not expose Judge0 directly to the desktop or web clients.
- Test first:
  - [x] Add unit tests for validation failures.
  - [x] Add integration smoke command against local Judge0 once Docker is available.
  - [blocked] Execute integration smoke against local Judge0. `judge0-server` is reachable at `http://127.0.0.1:2358`, and `judge0-server` / `judge0-worker` now match Judge0's privileged container requirement. `npm run smoke:judge0 --workspace @anecites/server` still fails because Docker Desktop is exposing cgroup v2 only; Judge0's isolate path expects the cgroup v1 memory controller at `/sys/fs/cgroup/memory`.
- Done when:
  - [x] Valid submissions return stdout, stderr, time, and memory.
  - [x] Invalid or abusive submissions fail closed.

### Phase 2 Judge0 Proxy Verification Log

- [x] Verified Judge0 CE API shape from official docs:
  - `POST /submissions/{?base64_encoded,wait}`
  - required `source_code` and `language_id`
  - runtime constraint fields including `cpu_time_limit`, `wall_time_limit`, `memory_limit`, `max_file_size`, `enable_network`, and `number_of_runs`
  - execution result fields including `stdout`, `stderr`, `compile_output`, `message`, `status`, `token`, `time`, and `memory`
- [x] Observed expected failing tests before implementation: `npm run test --workspace @anecites/server`
- [x] Added protected `POST /code-executions` route.
- [x] Added fail-closed config validation for `JUDGE0_ALLOWED_LANGUAGE_IDS` and code execution limits.
- [x] Added mocked Judge0 route tests for success, auth rejection, disallowed language rejection, source/stdin size rejection, upstream failure, and oversized output.
- [x] Added opt-in local smoke command: `npm run smoke:judge0 --workspace @anecites/server`
- [x] `npm run test --workspace @anecites/server`
- [blocked] `npm run smoke:judge0 --workspace @anecites/server` reaches Judge0 but cannot pass until the local Docker runtime exposes cgroup v1 memory control to Judge0.
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run verify`
- [x] `npm audit --audit-level=moderate`
- [x] `git diff --check`

## Phase 3 - Collaboration Server

### T-03.01 Create `apps/collab`

- [ ] Add Yjs WebSocket server.
- [ ] Map `sessionId` to isolated rooms.
- [ ] Add room authorization through the API server.
- Test first:
  - [ ] Add a two-client sync test.
  - [ ] Add cross-session isolation test.
- Done when:
  - [ ] Two clients can edit the same document with no dropped updates.
  - [ ] Clients cannot join unauthorized rooms.

### T-03.02 Add Yjs-derived telemetry

- [ ] Derive behavioral telemetry from the Yjs update stream.
- [ ] Buffer raw high-frequency data in memory or Redis.
- [ ] Flush rolling aggregates to Postgres every 1-2 seconds.
- [ ] Store raw replay evidence as append-only newline-delimited JSON in object storage.
- [ ] Use Redis Streams for continuous telemetry; reserve RabbitMQ for discrete jobs.
- Test first:
  - [ ] Add tests showing large atomic inserts are flagged even without a DOM paste event.
  - [ ] Add tests showing aggregates are flushed but raw keystrokes are not written to Postgres.
- Done when:
  - [ ] Replay data is available from object storage.
  - [ ] Live scoring can consume aggregated features without database write amplification.

## Phase 4 - Editor Core

### T-04.01 Create `packages/editor-core`

- [ ] Add Monaco editor wrapper.
- [ ] Add Yjs binding.
- [ ] Add awareness cursors and selections.
- [ ] Export a stable `MonacoCollabEditor` component.
- Test first:
  - [ ] Add component smoke test.
  - [ ] Add Yjs sync test using two document instances.
- Done when:
  - [ ] Editor can sync changes through the collab server.

### T-04.02 Add paste blocking and telemetry

- [ ] Block browser paste events in the candidate editor pane.
- [ ] Disable Monaco paste commands where possible.
- [ ] Detect large atomic inserts as suspicious even when paste events are bypassed.
- [ ] Log events to the Yjs-derived telemetry path.
- Test first:
  - [ ] Add DOM paste prevention test.
  - [ ] Add Monaco command override test.
  - [ ] Add atomic insert detection test.
- Done when:
  - [ ] Right-click paste, keyboard paste, and simulated atomic inserts are covered by tests.

### T-04.03 Add code runner client

- [ ] Add typed API client for the server Judge0 proxy.
- [ ] Surface stdout, stderr, time, memory, and error states.
- Test first:
  - [ ] Add mocked API tests for success, compile error, timeout, and server failure.
- Done when:
  - [ ] The UI receives normalized execution results.

### T-04.04 Add replay engine

- [ ] Reconstruct document state from replay evidence.
- [ ] Preserve timing between operations.
- Test first:
  - [ ] Add replay determinism test.
  - [ ] Add timing tolerance test.
- Done when:
  - [ ] Replayed output matches the original final document.

## Phase 5 - Desktop App

### T-05.01 Create `apps/desktop`

- [ ] Scaffold Tauri v2 + React + Vite + TypeScript.
- [ ] Add dark, utilitarian interview UI.
- [ ] Add split pane for editor and output.
- [ ] Add session join flow.
- Test first:
  - [ ] Add UI smoke test.
  - [ ] Add session join validation test.
- Done when:
  - [ ] Desktop app can join a session and connect to the collab server.

### T-05.02 Add Rust backend skeleton

- [ ] Add Tauri command modules.
- [ ] Add process scanner module boundary.
- [ ] Add window monitor module boundary.
- [ ] Add capture-affinity checker boundary.
- [ ] Add VM detection boundary.
- Test first:
  - [ ] Add Rust unit tests for command input validation.
  - [ ] Add platform guard tests for Windows-only code paths.
- Done when:
  - [ ] Native commands return typed, testable results.
  - [ ] Unsupported platforms fail clearly.

## Phase 6 - Module 1 Test Gate

The project does not move to the video module until all tests below pass.

- [ ] T-ED-01: Two clients edit the same document concurrently with no conflicts or dropped updates.
- [ ] T-ED-02: OS-level paste injection is flagged in the edit telemetry.
- [ ] T-ED-03: Fork bomb is contained by the Judge0 sandbox.
- [ ] T-ED-04: Network call from candidate code is blocked in the sandbox.
- [ ] T-ED-05: 50 concurrent sessions pass a load test with no cross-session bleed.
- [ ] T-ED-06: Right-click paste is blocked and logged.
- [ ] T-ED-07: Keystroke replay matches original timing within documented tolerance.

## Later Phases

- [ ] Module 2: LiveKit video call, screen share, egress recording, reconnect handling.
- [ ] Module 3: server-side media inference, native helper v1, lag-loop detection, composite risk engine, reviewer dashboard.
- [ ] Hardening: legal review, accessibility review, sandbox review, signature update process, data retention policy.
