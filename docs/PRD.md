# PRD — AI-Proctored Technical Interview Platform

## 1. Problem & Goal

Remote technical interviews are being gamed by invisible AI-assist overlays (Cluely, Interview Coder), secondary devices, and proxy test-takers. Goal: build a platform that raises the cost and catch-rate of cheating as high as realistically possible, with an evidence trail for human review — not a claim of 100% prevention. No single signal is trusted; every flag is one input into a composite, human-reviewed risk score.

**Explicitly out of scope for v1:** kernel-level monitoring, guaranteed deepfake detection, guaranteed secondary-device detection. These are named as unsolved/partial in the architecture doc — don't let scope creep in trying to "fully solve" them.

## 2. Users

- **Candidate**: joins interview, writes code, is on camera/mic. Must explicitly consent before any native agent install or biometric processing.
- **Interviewer**: joins call, watches candidate code live, sees risk signals surfaced (not raw verdicts) during/after the session.
- **Reviewer/Admin**: reviews flagged sessions, evidence timeline, makes the adverse-action call. This role is mandatory — no auto-fail.

## 3. System = 3 buildable modules + shared infra

Build and test these independently, in this order, each gated by its own test pass before the next starts:

1. **Code Editor Module** — Monaco + Yjs + keystroke logging + copy/paste blocking + Judge0 execution
2. **Video Call Module** — LiveKit-based call, Zoom/Meet-simple UX, low latency, non-distracting
3. **AI Monitoring Module** — face/gaze/multi-face CV, audio VAD/diarization, native anti-overlay helper, risk engine

Shared infra: auth, session/data plane (Postgres/Redis/S3), event bus (Kafka/RabbitMQ), signaling/WebSocket layer.

---

## 4. Module 1 — Code Editor

### Functional requirements
- Real-time collaborative editor (interviewer sees candidate typing live, no polling/refresh lag)
- Copy-paste **blocked** in the candidate's editor pane (clipboard events intercepted)
- Every keystroke logged as a discrete event: timestamp, char delta, insert/delete, origin
- "Run code" executes candidate's buffer server-side in an isolated sandbox, returns stdout/stderr/time/memory to both parties
- Flag any single edit event inserting more than N characters at once, regardless of whether a paste event fired (catches OS-level input injection that bypasses the JS listener)

### Non-functional
- Sub-200ms perceived latency on collab sync
- Sandbox execution isolated from host (candidate code must never be able to touch the underlying VM/container host)
- Full keystroke log must be replayable for review (this is your plagiarism/typing-cadence evidence trail)

### Test gate before moving to Module 2
- Two browser sessions collaboratively edit same doc with no conflicts/drops
- Paste blocked via UI *and* via simulated OS-level paste (xdotool/AutoHotkey-style injection) — confirm the edit-log still flags it even when the DOM paste event doesn't fire
- Judge0 sandbox: confirm a malicious submission (fork bomb, filesystem write attempt, network call) is contained and doesn't affect host or other sessions
- Load test: 50 concurrent sessions, confirm no cross-session bleed in the Yjs rooms

---

## 5. Module 2 — Video Call

### Functional requirements
- 1:1 (extendable to small group) video + audio call
- Screen share from candidate side
- Simple UX: join link, mute/camera toggle, screen-share toggle — nothing more. No Zoom-style feature bloat.
- Session recording (video + audio + screen) for the evidence trail

### Non-functional
- Low latency, no perceptible lag in normal conversation
- Should not distract from the interview (minimal chrome, no forced backgrounds/filters/reactions)
- Must degrade gracefully on poor connections (audio-first fallback)

### Test gate before moving to Module 3
- Two-party call over real-world network conditions (throttled bandwidth, packet loss simulation) — confirm audio holds priority over video
- Screen share verified end-to-end: confirm `getDisplayMedia` self-check catches a candidate sharing the wrong window
- Recording pipeline: confirm egress produces a complete, replayable recording with no dropped segments
- Confirm signaling reconnects cleanly after a network blip without restarting the whole call

---

## 6. Module 3 — AI Monitoring

