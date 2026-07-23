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
- [ ] No code-execution provider path can reach the main app database, Redis, RabbitMQ, or internal APIs.
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

### T-02.04 Add code execution provider proxy

- [x] Add API endpoint that submits code to the configured execution provider.
- [x] Enforce language allowlist, time limit, memory limit, and output size limit.
- [x] Do not expose Piston or Judge0 directly to the desktop or web clients.
- Test first:
  - [x] Add unit tests for validation failures.
  - [x] Add unit tests for provider selection, Piston request mapping, Piston response normalization, timeout handling, upstream errors, invalid responses, and oversized output.
  - [x] Add integration smoke command against local Piston once Docker is available.
  - [x] Execute integration smoke against local Piston after starting the `piston` Docker profile and installing pinned runtimes.
- Done when:
  - [x] Valid submissions return stdout, stderr, time, and memory.
  - [x] Invalid or abusive submissions fail closed.

### Phase 2 Code Execution Verification Log

- [x] Verified Judge0 CE API shape from official docs:
  - `POST /submissions/{?base64_encoded,wait}`
  - required `source_code` and `language_id`
  - runtime constraint fields including `cpu_time_limit`, `wall_time_limit`, `memory_limit`, `max_file_size`, `enable_network`, and `number_of_runs`
  - execution result fields including `stdout`, `stderr`, `compile_output`, `message`, `status`, `token`, `time`, and `memory`
- [x] Observed expected failing tests before implementation: `npm run test --workspace @anecites/server`
- [x] Added protected `POST /code-executions` route.
- [x] Added fail-closed config validation for `CODE_EXECUTION_ALLOWED_LANGUAGE_IDS` and code execution limits.
- [x] Added mocked Judge0 route tests for success, auth rejection, disallowed language rejection, source/stdin size rejection, upstream failure, and oversized output.
- [x] Added opt-in local smoke command: `npm run smoke:judge0 --workspace @anecites/server`
- [x] `npm run test --workspace @anecites/server`
- [blocked] `npm run smoke:judge0 --workspace @anecites/server` reaches Judge0 but cannot pass until the local Docker runtime exposes cgroup v1 memory control to Judge0.
- [x] Switched the default code-execution provider direction to self-hosted Piston for Windows development.
- [x] Added provider-agnostic config with `CODE_EXECUTION_PROVIDER`, `CODE_EXECUTION_ALLOWED_LANGUAGE_IDS`, `PISTON_BASE_URL`, and `PISTON_REQUEST_TIMEOUT_MS`.
- [x] Added a small provider abstraction with `PistonExecutionProvider` and `Judge0ExecutionProvider`.
- [x] Added Piston language mapping for numeric language IDs `63` and `71`.
- [x] Added Docker Compose `piston` profile with localhost-only port publishing and persistent Piston packages.
- [x] Added `npm run smoke:piston --workspace @anecites/server`.
- [x] `npm run build --workspace @anecites/server`
- [x] `node --test --test-isolation=none .\apps\server\test\config.test.mjs .\apps\server\test\judge0.test.mjs .\apps\server\test\piston.test.mjs`
- [x] `docker compose -f .\docker\docker-compose.yml --profile piston config --quiet`
- [x] `npm run smoke:piston --workspace @anecites/server`
- [x] `npm run test --workspace @anecites/server` (`21` tests, `21` passed, `0` failed)
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run verify`
- [x] `npm audit --audit-level=moderate`
- [x] `git diff --check`

## Phase 3 - Collaboration Server

### T-03.01 Create `apps/collab`

- [x] Add Yjs WebSocket server.
- [x] Map `sessionId` to isolated rooms.
- [x] Add persisted room authorization at the collab server boundary.
  - Runtime implementation validates JWTs and checks `Participant(sessionId, userId, role, leftAt)` through Prisma before joining a room.
  - This is DB-backed, not a separate internal HTTP API endpoint.
- Test first:
  - [x] Add a two-client sync test.
  - [x] Add cross-session isolation test.
  - [x] Add invalid-token rejection test.
  - [x] Add authorization-denial rejection test.
  - [x] Add persisted participant authorization test.
  - [x] Add missing participant rejection test.
- Done when:
  - [x] Two clients can edit the same document with no dropped updates.
  - [x] Clients cannot join unauthorized rooms.
  - [x] Collab standalone startup uses `DATABASE_URL` and the persisted participant authorizer.

### Phase 3 Collaboration Server Verification Log

- [x] Observed expected failing test before implementation: `npm run test --workspace @anecites/collab`
- [x] Verified package versions before installation:
  - [x] `yjs@13.6.31`
  - [x] `ws@8.21.0`
  - [x] `@types/ws@8.18.1`
- [x] `npm run test --workspace @anecites/collab` (`4` tests, `4` passed, `0` failed)
- [x] Observed expected failing test before persisted authorization implementation: `npm run test --workspace @anecites/collab`
- [x] Attempted DB integration verification, but Docker Desktop was not reachable from this environment.
- [x] `npm run test --workspace @anecites/collab` (`8` tests, `8` passed, `0` failed)
- [x] `npm audit --audit-level=moderate`
- [x] `git diff --check`
- [x] `npm run verify`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [blocked] `npm run test` timed out while Docker/Postgres was unavailable; lingering Node test processes were stopped.
- [x] After starting Postgres with `docker compose -f .\docker\docker-compose.yml --profile infra up -d postgres`, `npm run test` passed (`48` tests, `48` passed, `0` failed)
- [x] `npm run workspaces`
- [x] `git diff --check`
- [x] `npm audit --audit-level=moderate`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test` (`44` tests, `44` passed, `0` failed)
- [x] `npm run build`
- [x] `npm run verify`

### T-03.02 Add Yjs-derived telemetry

- [x] Derive behavioral telemetry from the Yjs update stream.
- [x] Buffer raw high-frequency data in Redis.
  - Current implementation appends raw atomic-insert telemetry to a Redis Stream through an injectable sink.
- [x] Flush rolling aggregates to Postgres every 1-2 seconds.
  - Current implementation creates `RollingEditorTelemetryAggregate` records and persists them through a Prisma sink.
  - The sink increments existing aggregate windows and preserves the maximum insert size.
- [x] Store raw replay evidence as append-only newline-delimited JSON in object storage.
  - Current implementation writes one immutable NDJSON object per Yjs update under the replay evidence prefix.
  - This avoids pretending S3-compatible object storage supports appending to an existing object.
- [x] Use Redis Streams for continuous telemetry; reserve RabbitMQ for discrete jobs.
- Test first:
  - [x] Add tests showing large atomic inserts are flagged even without a DOM paste event.
  - [x] Add tests showing aggregates are flushed while raw atomic-insert events stay on the raw-event path.
  - [x] Add tests showing the Prisma sink creates and increments aggregate rows without lowering max insert size.
  - [x] Add tests showing the Redis sink appends raw atomic insert events to a stream.
  - [x] Add tests showing replay evidence writes raw Yjs updates as immutable NDJSON objects.
- Done when:
  - [x] Replay data is available from object storage.
  - [x] Live scoring can consume raw features without database write amplification.
    - Raw atomic-insert telemetry is streamed to Redis; rolling aggregates are persisted separately.

### Phase 3 Telemetry Verification Log

