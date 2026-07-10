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

- [~] Add Monaco editor wrapper.
  - Current implementation exports a stable React `MonacoCollabEditor` host component.
  - Direct `monaco-editor@0.55.1` was not added because it introduced a `dompurify` audit finding; real Monaco mounting remains pending until a safe version is selected.
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
- [ ] Disable Monaco paste commands where possible.
  - Pending until the package has a real Monaco editor mount; the current host blocks DOM paste events.
- [x] Detect large atomic inserts as suspicious even when paste events are bypassed.
- [~] Log events to the Yjs-derived telemetry path.
  - Current implementation emits shared raw telemetry events through `EditorTelemetryOptions.onEvent`.
  - Server-side persistence transport for client-originated paste-block events remains pending with the desktop/API client integration.
- Test first:
  - [x] Add DOM paste prevention test.
  - [ ] Add Monaco command override test.
  - [x] Add atomic insert detection test.
- Done when:
- [~] Right-click paste, keyboard paste, and simulated atomic inserts are covered by tests.
    - Browser `paste` events, context-menu paste blocking, and simulated atomic inserts are covered.
    - Monaco-specific command override coverage is still pending.

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
- [ ] Hardening: legal review, accessibility review, sandbox review, signature update process, data retention policy.