### Functional requirements
- **Face/gaze**: detect face presence, multiple faces, and gaze direction (off-screen looking) after a per-session calibration step
- **Audio**: voice activity detection + diarization to flag a second distinct voice in the room
- **Native helper (user-mode, not kernel)**: process/window enumeration for known cheat-tool signatures + generic capture-affinity/overlay-hook heuristics; VM/hypervisor fingerprinting
- **Lag-loop detection**: measure response latency after interviewer questions; flag consistent 3–5s delay patterns regardless of question difficulty
- **Composite risk engine**: combine all signals (editor + video + audio + native) into a timestamped, evidence-linked risk timeline. No signal alone triggers an action.
- **Consent flow**: explicit dialog before native agent installs and before any biometric/gaze processing starts (model this on Safe Exam Browser's consent screen)

### Non-functional
- Every flag must be explainable (which signal, what timestamp, what evidence clip) — no black-box scores
- False-positive awareness: known bias risk in webcam-based flagging against darker-skinned candidates — build the human-review gate and appeals path as a first-class feature, not an afterthought

### Test gate before considering the platform release-ready
- Gaze calibration: confirm accuracy against a known set of test points before trusting "looking off-screen" flags
- Native helper: confirm it detects a real invisible-overlay tool in a controlled test (process signature) AND confirm it does NOT false-flag common legitimate background apps
- Diarization: confirm second-voice detection works with real overlapping speech samples, not just clean single-speaker audio
- Full pipeline: run one end-to-end mock interview with a planted cheat attempt (paste injection + second voice + simulated overlay process) and confirm all three surface in the same risk timeline with correct timestamps

---

## 7. Compliance flags (not legal advice — get counsel)
- Explicit consent before native agent install and biometric processing
- Biometric data laws vary by jurisdiction (BIPA, GDPR Art. 9) — gaze/face-geometry likely counts as biometric data
- Defined data retention/deletion window for recordings
- Documented human-review + appeals process
- Accessibility path for candidates with conditions affecting gaze/eye contact/camera framing

### Required legal/privacy release gate

Anecites is not pilot-ready until qualified legal/privacy counsel approves the deployed workflow for every launch jurisdiction. Engineering tests only verify implementation behavior; they do not establish legal compliance.

Counsel approval is required for:
- candidate notice and affirmative consent copy before recording, native monitoring, and biometric/media inference
- recording, replay, telemetry, risk-summary, and evidence retention/deletion windows
- biometric and sensitive-data processing for face, gaze, voice, diarization, and native-monitoring signals
- reviewer access controls, audit trail expectations, and candidate appeal/dispute process
- adverse-action workflow language, including the rule that risk summaries are evidence for human review and are not automated employment or interview decisions

No release note, UI copy, or reviewer workflow may claim that Anecites is legally compliant, bias-free, or determinative based only on engineering verification.

## 8. Success metrics
- % of known cheating patterns caught in controlled red-team tests (per module, tracked separately)
- False-positive rate on legitimate candidates (target: near-zero auto-actions, human review handles all flags)
- p95 latency for video call and editor sync
- Time-to-signature for new cheat tools added to the native helper's detection list

## 9. Release-readiness gates

These gates are required before any pilot or production distribution. They are not replaced by ordinary unit tests.

### Accessibility review gate

Anecites is not pilot-ready until the candidate, interviewer, and reviewer flows complete an accessibility review covering:
- keyboard-only navigation for join, editor, code execution, media controls, reviewer queue, and review actions
- screen-reader names, roles, state announcements, and error messages for all interactive controls
- visible focus order and focus trapping in dialogs
- WCAG contrast checks for text, controls, risk states, charts, and disabled states
- captions or transcript accommodation for interview audio where required
- reduced-motion behavior for any animated status, loading, or risk-review UI
- accommodations for candidates whose disability, camera setup, eye contact, speech, or movement patterns may affect gaze, face, audio, or native-monitoring signals

No accessibility blocker may be documented as resolved until it has been verified against the built UI.

### Sandbox/security review gate

Local Piston is a development convenience, not a production trust boundary. Production candidate code execution is not release-ready until a security review approves:
- outbound-network blocking from code-execution containers
- CPU, memory, process, file, wall-time, and output limits
- container privilege and seccomp/AppArmor/gVisor/Firecracker or equivalent isolation
- network isolation from Postgres, Redis, RabbitMQ, MinIO/S3, LiveKit, and internal APIs
- object-storage credentials remaining backend-only
- media-worker isolation from candidate code execution and from direct client access
- evidence that code execution, media analysis, and reviewer APIs cannot share secrets or internal service reachability

The media worker is also not production-ready until model runtimes are packaged locally and reviewed for outbound-network behavior, CPU/memory limits, license terms, and object-storage access.

### Signing and update-process gate

The desktop app must not be distributed as production software until release engineering verifies:
- platform signing for Windows installers and binaries
- release provenance for source commit, build environment, artifact checksums, and dependency lockfiles
- an explicit update channel policy for dev, pilot, and production
- signed update manifests or an equivalent authenticated update mechanism before enabling automatic updates
- rollback procedure for bad releases and compromised signing material
- signature/key rotation and expiration monitoring
- a manual install path that is clearly labeled non-production if signing or authenticated updates are absent

No unsigned or unauthenticated update path is production-ready.