- [x] Observed expected failing telemetry tests before implementation: `npm run test --workspace @anecites/collab`
- [x] `npm run test --workspace @anecites/collab` (`10` tests, `10` passed, `0` failed)
- [x] Observed expected failing Prisma sink tests before implementation: `npm run test --workspace @anecites/collab`
- [x] `npm run test --workspace @anecites/collab` (`12` tests, `12` passed, `0` failed)
- [x] Observed expected failing Redis sink tests before implementation: `npm run test --workspace @anecites/collab`
- [x] `npm run test --workspace @anecites/collab` (`13` tests, `13` passed, `0` failed)
- [x] Observed expected failing replay evidence tests before implementation: `npm run test --workspace @anecites/collab`
- [x] `npm run test --workspace @anecites/collab` (`15` tests, `15` passed, `0` failed)
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test` (`50` tests, `50` passed, `0` failed)
- [x] `npm run test` (`52` tests, `52` passed, `0` failed)
- [x] `npm run test` (`53` tests, `53` passed, `0` failed)
- [x] `npm run test` (`55` tests, `55` passed, `0` failed)
- [x] `npm audit --audit-level=moderate`
- [x] `npm run verify`
- [x] `git diff --check`

## Phase 4 - Editor Core

### T-04.01 Create `packages/editor-core`

- [x] Add Monaco editor wrapper.
  - The package mounts `monaco-editor@0.53.0` through the React `MonacoCollabEditor` component.
  - `monaco-editor@0.55.1` remains rejected because its dependency graph introduced a `dompurify` audit finding.
- [x] Add Yjs binding.
- [x] Add awareness cursors and selections.
- [x] Export a stable `MonacoCollabEditor` component.
- Test first:
  - [x] Add component smoke test.
  - [x] Add Yjs sync test using two document instances.
  - [x] Add awareness cursor/selection sync test.
  - [x] Add collab server WebSocket sync test.
- Done when:
  - [x] Editor can sync changes through the collab server.
    - Yjs state updates sync between document instances.
    - `connectEditorCollabSession` syncs Yjs state updates through `apps/collab`.

### Phase 4 Editor Core Verification Log

- [x] Verified package versions before installation:
  - [x] `react@19.2.7`
  - [x] `react-dom@19.2.7`
  - [x] `@types/react@19.2.17`
  - [x] `@types/react-dom@19.2.3`
  - [x] `yjs@13.6.31`
- [x] Rejected direct `monaco-editor@0.55.1` dependency because `npm audit` reported a `dompurify` advisory through Monaco.
- [x] Observed expected failing editor-core tests before implementation: `npm run test --workspace @anecites/editor-core`
- [x] `npm run test --workspace @anecites/editor-core` (`5` tests, `5` passed, `0` failed)
- [x] Verified `y-protocols@1.0.7` before installation.
- [x] Observed expected failing awareness tests before implementation: `npm run test --workspace @anecites/editor-core`
- [x] `npm run test --workspace @anecites/editor-core` (`8` tests, `8` passed, `0` failed)
- [x] `npm run workspaces`
- [x] `npm audit --audit-level=moderate`
- [x] `npm run verify`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test` (`60` tests, `60` passed, `0` failed)
- [x] `npm run test` (`63` tests, `63` passed, `0` failed)
- [x] Observed expected failing collab client test before implementation: `npm run test --workspace @anecites/editor-core`
- [x] `npm run test --workspace @anecites/editor-core` (`9` tests, `9` passed, `0` failed)
- [x] `npm install --package-lock-only`
- [x] `npm audit --audit-level=moderate`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test` (`64` tests, `64` passed, `0` failed)
- [x] `npm run verify`
- [x] `git diff --check`

### T-04.02 Add paste blocking and telemetry

- [x] Block browser paste events in the candidate editor pane.
- [x] Disable Monaco paste commands where possible.
  - The candidate editor overrides Monaco's paste action and Ctrl/Cmd+V and Shift+Insert keybindings.
  - Paste remains enabled for interviewers.
- [x] Detect large atomic inserts as suspicious even when paste events are bypassed.
- [x] Log events to the Yjs-derived telemetry path.
  - Candidate paste attempts send only a `telemetry:paste-blocked` marker through the authenticated collaboration socket.
  - The collaboration server derives trusted session, participant, document, role, and timestamp context; candidate-supplied identity fields are not accepted.
  - Raw paste-blocked and atomic-insert events are written to the Redis raw-event stream, while only rolling aggregates are persisted in Postgres.
  - Large insert size is derived from the applied Yjs text delta, including same-length replacements.
- Test first:
  - [x] Add DOM paste prevention test.
  - [x] Add Monaco command override test.
  - [x] Add atomic insert detection test.
- Done when:
  - [x] Right-click paste, keyboard paste, and simulated atomic inserts are covered by tests.
    - Browser paste/context-menu paths, Monaco command/keybinding overrides, authenticated paste telemetry, and simulated same-length atomic replacements are covered.

### Phase 4 Paste Blocking Verification Log

- [x] Observed expected failing shared telemetry test before implementation: `npm run test --workspace @anecites/shared`
- [x] Observed expected failing editor-core paste/telemetry tests before implementation: `npm run test --workspace @anecites/editor-core`
- [x] `npm install --package-lock-only`
- [x] `npm audit --audit-level=moderate`
- [x] `npm run test --workspace @anecites/shared` (`15` tests, `15` passed, `0` failed)
- [x] `npm run test --workspace @anecites/editor-core` (`12` tests, `12` passed, `0` failed)
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test` (`68` tests, `68` passed, `0` failed)
- [x] `npm run verify`
- [x] `git diff --check`
- [x] Completion red tests observed before implementation:
  - [x] Collaboration tests rejected `telemetry:paste-blocked` and emitted an invalid `insertedCharacterCount` field.
  - [x] Editor-core tests failed because Monaco guards, incremental text changes, and `sendPasteBlockedTelemetry` did not exist.
  - [x] Candidate-only enforcement tests failed because interviewer paste was also disabled and interviewer markers were recorded.
- [x] Completion focused verification:
  - [x] `node --test --test-isolation=none apps/collab/test/collab.test.mjs apps/collab/test/telemetry.test.mjs` (`23` tests, `23` passed, `0` failed).
  - [x] `npm run test --workspace @anecites/editor-core` (`30` tests, `30` passed, `0` failed).
  - [x] `npm run test --workspace @anecites/desktop` (`45` JavaScript tests and `10` Rust tests, all passed).
- [x] Completion full verification: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, and `npm run test` (`227` JavaScript/Python tests and `10` Rust tests, `237` total, all passed); `npm audit --audit-level=moderate` reported `0` vulnerabilities and `git diff --check` passed.

### T-04.03 Add code runner client

- [x] Add typed API client for the server code-execution proxy.
- [x] Surface stdout, stderr, time, memory, and error states.
- Test first:
  - [x] Add mocked API tests for success, compile error, timeout, and server failure.
- Done when:
  - [x] The UI receives normalized execution results.

### Phase 4 Code Runner Client Verification Log

- [x] Observed expected failing code-execution client test before implementation: `npm run test --workspace @anecites/editor-core`
- [x] `npm run test --workspace @anecites/editor-core` (`16` tests, `16` passed, `0` failed)
- [x] `npm audit --audit-level=moderate`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test` (`72` tests, `72` passed, `0` failed)
- [x] `npm run verify`
- [x] `git diff --check`

### T-04.04 Add replay engine

- [x] Reconstruct document state from replay evidence.
- [x] Preserve timing between operations.
- Test first:
  - [x] Add replay determinism test.
- [x] Add timing tolerance test.
  - Current replay timing tolerance is documented in tests as `5ms`.
- Done when:
  - [x] Replayed output matches the original final document.

### Phase 4 Replay Engine Verification Log

- [x] Observed expected failing replay test before implementation: `npm run test --workspace @anecites/editor-core`
- [x] `npm run test --workspace @anecites/editor-core` (`19` tests, `19` passed, `0` failed)
- [x] `npm audit --audit-level=moderate`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test` (`75` tests, `75` passed, `0` failed)
- [x] `npm run verify`
- [x] `git diff --check`

## Phase 5 - Desktop App

### T-05.01 Create `apps/desktop`

- [x] Scaffold Tauri v2 + React + Vite + TypeScript.
- [x] Add dark, utilitarian interview UI.
- [x] Add split pane for editor and output.
- [x] Add session join flow.
- Test first:
  - [x] Add UI smoke test.
  - [x] Add session join validation test.
- Done when:
  - [~] Desktop app can join a session and connect to the collab server.
    - Current shell validates join input and renders the editor/output workspace.
    - Runtime collab connection wiring is pending because this task only adds the first desktop shell.
    - Native Tauri build verification is blocked until Rust and Cargo are installed.

### Phase 5 Desktop Shell Verification Log

- [x] Verified npm package versions before installation:
  - [x] `vite@8.1.4`
  - [x] `@vitejs/plugin-react@6.0.3`
  - [x] `@tauri-apps/api@2.11.1`
  - [x] `@tauri-apps/cli@2.11.4`
