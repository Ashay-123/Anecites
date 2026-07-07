# Architecture — AI-Proctored Interview Platform

## 1. High-level shape

Three independently buildable/testable modules feeding a shared risk engine:

```
[Candidate Browser] <--WebRTC media--> [LiveKit SFU] <--WebRTC media--> [Interviewer Browser]
        |                                     |
        | WebSocket (signaling + Yjs ops)     | Egress (recording + sampled frames/audio)
        v                                     v
[Signaling/App Server] <---> [Yjs Collab Server] <---> [Judge0 Execution Sandbox]
        |
        v
[Native Helper (candidate machine, user-mode)] --events--> [Event Bus: Kafka/RabbitMQ]
        |                                                        |
        v                                                        v
[CV/Audio Pipeline: MediaPipe, VAD, pyannote] -------------> [Composite Risk Engine]
                                                                   |
                                                                   v
                                                        [Reviewer Dashboard + Evidence Timeline]
```

Data plane underneath all of this: Postgres (sessions/candidates/scores), Redis (presence/pub-sub), S3 (recordings/evidence).

## 2. Module 1 — Code Editor: data flow

1. Monaco's buffer is wrapped in a Yjs document.
2. Every keystroke → CRDT operation → broadcast over WebSocket to the collab server → rebroadcast to all connected clients. Interviewer sees typing live, no polling.
3. Yjs's awareness protocol carries ephemeral state (cursor, selection, "who's typing") separately from the persisted document — cheap, don't skip it.
4. **A second, parallel event log runs alongside the CRDT ops**: every insert/delete gets a timestamp, character count, and origin (keystroke vs. programmatic). This is the raw material for paste-pattern and typing-cadence detection — build it now, it's expensive to retrofit later.
5. "Run code" → buffer + stdin → Judge0 API → queued execution in an isolated, hardened container (gVisor/Firecracker wrapped, non-privileged) → stdout/stderr/time/memory returned to both parties.

## 3. Module 2 — Video Call: WebRTC signaling and data flow

1. Both browsers open a WebSocket to the signaling/app server.
2. Standard SDP offer/answer exchange happens over that WebSocket — this is the part WebRTC itself doesn't standardize, it's just JSON relayed by you.
3. ICE candidates exchanged the same way as discovered (host, server-reflexive via STUN, relay via TURN/coturn).
4. Once negotiated, media does **not** go through your app server — it flows to the LiveKit SFU, which forwards each participant's stream to the other(s). SFU (not mesh, not MCU) is correct here: scales better than mesh, preserves per-stream quality better than an MCU that re-encodes into one composite.
5. LiveKit Egress records the session and simultaneously samples frames/audio into the AI pipeline — without adding load to the live call path.

## 4. Module 3 — AI Monitoring: signal pipeline

### What the browser can do alone (no install) — and its hard limit
- Fullscreen API enforcement + `visibilitychange`/`blur` listeners (tab-switch/window-leave detection)
- Clipboard API interception (deterrable, not airtight — OS-level input simulation bypasses a JS listener entirely)
- `getDisplayMedia` self-check to confirm correct screen/window is shared
- **Hard architectural limit**: a browser cannot enumerate other processes, inspect other windows, or detect a VM at the hypervisor level. That isolation is the entire point of a browser sandbox — not something to code around from JS. This is exactly why second-device cheating is untouched by browser lockdown alone.

### The overlay problem, specifically
Two distinct techniques exist under "invisible overlay" — they need different answers:

1. **Capture-exclusion flag** (older, weaker): `SetWindowDisplayAffinity`/`WDA_EXCLUDEFROMCAPTURE` on Windows, or the equivalent ScreenCaptureKit sharing-state flag on macOS. A native helper *can* detect this — it enumerates other windows and checks their capture-affinity/sharing-state flags directly.

2. **GPU-level rendering hook** (what Cluely/Interview Coder actually use): hooks directly into DirectX/Metal and draws below the layer Zoom/Meet/Teams ever read from. **No amount of video-stream analysis will ever see this overlay** — the pixels never enter the captured frame. This is not a detection-accuracy problem to improve with a better model; it's architecturally invisible to screen-share analysis, full stop.

