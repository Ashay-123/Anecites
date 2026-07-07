# Tech Stack — AI-Proctored Interview Platform

Principle: use proven open-source components wherever they exist; only build custom where the requirement is genuinely novel (native anti-overlay helper, composite risk engine, code-similarity logic).

## Module 1 — Code Editor

| Component | Choice | Notes |
|---|---|---|
| Editor | Monaco Editor | The actual VS Code component, OSS, syntax highlighting/IntelliSense out of the box |
| Real-time sync | Yjs (CRDT) over WebSocket | Conflict-free, includes "awareness" protocol for cursors/presence |
| Keystroke/event log | Custom, parallel to Yjs ops | Timestamp + char delta + insert/delete + origin, feeds behavioral detection |
| Code execution | Judge0 (self-hosted, hardened) | OSS, built for assessment/recruitment use cases; **must not run in default privileged Docker mode** — CVE-2024-29021 chain showed privileged-mode escape to host. Add gVisor or Firecracker microVM isolation around containers. |
| Code execution (fallback) | Piston (self-hosted) | Public API no longer free for commercial use as of Feb 2026 — self-host only, still OSS |
| Similarity/plagiarism | Custom n-gram hashing or AST-diff | Same concept as Turnitin, applied to code |

## Module 2 — Video Call

| Component | Choice | Notes |
|---|---|---|
| SFU/media server | LiveKit (self-hosted) | OSS, ships signaling + SFU + egress/recording; Agents framework built specifically for piping live audio/video into ML pipelines — matters directly for Module 3 |
| Alternative SFU | mediasoup | Lower-level, more control, more plumbing to build yourself — only reach for this if LiveKit's opinionated model becomes limiting |
| Signaling transport | WebSocket (LiveKit's built-in, or thin custom layer) | Carries SDP offer/answer + ICE candidates |
| NAT traversal | coturn (or LiveKit's bundled TURN) | Battle-tested OSS STUN/TURN |
| Recording/egress | LiveKit Egress | Also used to sample frames/audio into the AI pipeline without loading the live call path |

## Module 3 — AI Monitoring

| Component | Choice | Notes |
|---|---|---|
| Face/gaze CV | MediaPipe Face Landmarker | OSS, 478 3D landmarks (468 face + 10 iris), real-time, single RGB camera. Iris landmarks alone ≠ gaze — needs a per-session calibration step + small regression layer on top |
| Voice activity detection | Silero VAD or WebRTC VAD | Real-time, lightweight |
| Speaker diarization | pyannote.audio | Standard OSS choice for "how many distinct voices" |
| Native helper shell | Tauri or Electron | Wraps the small native module; user-mode only, not kernel |
| Native helper core | Rust/C++/Swift module | Process/window enumeration, capture-affinity checks (`GetWindowDisplayAffinity` on Windows, window-list APIs on macOS), hypervisor/VM fingerprinting (CPUID hypervisor bit, MAC OUI ranges, registry/sysfs artifacts) |
| Overlay signature reference | Study "Vysper" (public OSS overlay clone) | Used defensively, same way security teams study public malware — build signatures against its evasion patterns |
| Lockdown browser reference | Study Safe Exam Browser (OSS, MPL, ETH Zurich) | Not necessarily reused directly, but its consent-dialog pattern and fullscreen/lockdown approach is the right model to copy |
| Deepfake detection | Ongoing research area — no vendor has full coverage | Budget as a continuously-updated model (blink-rate, texture/artifact detection, challenge-response), not a one-time build |

## Shared infra

| Need | Choice |
|---|---|
| Relational data (sessions, candidates, risk scores) | Postgres |
| Presence/pub-sub | Redis |
| Recordings/evidence storage | S3-compatible object storage |
| Event streaming (behavioral signals → risk engine) | Kafka or RabbitMQ |
| Auth | Standard OAuth/OIDC — no custom crypto |

## Known risks to design around from day one
- Judge0 default privileged Docker mode is a real host-compromise vector — harden before any candidate code runs on it
- Piston's public API is no longer free commercially — don't plan around it unless self-hosted
- GPU-level rendering-hook overlays (what Cluely/Interview Coder actually use) are invisible to any video-stream analysis by architecture, not by detection quality — this is why the native helper (process/window layer) carries the real weight for that specific threat, not the CV pipeline
- Kernel-level anti-cheat (Vanguard/EAC-style) is the tempting-but-wrong move here — user-mode is the deliberate, correct call for this product (see Architecture doc, section on kernel vs. user-mode)