- [x] Observed expected failing desktop test before implementation: `npm run test --workspace @anecites/desktop`
- [x] `npm install`
- [x] `npm run test --workspace @anecites/desktop` (`3` tests, `3` passed, `0` failed)
- [x] `npm run tauri --workspace @anecites/desktop -- info`
  - Tauri recognized the React/Vite app and config.
  - Initial run reported missing Rust tooling until the current process PATH was updated to include `C:\Users\sansk\.cargo\bin`.
- [x] `npm audit --audit-level=moderate`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test` (`78` tests, `78` passed, `0` failed)
- [x] `npm run verify`
- [x] `git diff --check`

### T-05.02 Add Rust backend skeleton

- [x] Add Tauri command modules.
- [x] Add process scanner module boundary.
- [x] Add window monitor module boundary.
- [x] Add capture-affinity checker boundary.
- [x] Add VM detection boundary.
- Test first:
  - [x] Add Rust unit tests for command input validation.
  - [x] Add platform guard tests for Windows-only code paths.
- Done when:
  - [x] Native commands return typed, testable results.
  - [x] Unsupported platforms fail clearly.
  - Current scanner modules are boundaries only; real Windows process/window/capture-affinity enumeration remains future work.

### Phase 5 Rust Backend Verification Log

- [x] Confirmed Rust toolchain through `C:\Users\sansk\.cargo\bin`:
  - [x] `rustc 1.97.0`
  - [x] `cargo 1.97.0`
  - [x] `stable-x86_64-pc-windows-msvc`
- [x] Observed expected failing Rust test before implementation: `cargo test --manifest-path apps\desktop\src-tauri\Cargo.toml`
- [x] Added generated `apps/desktop/src-tauri/icons/icon.ico` because Tauri requires `icons/icon.ico` for Windows resource generation.
- [x] `cargo fmt --manifest-path apps\desktop\src-tauri\Cargo.toml -- --check`
- [x] `npm run test:rust --workspace @anecites/desktop` (`4` Rust tests, `4` passed, `0` failed)
- [x] `npm run tauri --workspace @anecites/desktop -- info`
  - Tauri now detects WebView2, MSVC, Rust, Cargo, rustup, and the stable MSVC Rust toolchain.
- [x] `npm audit --audit-level=moderate`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test` (`78` Node tests and `4` Rust tests, all passed)
- [x] `npm run verify`
- [x] `git diff --check`

## Phase 6 - Module 1 Test Gate

The project does not move to the video module until all tests below pass.

- [x] T-ED-01: Two clients edit the same document concurrently with no conflicts or dropped updates.
- [x] T-ED-02: OS-level paste injection is flagged in the edit telemetry.
- [x] T-ED-03: Fork bomb is contained by the configured code-execution sandbox.
- [x] T-ED-04: Network call from candidate code is blocked in the sandbox.
- [x] T-ED-05: 50 concurrent sessions pass a load test with no cross-session bleed.
- [x] T-ED-06: Right-click paste is blocked and logged.
- [x] T-ED-07: Keystroke replay matches original timing within documented tolerance.

### Phase 6 Module 1 Verification Log