Because of (2), the reliable answer has to come from the OS layer via the native helper, not from video analysis:
- Maintain a continuously-updated signature list of known tool process names/binary hashes (same operating model as antivirus definitions)
- Don't rely on the list alone — tools rename processes to dodge this. Pair with generic heuristic detection: flag any process using capture-exclusion or overlay-hook APIs in an unusual pattern for an interview session, regardless of name
- **Lag-loop detection** is your strongest lever against this specific threat, and it's immune to the GPU-hook problem entirely by design: tools that pipe interviewer audio through transcription → LLM → back to candidate have an unavoidable processing pipeline producing a consistent 3–5s response delay, regardless of question difficulty
- Secondary devices remain the honest hard limit — no software on the monitored machine rules this out completely. Partial mitigation: 360° room pan before session start, dual-camera requirement for high-stakes tiers. Treat as probabilistic deterrent, not solved.

### VM detection
Hypervisor-present CPUID bit, known hypervisor-vendor MAC OUI ranges, registry/sysfs artifacts, timing-based side channels. One signal among several — VM fingerprinting is its own slow-moving arms race, don't treat it as a single point of failure.

### Kernel-mode vs. user-mode — decision: user-mode
Kernel drivers (Vanguard/EAC/BattlEye-style) give more visibility but at real cost: the July 2024 CrowdStrike incident is the industry's cautionary tale for kernel residency, and even Riot is shifting Vanguard toward user-mode-plus-AI. For a one-time, per-interview install, the trust cost of Ring-0 access is hard to justify, it expands your own attack surface, and GDPR's "strictly necessary" bar for invasive cross-process scanning is a genuinely hard legal case to make without very explicit consent. A well-built user-mode agent (window/process enumeration, capture-affinity checks, hypervisor fingerprinting) captures the large majority of the detection value without that liability. Disclosed and consented, always — model the consent dialog on Safe Exam Browser's.

### AI visual monitoring
MediaPipe Face Landmarker: 478 3D landmarks, real-time, single RGB camera. Iris landmarks show where eyes *are*, not where the person is *looking* — true gaze needs a per-session calibration step (candidate looks at known on-screen points) feeding a small regression layer on top. Build this into session onboarding, not as an afterthought. Multi-face detection reuses the same face-detection stage.

### AI audio monitoring
VAD (Silero or WebRTC VAD) + diarization (pyannote.audio) → "is there a second voice in this room" as a real-time signal.

### Composite risk engine
Every credible product in this space treats detection as a probability score across many weak signals, not a single trigger. Build a timestamped, evidence-linked risk timeline per session. Require human review before any adverse action. Never auto-fail on one signal — proctoring tools have a documented history of disproportionately misflagging darker-skinned candidates in webcam-based monitoring; at least one university dropped webcam monitoring entirely over this while keeping browser lockdown. Design the appeals/human-review path now.

## 5. Build order (test-gated, matches PRD section 4-6)

1. **MVP**: LiveKit video + Monaco/Yjs editor + Judge0 (hardened), browser-side lockdown, lag-loop timing + paste-pattern detection. Catches a meaningful share of cheating with zero native install. → test gate, then proceed.
2. **Native helper v1**: user-mode agent, process/window signature detection + capture-affinity checks, VM fingerprinting. → test gate, then proceed.
3. **AI layer**: face/gaze + multi-face via MediaPipe, audio VAD/diarization, composite risk engine + reviewer dashboard. → test gate, then proceed.
4. **Hardening loop, ongoing**: signature-list maintenance (new cheat tools appear constantly), Judge0 sandbox hardening review, legal/accessibility review, appeals workflow refinement.

Do not skip a test gate to start the next module early — each module's test gate specifically validates the assumption the next module is built on (e.g., the risk engine in step 3 is only meaningful if the event log from step 1 and the native helper signals from step 2 are already reliable).

## 6. Reference implementations worth studying directly (not necessarily reusing wholesale)
- **Safe Exam Browser** (OSS, MPL, ETH Zurich) — lockdown browser architecture + consent-dialog pattern
- **Vysper** (public OSS overlay clone) — study its evasion techniques to build detection signatures against, the same way security teams study public malware for defense