- [x] Added a focused collab convergence test covering concurrent edits from two clients and a late-joining snapshot.
- [x] `npm run test --workspace @anecites/collab` (`16` tests, `16` passed, `0` failed)
- [x] Added a focused simulated OS-level paste-injection test covering a large Yjs insert with no DOM paste event.
- [x] `npm run test --workspace @anecites/collab` (`17` tests, `17` passed, `0` failed)
- [x] Added a 50-session collab load/isolation test with two clients per room and no queued cross-room updates.
- [x] Fixed the load-test room-count race by waiting for server-side room registration after WebSocket open.
- [x] `npm run test --workspace @anecites/collab` (`18` tests, `18` passed, `0` failed)
- [x] Observed expected failing right-click paste test before implementation: `npm run test --workspace @anecites/editor-core`
- [x] Added context-menu paste blocking at the editor host and emitted paste-blocked telemetry through the existing raw event path.
- [x] `npm run test --workspace @anecites/editor-core` (`20` tests, `20` passed, `0` failed)
- [x] Added a keystroke replay timing test with a documented `5ms` tolerance.
- [x] `npm run test --workspace @anecites/editor-core` (`21` tests, `21` passed, `0` failed)
- [x] Added backend coverage for Piston process-limit failures normalizing to `Runtime Error`.
- [x] `npm run test --workspace @anecites/server` (`22` tests, `22` passed, `0` failed)
- [x] `npm run smoke:piston --workspace @anecites/server`
- [x] Ran a fork-stress Piston smoke through the backend proxy; Piston returned `Runtime Error` with `EAGAIN`, and the `piston` container remained `Up`.
- [x] Added backend coverage for Piston blocked-network failures normalizing to `Runtime Error`.
- [x] `npm run test --workspace @anecites/server` (`23` tests, `23` passed, `0` failed)
- [x] Ran a blocked-network Piston smoke through the backend proxy; Piston returned `Runtime Error` with `EAI_AGAIN`, and the `piston` container remained `Up`.
- [x] `npm audit --audit-level=moderate`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test` (`85` Node tests and `4` Rust tests, all passed)
- [x] `npm run verify`
- [x] `git diff --check`

## Later Phases

- [x] Module 2: LiveKit video call, screen share, egress recording, reconnect handling.
  - [x] T-VID-01: Add backend-only LiveKit room/token flow.
    - Test first:
      - [x] Add config tests for optional LiveKit URL/key/secret and token TTL validation.
      - [x] Add route tests for issuing a short-lived room join token to an existing session participant.
      - [x] Add route tests proving missing LiveKit server credentials fail closed without leaking secrets.
    - Done when:
      - [x] Clients receive only LiveKit URL, room name, participant identity, and a signed token.
      - [x] LiveKit API key and secret remain backend-only.
    - Verification log:
      - [x] Verified `livekit-server-sdk@2.17.0` from npm and official LiveKit server SDK docs before implementation.
      - [x] Observed expected failing server tests before implementation: missing LiveKit config fields and missing `POST /sessions/:sessionId/livekit-token` route.
      - [x] Added nullable backend LiveKit config: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_TOKEN_TTL_SECONDS`.
      - [x] Added backend-only LiveKit join-token helper using room join grants only.
      - [x] Added authenticated session token route that validates the participant belongs to the session.
      - [x] `npm run build --workspace @anecites/server`
      - [x] `node --test --test-isolation=none apps/server/test/config.test.mjs apps/server/test/sessions.test.mjs` (`11` tests, `11` passed, `0` failed)
      - [x] `npm run test --workspace @anecites/server` (`26` tests, `26` passed, `0` failed)
  - [x] T-VID-02: Add desktop LiveKit client UI.
    - Test first:
      - [x] Add desktop tests for requesting a backend-issued LiveKit token without LiveKit credentials.
      - [x] Add desktop tests for connecting an injected LiveKit room with the backend-issued token.
      - [x] Add render smoke coverage for the video call panel.
    - Done when:
      - [x] The desktop UI can request a LiveKit token from the backend after joining a session.
      - [x] The desktop UI can create/connect a LiveKit room using only the returned URL/token.
    - Verification log:
      - [x] Verified `livekit-client@2.20.1` from npm and official LiveKit client docs before implementation.
      - [x] Observed expected failing desktop test before implementation: missing `dist/livekit.js`.
      - [x] Added `apps/desktop/src/livekit.ts` with token request, lazy room creation, and injectable room connection.
      - [x] Added the video call panel to the desktop shell.
      - [x] First `npm run test --workspace @anecites/desktop` passed Node tests but failed Rust because this PowerShell process did not include `C:\Users\sansk\.cargo\bin` on `PATH`.
      - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run test --workspace @anecites/desktop` (`6` Node tests and `4` Rust tests, all passed)
  - [x] T-VID-03: Add candidate screen-share flow and `getDisplayMedia` self-check.
    - Test first:
      - [x] Add tests that `getDisplayMedia` is called with video enabled and returned tracks are stopped after the self-check.
      - [x] Add tests that unavailable or empty display capture fails closed.
      - [x] Add tests that screen sharing toggles through LiveKit's local participant API.
    - Done when:
      - [x] The desktop UI has explicit screen self-check, start-share, and stop-share controls.
      - [x] The implementation does not use a real browser prompt during tests.
    - Verification log:
      - [x] Observed expected failing desktop test before implementation: missing `runDisplayMediaSelfCheck` export.
      - [x] Added `runDisplayMediaSelfCheck` with injected `getDisplayMedia` support and captured-track cleanup.
      - [x] Added `setLiveKitScreenShare` against `room.localParticipant.setScreenShareEnabled`.
      - [x] Updated the desktop video panel with screen-check and share controls.
      - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run test --workspace @anecites/desktop` (`9` Node tests and `4` Rust tests, all passed)
  - [x] T-VID-04: Add LiveKit egress recording control.
    - Test first:
      - [x] Add config tests for S3-backed LiveKit recording settings.
      - [x] Add route tests that room-composite recording starts with S3 output.
      - [x] Add route tests that recording stop calls LiveKit egress stop.
      - [x] Add route tests proving missing recording storage fails closed.
    - Done when:
      - [x] Backend can start and stop LiveKit room-composite egress through authenticated session routes.
      - [x] Recording storage credentials remain backend-only.
    - Verification log:
      - [x] Inspected LiveKit SDK egress types before implementation: `EgressClient`, `EncodedFileOutput`, `S3Upload`, and `EncodedFileType`.
      - [x] Observed expected failing server tests before implementation: missing recording config fields and missing recording routes.
      - [x] Added `LIVEKIT_API_URL` with derivation from `LIVEKIT_URL` when omitted.
      - [x] Added recording S3 config using existing S3 environment names plus `LIVEKIT_RECORDING_KEY_PREFIX`.
      - [x] Added authenticated start/stop recording routes under `/sessions`.
      - [x] `npm run build --workspace @anecites/server`
      - [x] `node --test --test-isolation=none apps/server/test/config.test.mjs apps/server/test/sessions.test.mjs` (`13` tests, `13` passed, `0` failed)
      - [x] `npm run test --workspace @anecites/server` (`28` tests, `28` passed, `0` failed)
  - [x] T-VID-05: Add reconnect handling and throttled-network tests.
    - Test first:
      - [x] Add unit tests mapping LiveKit reconnect events to UI reconnect state.
      - [x] Add unit tests mapping reconnecting/disconnected states to audio-priority degraded mode.
      - [x] Add a real throttled-network call test against a running LiveKit environment.
    - Done when:
      - [x] Desktop cleans up LiveKit event handlers on disconnect/unmount.
      - [x] Desktop shows reconnecting and audio-priority degraded mode during LiveKit reconnect events.
      - [x] A real LiveKit call survives network throttling and returns to normal mode after reconnect.
    - Verification log:
      - [x] Verified LiveKit client connection states/events from official docs before implementation.
      - [x] Observed expected failing desktop test before implementation: missing `observeLiveKitRoomEvents` export.
      - [x] Added LiveKit room event observer for `signalReconnecting`, `reconnecting`, `reconnected`, and `disconnected`.
      - [x] Wired reconnect state into the desktop video panel.
      - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run test --workspace @anecites/desktop` (`10` Node tests and `4` Rust tests, all passed)
      - [x] `npm run smoke:livekit:browser --workspace @anecites/server` failed as expected before implementation because the script did not exist.
      - [x] Added `npm run smoke:livekit:browser --workspace @anecites/server`; it launches headless Chrome, connects two LiveKit participants, publishes fake media, verifies remote track subscription, forces a temporary DevTools network outage, and verifies reconnect recovery.
      - [x] `npm run smoke:livekit:browser --workspace @anecites/server` passed with local LiveKit room `smoke-livekit-browser-1783715853009`.
  - [x] T-VID-06: Add local LiveKit Docker profile and control-plane smoke test.
    - Test first:
      - [x] Extend Docker verification to require LiveKit config files and profile config.
      - [x] Observe expected verifier failure before adding `docker/livekit.yaml` and `docker/livekit-egress.yaml`.
    - Done when:
      - [x] LiveKit server, LiveKit egress, and LiveKit Redis run under a separate `livekit` Compose profile.
      - [x] LiveKit publishes only localhost development ports.
      - [x] A real LiveKit API smoke creates, lists, and deletes a room through backend-only credentials.
    - Verification log:
      - [x] Inspected LiveKit self-hosting and egress configuration docs before adding Docker config.
      - [x] `npm run verify:docker` failed as expected with missing `docker/livekit.yaml` and `docker/livekit-egress.yaml`.
      - [x] Added `docker/livekit.yaml` and `docker/livekit-egress.yaml`.
      - [x] Added `livekit`, `livekit-egress`, and `livekit-redis` services under the `livekit` Compose profile.
      - [x] Added `LIVEKIT_RECORDING_S3_ENDPOINT` so local egress can use Docker-internal `http://minio:9000` while host services keep `S3_ENDPOINT=http://localhost:9000`.
      - [x] First LiveKit start exposed a current LiveKit requirement: API secrets must be at least 32 characters.
      - [x] Updated local dev LiveKit secret to `devsecret_livekit_local_minimum_32_chars`.
      - [x] `docker compose --env-file docker/.env.example -f docker/docker-compose.yml --profile infra --profile livekit up -d --force-recreate livekit livekit-egress`
      - [x] `docker compose --env-file docker/.env.example -f docker/docker-compose.yml --profile infra --profile livekit ps -a` showed LiveKit, egress, LiveKit Redis, and MinIO running.
      - [x] `npm run smoke:livekit --workspace @anecites/server`
      - [x] `npm run test --workspace @anecites/server` (`28` tests, `28` passed, `0` failed)
      - [x] `npm run verify:docker`
      - [x] `npm audit --audit-level=moderate` (`0` vulnerabilities)
      - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run lint`
      - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run typecheck`
      - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run build`
      - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run verify`
      - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run test` (`97` Node tests and `4` Rust tests, all passed)
      - [x] `git diff --check`
  - [x] Module 2 partial verification:
    - [x] Pinned `livekit-server-sdk@2.17.0` and `livekit-client@2.20.1`.
    - [x] `npm audit --audit-level=moderate` (`0` vulnerabilities)
    - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run lint`
    - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run typecheck`
    - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run build`
    - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run test` (`97` Node tests and `4` Rust tests, all passed)
    - [x] `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run verify`
    - [x] `git diff --check`
    - [x] `npm run smoke:livekit:browser --workspace @anecites/server`
    - [x] Re-ran final verification after browser smoke: `npm run test --workspace @anecites/server` (`28` tests, `28` passed, `0` failed), `npm run verify:docker`, `npm audit --audit-level=moderate` (`0` vulnerabilities), `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run lint`, `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run typecheck`, `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run build`, `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run verify`, `$env:PATH = "C:\Users\sansk\.cargo\bin;$env:PATH"; npm run test` (`97` Node tests and `4` Rust tests, all passed), and `git diff --check`.
    - [x] `npm install --package-lock-only`
    - [x] `npm audit --audit-level=moderate` (`0` vulnerabilities)
- [~] Module 3: server-side media inference, native helper v1, lag-loop detection, composite risk engine, reviewer dashboard.
  - [x] T-MON-01: Add shared composite risk summary foundation.
    - Test first:
      - [x] Add shared tests proving risk signals are grouped by category and never produce auto-fail decisions.
      - [x] Add shared tests proving one signal category does not satisfy the correlation policy.
      - [x] Add shared tests proving invalid signal types and weights fail closed.
    - Done when:
      - [x] Shared code can normalize a list of weighted risk signals into an explainable category breakdown.
      - [x] The summary requires human review and keeps auto-fail disabled.
      - [x] The summary exposes whether the configured minimum correlation policy is met.
    - Verification log:
      - [x] `npm run test --workspace @anecites/shared` failed as expected before implementation because `buildCompositeRiskSummary` was not exported.
      - [x] Added `buildCompositeRiskSummary` in shared risk code.
      - [x] `npm run test --workspace @anecites/shared` (`18` tests, `18` passed, `0` failed)
      - [x] Final verification after T-MON-01: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`100` Node tests and `4` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-02: Add backend-only risk summary persistence service.
    - Test first:
      - [x] Add server tests that persist a composite risk summary into Prisma.
      - [x] Add server tests that missing sessions and invalid summary input fail closed.
    - Done when:
      - [x] Risk summary persistence is available as an internal backend service, not a public client route.
      - [x] Persisted summaries use the shared composite risk summary output.
      - [x] Persisted summaries keep `humanReviewRequired=true` and `reviewStatus=PENDING_REVIEW`.
    - Verification log:
      - [x] `npm run test --workspace @anecites/server` failed as expected before implementation because `createRiskSummary` was not exported.
      - [x] Added `createRiskSummary` in `apps/server/src/risk-summaries.ts`.
      - [x] `npm run test --workspace @anecites/server` (`30` tests, `30` passed, `0` failed)
      - [x] Final verification after T-MON-02: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`102` Node tests and `4` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-03: Add shared lag-loop timing detector.
    - Test first:
      - [x] Add shared tests that sustained event-loop lag emits `risk.timing.lag_loop`.
      - [x] Add shared tests that isolated delay spikes do not emit a signal.
      - [x] Add shared tests that invalid timing samples fail closed.
    - Done when:
      - [x] Lag-loop detection emits a standard `RiskSignalInput`.
      - [x] The detector records threshold, consecutive sample count, and max lag in metadata.
      - [x] The detector does not treat one-off lag spikes as sustained suspicious timing.
    - Verification log:
      - [x] `npm run test --workspace @anecites/shared` failed as expected before implementation because `detectLagLoopRiskSignal` was not exported.
      - [x] Added `detectLagLoopRiskSignal` in shared risk code.
      - [x] `npm run test --workspace @anecites/shared` (`21` tests, `21` passed, `0` failed)
      - [x] Final verification after T-MON-03: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`105` Node tests and `4` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-04: Map native helper reports to risk signals.
    - Test first:
      - [x] Add shared tests that capture-affinity and virtualization reports emit native risk signals.
      - [x] Add shared tests that clean native reports emit no signal.
      - [x] Add shared tests that invalid native reports fail closed.
    - Done when:
      - [x] Capture-affinity reports with `protectedFromCapture=true` map to `risk.native.capture_affinity`.
      - [x] Virtualization reports with detected signals map to `risk.native.vm_signal`.
      - [x] Native report mapping produces standard `RiskSignalInput` records.
    - Verification log:
      - [x] `npm run test --workspace @anecites/shared` failed as expected before implementation because `createNativeRiskSignals` was not exported.
      - [x] Added `createNativeRiskSignals` in shared risk code.
      - [x] `npm run test --workspace @anecites/shared` (`24` tests, `24` passed, `0` failed)
      - [x] Final verification after T-MON-04: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`108` Node tests and `4` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-05: Replace native helper placeholders with Windows user-mode scans.
    - Test first:
      - [x] Add Rust tests that process scanning reports the current Windows test process.
      - [x] Add Rust tests that window scanning returns bounded real window records.
      - [x] Add Rust tests that capture-affinity rejects invalid window handles.
      - [x] Add Rust tests that virtualization detection emits a CPUID hypervisor signal.
    - Done when:
      - [x] Process scanning uses a real Windows ToolHelp snapshot and enforces the existing scan limit.
      - [x] Window scanning uses Windows top-level window enumeration and enforces the existing scan limit.
      - [x] Capture-affinity validates HWND input and reports Windows display-affinity protection when queryable.
      - [x] Virtualization detection reports the CPUID hypervisor-present signal without requiring kernel access.
      - [x] Tauri command serialization uses camelCase native report fields that match the shared TypeScript risk mapper.
    - Verification log:
      - [x] `npm run test:rust --workspace @anecites/desktop` failed as expected before implementation: process/window scans were empty, invalid HWND was accepted, and CPUID signal was missing.
      - [x] Added direct `windows-sys@0.61.2` usage for the required Win32 APIs already present in the Tauri dependency graph.
      - [x] `npm run test:rust --workspace @anecites/desktop` (`8` Rust tests, `8` passed, `0` failed)
      - [x] `npm run test --workspace @anecites/desktop` (`10` Node tests and `8` Rust tests, all passed)
      - [x] Final verification after T-MON-05: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`108` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-06: Add desktop native monitoring snapshot flow.
    - Test first:
      - [x] Add desktop tests that collect capabilities, process scan, window scan, capture-affinity reports, and virtualization reports into one timestamped native risk report.
      - [x] Add desktop tests that unavailable native capabilities fail closed.
      - [x] Add desktop tests that invalid native scan limits fail closed before invoking Tauri commands.
      - [x] Add desktop render coverage for the native-monitor panel.
    - Done when:
      - [x] The desktop TypeScript layer exposes a testable native monitoring collector with injected Tauri `invoke`.
      - [x] The collector returns the shared `NativeRiskSignalReport` shape expected by `createNativeRiskSignals`.
      - [x] The desktop shell exposes a native-check control and compact scan counts.
      - [x] Native reports are collected on the candidate client but are not sent to Piston, Judge0, or any client-side code execution path.
    - Verification log:
      - [x] `npm run test --workspace @anecites/desktop` failed as expected before implementation because `dist/native.js` did not exist.
      - [x] After collector implementation, `npm run test --workspace @anecites/desktop` passed collector coverage.
      - [x] `npm run test --workspace @anecites/desktop` failed as expected before UI wiring because `Native monitor` was not rendered.
      - [x] Added `apps/desktop/src/native.ts`, wired the native monitor panel into `App.tsx`, and added a direct desktop dependency on `@anecites/shared`.
      - [x] `npm run test --workspace @anecites/desktop` (`13` Node tests and `8` Rust tests, all passed)
  - [x] T-MON-07: Persist desktop native monitoring reports through the backend.
    - Test first:
      - [x] Add server route tests that a suspicious native report creates a pending-review risk summary.
      - [x] Add server route tests that a clean native report returns no risk summary.
      - [x] Add desktop tests that native report submission posts only to the Anecites backend.
      - [x] Add desktop tests that clean-report backend responses are handled.
    - Done when:
      - [x] `POST /sessions/:sessionId/native-risk-report` requires authentication through the existing session route boundary.
      - [x] The route verifies the participant is active in the target session.
      - [x] The route maps `NativeRiskSignalReport` through `createNativeRiskSignals`.
      - [x] Native risk summaries are persisted with the existing human-review-only summary service.
      - [x] Clean native reports are acknowledged without creating empty risk summaries.
      - [x] The desktop submits native reports to the backend after local collection and does not contact any code-execution provider.
    - Verification log:
      - [x] `npm run test --workspace @anecites/server` failed as expected before implementation with HTTP 404 for `/sessions/:sessionId/native-risk-report`.
      - [x] Added native report ingestion to `apps/server/src/sessions.ts`.
      - [x] `npm run test --workspace @anecites/server` (`32` tests, `32` passed, `0` failed)
      - [x] `npm run test --workspace @anecites/desktop` failed as expected before client submission implementation because `submitNativeMonitoringSnapshot` was not exported.
      - [x] Added `submitNativeMonitoringSnapshot` and wired the desktop native check to submit to the backend.
      - [x] `npm run test --workspace @anecites/desktop` (`15` Node tests and `8` Rust tests, all passed)
      - [x] Final verification after T-MON-07: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`115` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-08: Add reviewer risk-summary read model.
    - Test first:
      - [x] Add route tests that privileged users can list a session's risk summaries in newest-first order.
      - [x] Add route tests that candidate tokens cannot read reviewer risk summaries.
      - [x] Add service tests for review-status filtering.
    - Done when:
      - [x] `GET /sessions/:sessionId/risk-summaries` returns serialized risk summaries without raw evidence payloads.
      - [x] The route requires an authenticated interviewer, reviewer, or admin role.
      - [x] Optional `reviewStatus` filtering supports the existing review statuses and rejects invalid values.
      - [x] The API preserves the human-review-only policy and does not create automated verdicts.
    - Verification log:
      - [x] `npm run test --workspace @anecites/server` failed as expected before implementation with missing `listRiskSummaries` export and HTTP 404 for `/sessions/:sessionId/risk-summaries`.
      - [x] Added authenticated-principal propagation, `listRiskSummaries`, and privileged route access for session risk summaries.
      - [x] `npm run test --workspace @anecites/server` (`35` tests, `35` passed, `0` failed)
      - [x] Final verification after T-MON-08: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`118` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-09: Add reviewer risk-summary status actions.
    - Test first:
      - [x] Add service tests that review status updates persist reviewer identity and review timestamp.
      - [x] Add route tests that privileged reviewer users can update a session risk summary status.
      - [x] Add route tests that candidate tokens cannot update review status.
    - Done when:
      - [x] `PATCH /sessions/:sessionId/risk-summaries/:riskSummaryId/review` accepts existing review statuses only.
      - [x] Review writes require an authenticated interviewer, reviewer, or admin user that exists in the database.
      - [x] Review writes verify the risk summary belongs to the target session.
      - [x] Review writes only change review metadata and do not alter score or signal breakdown.
    - Verification log:
      - [x] `npm run test --workspace @anecites/server` failed as expected before implementation with missing `updateRiskSummaryReview` export and HTTP 404 for `/sessions/:sessionId/risk-summaries/:riskSummaryId/review`.
      - [x] Added `updateRiskSummaryReview` and `PATCH /sessions/:sessionId/risk-summaries/:riskSummaryId/review`.
      - [x] `npm run test --workspace @anecites/server` (`39` tests, `39` passed, `0` failed)
      - [x] Final verification after T-MON-09: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`122` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-10: Add desktop reviewer queue client and panel.
    - Test first:
      - [x] Add desktop client tests for listing session risk summaries through the backend only.
      - [x] Add desktop client tests for updating review status through the backend only.
      - [x] Add desktop render coverage for the reviewer queue panel.
    - Done when:
      - [x] The desktop exposes a small reviewer client for `GET /sessions/:sessionId/risk-summaries`.
      - [x] The desktop exposes a small reviewer client for `PATCH /sessions/:sessionId/risk-summaries/:riskSummaryId/review`.
      - [x] The desktop shell can refresh risk summaries and submit review actions after joining a session.
      - [x] No raw evidence payloads, provider credentials, or code-execution endpoints are exposed in the reviewer panel.
    - Verification log:
      - [x] `npm run test --workspace @anecites/desktop` failed as expected before implementation because `dist/review.js` did not exist and the reviewer queue panel was missing.
      - [x] Added `apps/desktop/src/review.ts` and wired the reviewer queue panel into `App.tsx`.
      - [x] `npm run test --workspace @anecites/desktop` (`18` Node tests and `8` Rust tests, all passed)
      - [x] Final verification after T-MON-10: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`125` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-11: Persist LiveKit recording outputs as evidence objects.
    - Test first:
      - [x] Add server route tests that starting LiveKit recording creates an `EvidenceObject` with `kind=SESSION_RECORDING`.
      - [x] Add server route tests that the recording response includes the evidence object id and S3 key.
      - [x] Add server route tests that failed egress start does not create an orphan evidence object.
    - Done when:
      - [x] The existing `/sessions/:sessionId/livekit-recording` route persists a recording evidence reference after egress start succeeds.
      - [x] Recording evidence stores bucket, key, content type, and LiveKit egress metadata.
      - [x] Raw media bytes are not stored in Postgres.
      - [x] The persisted evidence object can be used as the input pointer for media-analysis jobs.
    - Verification log:
      - [x] `npm run test --workspace @anecites/server` failed as expected before implementation because recording responses did not include `evidenceObjectId`.
      - [x] Added recording evidence persistence to `POST /sessions/:sessionId/livekit-recording`.
      - [x] `npm run test --workspace @anecites/server` (`40` tests, `40` passed, `0` failed)
      - [x] Final verification after T-MON-11: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`126` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-12: Add shared media risk report taxonomy.
    - Test first:
      - [x] Add shared tests that second-voice reports map to `risk.media.second_voice`.
      - [x] Add shared tests for face-missing, multiple-face, and gaze-offscreen report mapping.
      - [x] Add shared tests that low-confidence or short-duration media observations emit no risk signal.
      - [x] Add shared tests that invalid media report shapes fail closed.
    - Done when:
      - [x] Shared code exposes `MediaRiskSignalReport` and `createMediaRiskSignals`.
      - [x] Media signals include bounded metadata only: confidence, duration, sample window, and adapter version.
      - [x] No raw frames, landmarks, waveforms, transcripts, embeddings, or speaker labels are persisted as risk metadata.
      - [x] Media signals still flow through the existing composite human-review policy.
    - Verification log:
      - [x] `npm run test --workspace @anecites/shared` failed as expected before implementation because `createMediaRiskSignals` was not exported.
      - [x] Added media signal taxonomy and `createMediaRiskSignals` in `packages/shared/src/risk.ts`.
      - [x] `npm run test --workspace @anecites/shared` (`27` tests, `27` passed, `0` failed)
      - [x] Final verification after T-MON-12: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`129` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-13: Add media-analysis configuration and queue contract.
    - Test first:
      - [x] Add config tests for media-analysis enablement, queue name, sample limits, timeout, and confidence thresholds.
      - [x] Add tests that invalid media-analysis limits fail closed.
      - [x] Add tests that media-analysis job payloads contain object ids only, not raw media bytes or credentials.
    - Done when:
      - [x] `ServerConfig` exposes media-analysis settings without requiring the worker to run during normal API development.
      - [x] The media job contract contains `sessionId`, `recordingEvidenceObjectId`, requested analysis modes, and bounded options.
      - [x] RabbitMQ is the planned transport for discrete media-analysis jobs.
      - [x] The frontend has no direct media-worker endpoint.
    - Verification log:
      - [x] `npm run test --workspace @anecites/shared` failed as expected before implementation because `MEDIA_ANALYSIS_MODES` was not exported.
      - [x] `npm run test --workspace @anecites/server` failed as expected before implementation because media-analysis config fields were missing.
      - [x] Added shared media-analysis job contract in `packages/shared/src/media-analysis.ts`.
      - [x] Added media-analysis settings to `ServerConfig` and `.env.example`.
      - [x] `npm run test --workspace @anecites/shared` (`30` tests, `30` passed, `0` failed)
      - [x] `npm run test --workspace @anecites/server` (`41` tests, `41` passed, `0` failed)
      - [x] Final verification after T-MON-13: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`133` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-14: Add `apps/media-worker` skeleton with injected media adapters.
    - Test first:
      - [x] Add worker tests that load recording evidence references from Postgres and reject missing or wrong-kind evidence.
      - [x] Add worker tests that injected audio/video adapters receive bounded sample-window requests.
      - [x] Add worker tests that adapter timeouts and malformed adapter responses fail closed.
    - Done when:
      - [x] `apps/media-worker` is an npm workspace with build, typecheck, lint, and test scripts.
      - [x] The worker can process a media-analysis job using injected adapters without adding heavyweight model dependencies yet.
      - [x] The worker does not run inside the Express API request path.
      - [x] The worker never writes raw extracted media samples to Postgres.
    - Verification log:
      - [x] `npm run test --workspace @anecites/media-worker` failed as expected before implementation because `MediaWorkerError` was not exported.
      - [x] Added `apps/media-worker` with `processMediaAnalysisJob`, injected audio/video adapters, bounded adapter requests, timeout handling, and sanitized media report output.
      - [x] `npm run test --workspace @anecites/media-worker` (`3` tests, `3` passed, `0` failed)
      - [x] Final verification after T-MON-14: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`136` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-15: Add audio VAD and second-voice detection adapter boundary.
    - Test first:
      - [x] Add fixture-based tests for one-speaker audio producing no second-voice signal.
      - [x] Add fixture-based tests for two-speaker audio producing `risk.media.second_voice`.
      - [x] Add tests that short or low-confidence voice segments do not emit signals.
    - Done when:
      - [x] The media worker can convert audio analysis output into `MediaRiskSignalReport`.
      - [x] Detection thresholds are configurable and bounded.
      - [x] Audio-derived summaries link back to the recording evidence object.
      - [x] No real model/runtime dependency was added; licensing and production packaging must still be verified before introducing one.
    - Verification log:
      - [x] `npm run test --workspace @anecites/media-worker` failed as expected before implementation because `createSecondVoiceAudioAdapter` was not exported.
      - [x] Added fixture-driven `createSecondVoiceAudioAdapter` with injected voice-segment analysis, bounded duration/confidence thresholds, and sanitized second-voice observations.
      - [x] `npm run test --workspace @anecites/media-worker` (`7` tests, `7` passed, `0` failed)
      - [x] Final verification after T-MON-15: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`140` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-16: Add video face/multi-face/gaze adapter boundary.
    - Test first:
      - [x] Add fixture-based tests for no-face and multi-face observations.
      - [x] Add calibration-contract tests for gaze/off-screen observations.
      - [x] Add tests that uncalibrated gaze observations cannot emit high-confidence gaze signals.
    - Done when:
      - [x] The media worker can map server-side video analysis output into media risk reports.
      - [x] Face presence and multi-face detection land before gaze enforcement.
      - [x] Gaze analysis requires per-session calibration metadata.
      - [x] No gaze or face geometry is processed on the candidate desktop for core proctoring decisions.
    - Verification log:
      - [x] `npm run test --workspace @anecites/media-worker` failed as expected before implementation because `createVideoAnalysisAdapter` was not exported.
      - [x] `npm run test --workspace @anecites/shared` failed as expected before implementation because uncalibrated gaze emitted `risk.media.gaze_offscreen`.
      - [x] Added fixture-driven `createVideoAnalysisAdapter` with injected video-window analysis, face/multi-face mapping, gaze calibration enforcement, and sanitized output.
      - [x] Updated shared media risk mapping so uncalibrated gaze observations do not emit risk signals.
      - [x] `npm run test --workspace @anecites/media-worker` (`11` tests, `11` passed, `0` failed)
      - [x] `npm run test --workspace @anecites/shared` (`31` tests, `31` passed, `0` failed)
      - [x] Final verification after T-MON-16: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`145` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-17: Persist media-derived risk summaries.
    - Test first:
      - [x] Add worker/service tests that media reports with signals create pending-review risk summaries.
      - [x] Add worker/service tests that clean media reports do not create empty summaries.
      - [x] Add tests that media summaries preserve evidence object links and bounded metadata.
    - Done when:
      - [x] Media-derived risk signals use `createRiskSummary`.
      - [x] Summaries remain human-review-only.
      - [x] Reviewer queue can display media-derived summaries without raw media payloads.
      - [x] A single media signal cannot produce an automated adverse action.
    - Verification log:
      - [x] `npm run test --workspace @anecites/media-worker` failed as expected before implementation because `riskSummary` was not returned or persisted.
      - [x] Reused the existing server `createRiskSummary` service from the media worker and derived summary windows from bounded media sample timestamps.
      - [x] Clean media reports now return `riskSummary: null` and do not persist empty summaries.
      - [x] `npm run test --workspace @anecites/media-worker` (`14` tests, `14` passed, `0` failed)
      - [x] Final verification after T-MON-17: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`148` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-MON-18: Add the first real server-side media-inference runtime.
    - Test first:
      - [x] Add pure contract tests for bounded object references, sample windows, rejected raw media/credential fields, and runtime settings.
      - [x] Add Node client tests for bounded payloads, response sanitization, timeouts, malformed responses, and unavailable gaze.
      - [x] Run a container smoke test against real MediaPipe and Silero models.
    - Implemented:
      - [x] Added `apps/media-inference` with pinned Python dependencies, checksum-verified MediaPipe face model, Silero VAD, bounded FFmpeg extraction, allowlisted object storage, temporary-file cleanup, and authenticated internal HTTP access.
      - [x] Added a strict `createMediaInferenceClient` boundary in `apps/media-worker`.
      - [x] Replaced ambiguous fixture `faceConfidence` input with sampled-frame `conditionSupport`; no-face windows no longer imply a fabricated detector confidence.
      - [x] Kept VAD output separate from second-speaker evidence and kept gaze unavailable without calibration.
      - [x] Added a private-network-only, resource-bounded, no-outbound-network `media-inference` Compose profile with no host port.
    - Done when:
      - [x] The real-model smoke test passes against MinIO using generated silent video.
      - [x] Focused and repository-wide verification pass.
      - [x] The verification log records actual test counts and remaining diarization/gaze limitations.
    - Verification log:
      - [x] `npm run test --workspace @anecites/media-inference` (`6` tests, `6` passed, `0` failed)
      - [x] `npm run test --workspace @anecites/media-worker` (`17` tests, `17` passed, `0` failed)
      - [x] `npm run smoke --workspace @anecites/media-inference` completed a real MinIO download, Silero VAD pass, and MediaPipe face-detection pass.
      - [x] Docker inspection confirmed no host port, no outbound network, read-only root filesystem, all capabilities dropped, a 2 GiB memory limit, 2 CPU limit, 256 process limit, and no leftover temporary media.
      - [x] Final verification after T-MON-18: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`203` JavaScript/Python tests and `10` Rust tests, `213` total, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
      - [x] Remaining limitation: VAD is not speaker diarization, so real second-speaker risk remains disabled; real gaze risk also remains disabled until calibrated and evaluated.
  - [x] T-MON-19: Containerize the RabbitMQ media-worker consumer and wire it to the private inference runtime.
    - Test first:
      - [x] Add queue-consumer contract tests for acknowledgement, retry, dead-letter behavior, idempotency, and graceful shutdown before implementing the long-running worker.
      - [x] Add worker configuration tests for required URLs/secrets and bounded prefetch, retry, delay, and lease settings.
      - [x] Add a durable-redelivery test proving successful jobs do not repeat inference or create duplicate summaries.
    - Implemented:
      - [x] Added manual acknowledgement, confirm-published delayed retries, a sanitized dead-letter queue, bounded payload parsing, and graceful consumer cancellation.
      - [x] Added `MediaAnalysisJobRun` with canonical payload hashes, lease versions, stale-lease recovery, and transactionally linked risk-summary completion.
      - [x] Added a non-root, read-only, portless `media-worker` container with separate internal control and inference networks, no MinIO credentials, and bounded CPU, memory, and process limits.
      - [x] Wired the real face-presence inference client while leaving second-voice and gaze unavailable until diarization and calibrated gaze runtimes exist.
      - [x] Added a real RabbitMQ smoke test that uploads generated video, executes MediaPipe inference, persists one summary, redelivers the same job, and verifies idempotency.
    - Verification log:
      - [x] Shared and database acceptance tests failed before implementation because `jobId` and `MediaAnalysisJobRun` were absent.
      - [x] Consumer tests failed before implementation because the queue consumer exports were absent.
      - [x] `npm run test --workspace @anecites/media-worker` (`25` tests, `25` passed, `0` failed).
      - [x] `npm run smoke:consumer --workspace @anecites/media-worker` passed with real RabbitMQ, PostgreSQL, MinIO, MediaPipe inference, and idempotent redelivery.
      - [x] Fixed cross-recording MediaPipe timestamp state by using stateless image-mode detection for independently sampled frames; the inference smoke now completes two consecutive real analyses in one container lifetime.
      - [x] Docker inspection confirmed non-root execution, no host port, read-only root filesystem, all capabilities dropped, no-new-privileges, 512 MiB memory, 1 CPU, 128 process limit, blocked outbound internet, and no MinIO network path.
      - [x] A real Compose stop produced `media_worker.stopped` after graceful consumer cancellation.
      - [x] Final verification after T-MON-19: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`212` JavaScript/Python tests and `10` Rust tests, `222` total, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), both real inference smoke tests, and `git diff --check`.
  - [x] T-MON-20: Publish media-analysis jobs automatically after recording evidence is ready.
    - Test first:
      - [x] Add tests that recording completion persists one `EvidenceObject` and confirm-publishes one bounded `MediaAnalysisJob` with a unique `jobId`, without raw media or credentials.
    - Implemented:
      - [x] Added a lazy RabbitMQ confirm publisher with a durable queue, persistent messages, deterministic message IDs, bounded contract validation, and graceful shutdown.
      - [x] Publish only after LiveKit reports `EGRESS_COMPLETE`; failed or incomplete recordings fail closed and do not enqueue analysis.
      - [x] Publish the existing recording evidence reference and bounded face-presence request only. Raw media, object-store credentials, and unavailable diarization or gaze requests are not included.
      - [x] Map publication failures to the generic `MEDIA_ANALYSIS_UPSTREAM_ERROR` response without logging queue payloads or secrets.
    - Verification log:
      - [x] Focused server media-analysis and session tests (`18` tests, `18` passed, `0` failed).
      - [x] Final full verification: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, and `npm run test` (`216` JavaScript/Python tests and `10` Rust tests, `226` total, all passed); `npm audit --audit-level=moderate` reported `0` vulnerabilities and `git diff --check` passed.
    - Webhook completion:
      - [x] Add an authenticated LiveKit `egress_ended` webhook path for recordings that finish outside the application stop-recording request.
        - [x] Verify the exact raw request body, signed `Authorization` token, and payload hash with `livekit-server-sdk` before processing the event.
        - [x] Acknowledge irrelevant, failed, and aborted egress events without publishing; return a retryable failure while recording evidence is not ready.
        - [x] Reuse the deterministic media-analysis job contract across webhook and stop-route delivery so durable worker idempotency prevents repeated inference.
        - [x] Red test: all `3` initial webhook tests failed with `404` before the route existed.
        - [x] `npm run test --workspace @anecites/server` (`54` tests, `54` passed, `0` failed).
        - [x] Final verification after the webhook: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, and `npm run test` (`220` JavaScript/Python tests and `10` Rust tests, `230` total, all passed); `npm audit --audit-level=moderate` reported `0` vulnerabilities and `git diff --check` passed.
- [x] Candidate focus monitoring and shared editor workspace controls.
  - [x] Emit bounded `risk.client.focus_lost` events from the consented Tauri candidate application after a window blur or hidden-document interval of at least one second.
  - [x] Validate and sanitize focus-loss events in the backend; do not persist window titles, application names, or other raw desktop content.
  - [x] Add shared editor tabs with an accessible plus control, keyboard tab navigation, a ten-document limit, and per-document collaboration isolation.
  - [x] Make the interviewer code-editor control toggle the shared editor open and closed for both participants.
  - [x] A real two-client browser check verified host/candidate join, shared editor opening, tab synchronization, candidate-to-interviewer code synchronization, and shared editor closing with no browser console warnings or errors.
  - [x] Final verification included in the T-MON-20 verification log above.
- [x] Hardening and launch-readiness gates.
  - [x] T-HARD-01: Add data-retention configuration and policy.
    - Test first:
      - [x] Add config tests for evidence, recording, replay, telemetry, and risk-summary retention windows.
      - [x] Add tests that invalid retention windows fail closed.
    - Done when:
      - [x] Retention defaults are explicit and configurable.
      - [x] `.env.example` documents the policy knobs without secrets.
      - [x] The plan distinguishes policy/config from physical deletion jobs that still need implementation.
    - Verification log:
      - [x] `npm run test --workspace @anecites/server` failed as expected before implementation because retention config fields were missing.
      - [x] Added retention config fields for evidence, recordings, replay evidence, telemetry, and risk summaries.
      - [x] Documented retention policy knobs in `.env.example` and `docs/implementation_plan.md`.
      - [x] Physical expiry/deletion jobs remain future work and are not claimed as implemented.
      - [x] `npm run test --workspace @anecites/server` (`42` tests, `42` passed, `0` failed)
      - [x] Final verification after T-HARD-01: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`149` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.
  - [x] T-HARD-02: Add legal/privacy/adverse-action review gate.
    - Done when:
      - [x] The docs clearly state legal counsel must approve recording consent, biometric/media inference, retention, candidate notice, and adverse-action workflows before pilot deployment.
      - [x] The app does not claim legal compliance from engineering checks alone.
    - Verification log:
      - [x] Added a legal/privacy release gate to `docs/PRD.md`.
      - [x] Added a legal/privacy/adverse-action gate to `docs/implementation_plan.md`.
      - [x] Explicitly documented that engineering checks do not establish legal compliance.
      - [x] Verification: `rg` confirmed the required gate language, `npm run verify`, and `git diff --check`.
  - [x] T-HARD-03: Add accessibility review gate.
    - Done when:
      - [x] The docs identify keyboard, screen-reader, focus, contrast, captions, and reduced-motion checks required before pilot deployment.
      - [x] The desktop UI has no known blocker documented as resolved without verification.
    - Verification log:
      - [x] Added accessibility release gates to `docs/PRD.md`, `docs/implementation_plan.md`, and `docs/ARCHITECTURE.md`.
      - [x] Documented that accessibility blockers cannot be marked resolved until verified against the built UI.
      - [x] Verification: `rg` confirmed keyboard, screen-reader, focus, contrast, captions, and reduced-motion gate language.
  - [x] T-HARD-04: Add sandbox/security review gate.
    - Done when:
      - [x] The docs separate local-development Piston from production trust boundaries.
      - [x] The docs cover outbound-network blocking, resource limits, container privilege, object-storage access, and code/media-worker isolation.
    - Verification log:
      - [x] Added sandbox/security release gates to `docs/PRD.md`, `docs/implementation_plan.md`, and `docs/ARCHITECTURE.md`.
      - [x] Documented that local privileged Piston is development-only and not a production trust boundary.
      - [x] Documented required review for outbound networking, limits, privilege, object-storage access, and code/media-worker isolation.
      - [x] Verification: `rg` confirmed sandbox, outbound-network, resource-limit, object-storage, and worker-isolation gate language.
  - [x] T-HARD-05: Add signature and update-process review gate.
    - Done when:
      - [x] The docs define required signing, release provenance, update channel, rollback, and signature refresh checks before distributing the desktop app.
      - [x] No unsigned update path is treated as production-ready.
    - Verification log:
      - [x] Added signing/update-process release gates to `docs/PRD.md`, `docs/implementation_plan.md`, and `docs/ARCHITECTURE.md`.
      - [x] Documented that unsigned or unauthenticated update paths are not production-ready.
      - [x] Verification: `rg` confirmed signing, provenance, update-channel, rollback, and unsigned-update gate language.
      - [x] Final verification after T-HARD-03 through T-HARD-05: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run test` (`149` Node tests and `8` Rust tests, all passed), `npm audit --audit-level=moderate` (`0` vulnerabilities), and `git diff --check`.

## Post-Hardening Monitoring Work

### T-MON-25a - Calibrated-gaze evidence lineage

- [x] Bind each newly created calibration to exactly one active, candidate-track `SessionRecording`.
- [x] Require explicit gaze-calibration consent before a calibration can start or advance.
- [x] Abandon an active calibration if its source recording ends or changes; require a fresh calibration for the replacement recording.
- [x] Keep calibration records to bounded target order and acknowledgement timestamps only. Do not store client landmarks, camera frames, or a gaze verdict in Postgres.
- [x] Keep gaze inference and `risk.media.gaze_offscreen` unavailable until a calibrated server-side runtime and representative shadow-mode evaluation fixtures exist.
- Verification:
  - [x] Applied `20260719113000_gaze_calibration_recording_lineage` to the local database.
  - [x] `npm run build --workspace @anecites/server`
  - [x] `node --test --test-isolation=none test/sessions.test.mjs` in `apps/server` (`21` tests, `21` passed)
  - [x] `npm run test --workspace @anecites/server` (`67` tests, `67` passed)
  - [x] `npm run test --workspace @anecites/shared` (`45` tests, `45` passed)
  - [x] `node --test test/schema.test.mjs` in `packages/db` (`11` tests, `11` passed)
  - [x] `prisma migrate status` confirms the database schema is current.
