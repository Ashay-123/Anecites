import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  MonacoCollabEditor,
  createEditorYjsDocument,
  type CodeExecutionResult,
} from "@anecites/editor-core";

import {
  normalizeJoinSessionInput,
  validateJoinSessionInput,
  type JoinSessionErrors,
  type JoinSessionInput,
  type NormalizedJoinSessionInput,
} from "./session.js";
import {
  connectLiveKitRoom,
  createLiveKitRoom,
  observeLiveKitRoomEvents,
  requestLiveKitToken,
  runDisplayMediaSelfCheck,
  setLiveKitScreenShare,
  type LiveKitConnectionStatus,
  type LiveKitMediaMode,
  type ConnectableLiveKitRoom,
} from "./livekit.js";

const defaultJoinInput: JoinSessionInput = {
  apiBaseUrl: "http://127.0.0.1:3000",
  collabBaseUrl: "ws://127.0.0.1:3001",
  sessionId: "",
  documentId: "",
  participantId: "",
  authToken: "",
  languageId: 63,
};

const emptyExecution: CodeExecutionResult = {
  token: null,
  status: {
    id: 0,
    description: "Not run",
  },
  stdout: null,
  stderr: null,
  compileOutput: null,
  message: null,
  timeSeconds: null,
  memoryKb: null,
};

type VideoStatus = "idle" | "connecting" | LiveKitConnectionStatus | "error";
type ScreenShareStatus = "idle" | "checking" | "ready" | "sharing" | "error";

export function App(): React.ReactElement {
  const document = useMemo(
    () =>
      createEditorYjsDocument({
        documentId: "local-draft",
        initialText: "console.log('Anecites');\n",
      }),
    [],
  );
  const [joinInput, setJoinInput] = useState<JoinSessionInput>(defaultJoinInput);
  const [joinErrors, setJoinErrors] = useState<JoinSessionErrors>({});
  const [session, setSession] = useState<NormalizedJoinSessionInput | null>(null);
  const [execution] = useState<CodeExecutionResult>(emptyExecution);
  const [videoStatus, setVideoStatus] = useState<VideoStatus>("idle");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [mediaMode, setMediaMode] = useState<LiveKitMediaMode>("normal");
  const [screenShareStatus, setScreenShareStatus] = useState<ScreenShareStatus>("idle");
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const livekitRoomRef = useRef<ConnectableLiveKitRoom | null>(null);
  const livekitRoomCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      livekitRoomCleanupRef.current?.();
      void livekitRoomRef.current?.disconnect?.();
    },
    [],
  );

  function updateJoinInput(field: keyof JoinSessionInput, value: string): void {
    setJoinInput((current) => ({
      ...current,
      [field]: field === "languageId" ? Number(value) : value,
    }));
  }

  function joinSession(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const validation = validateJoinSessionInput(joinInput);

    if (!validation.valid) {
      setJoinErrors(validation.errors);
      setSession(null);
      return;
    }

    setJoinErrors({});
    setSession(normalizeJoinSessionInput(joinInput));
    setVideoStatus("idle");
    setVideoError(null);
    setMediaMode("normal");
    setScreenShareStatus("idle");
    setScreenShareError(null);
  }

  async function connectVideo(): Promise<void> {
    if (!session) {
      setVideoStatus("error");
      setVideoError("Join a session before connecting video");
      return;
    }

    try {
      setVideoStatus("connecting");
      setVideoError(null);
      const details = await requestLiveKitToken({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
        participantId: session.participantId,
      });
      const room = await createLiveKitRoom();
      livekitRoomRef.current = await connectLiveKitRoom(room, details);
      livekitRoomCleanupRef.current?.();
      livekitRoomCleanupRef.current = observeLiveKitRoomEvents(room, {
        onConnectionStatus(status) {
          setVideoStatus(status);
        },
        onMediaMode(mode) {
          setMediaMode(mode);
        },
      });
      setVideoStatus("connected");
      setMediaMode("normal");
      setScreenShareStatus("idle");
    } catch (error) {
      livekitRoomCleanupRef.current?.();
      livekitRoomCleanupRef.current = null;
      livekitRoomRef.current = null;
      setVideoStatus("error");
      setVideoError(error instanceof Error ? error.message : "Video connection failed");
    }
  }

  async function disconnectVideo(): Promise<void> {
    livekitRoomCleanupRef.current?.();
    livekitRoomCleanupRef.current = null;
    await livekitRoomRef.current?.disconnect?.();
    livekitRoomRef.current = null;
    setVideoStatus("idle");
    setVideoError(null);
    setMediaMode("normal");
    setScreenShareStatus("idle");
    setScreenShareError(null);
  }

  async function checkScreenShare(): Promise<void> {
    try {
      setScreenShareStatus("checking");
      setScreenShareError(null);
      await runDisplayMediaSelfCheck();
      setScreenShareStatus("ready");
    } catch (error) {
      setScreenShareStatus("error");
      setScreenShareError(error instanceof Error ? error.message : "Screen share self-check failed");
    }
  }

  async function startScreenShare(): Promise<void> {
    if (!livekitRoomRef.current) {
      setScreenShareStatus("error");
      setScreenShareError("Connect video before sharing screen");
      return;
    }

    try {
      setScreenShareError(null);
      await setLiveKitScreenShare(livekitRoomRef.current, true);
      setScreenShareStatus("sharing");
    } catch (error) {
      setScreenShareStatus("error");
      setScreenShareError(error instanceof Error ? error.message : "Screen share failed");
    }
  }

  async function stopScreenShare(): Promise<void> {
    if (!livekitRoomRef.current) {
      return;
    }

    try {
      await setLiveKitScreenShare(livekitRoomRef.current, false);
      setScreenShareStatus("ready");
      setScreenShareError(null);
    } catch (error) {
      setScreenShareStatus("error");
      setScreenShareError(error instanceof Error ? error.message : "Stopping screen share failed");
    }
  }

  return (
    <main className="app-shell" data-anecites-desktop="interview-shell">
      <aside className="session-panel" aria-label="Session">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <div>
            <h1>Anecites</h1>
            <p>Interview workspace</p>
          </div>
        </div>

        <form className="join-form" onSubmit={joinSession} noValidate>
          <label>
            API URL
            <input
              value={joinInput.apiBaseUrl}
              onChange={(event) => updateJoinInput("apiBaseUrl", event.target.value)}
              aria-invalid={Boolean(joinErrors.apiBaseUrl)}
            />
          </label>
          <FieldError message={joinErrors.apiBaseUrl} />

          <label>
            Collaboration URL
            <input
              value={joinInput.collabBaseUrl}
              onChange={(event) => updateJoinInput("collabBaseUrl", event.target.value)}
              aria-invalid={Boolean(joinErrors.collabBaseUrl)}
            />
          </label>
          <FieldError message={joinErrors.collabBaseUrl} />

          <label>
            Session ID
            <input
              value={joinInput.sessionId}
              onChange={(event) => updateJoinInput("sessionId", event.target.value)}
              aria-invalid={Boolean(joinErrors.sessionId)}
            />
          </label>
          <FieldError message={joinErrors.sessionId} />

          <label>
            Document ID
            <input
              value={joinInput.documentId}
              onChange={(event) => updateJoinInput("documentId", event.target.value)}
              aria-invalid={Boolean(joinErrors.documentId)}
            />
          </label>
          <FieldError message={joinErrors.documentId} />

          <label>
            Participant ID
            <input
              value={joinInput.participantId}
              onChange={(event) => updateJoinInput("participantId", event.target.value)}
              aria-invalid={Boolean(joinErrors.participantId)}
            />
          </label>
          <FieldError message={joinErrors.participantId} />

          <label>
            Auth token
            <input
              type="password"
              value={joinInput.authToken}
              onChange={(event) => updateJoinInput("authToken", event.target.value)}
              aria-invalid={Boolean(joinErrors.authToken)}
            />
          </label>
          <FieldError message={joinErrors.authToken} />

          <button type="submit">Join session</button>
        </form>

        <div className="connection-state">
          <span>State</span>
          <strong>{session ? "Joined" : "Not joined"}</strong>
        </div>
      </aside>

      <section className="workspace-grid">
        <section className="editor-pane" aria-label="Candidate editor">
          <header>
            <h2>Candidate editor</h2>
            <span>{session?.documentId ?? document.documentId}</span>
          </header>
          <MonacoCollabEditor
            className="editor-host"
            document={document}
            language={joinInput.languageId === 71 ? "python" : "javascript"}
            telemetry={{
              sessionId: session?.sessionId ?? "local",
              participantId: session?.participantId ?? "local",
              onEvent() {},
            }}
          />
        </section>

        <section className="side-stack">
          <section className="video-pane" aria-label="Video call">
            <header>
              <h2>Video call</h2>
              <span>{videoStatus}</span>
            </header>
            <div className="video-stage" data-anecites-video={videoStatus}>
              <span>
                {videoStatus === "connected" || videoStatus === "reconnecting"
                  ? `LiveKit ${videoStatus} · ${mediaMode} · screen ${screenShareStatus}`
                  : "No active call"}
              </span>
            </div>
            <div className="video-actions">
              <button
                type="button"
                onClick={() => void connectVideo()}
                disabled={videoStatus === "connecting" || videoStatus === "connected" || videoStatus === "reconnecting"}
              >
                Connect video
              </button>
              <button type="button" onClick={() => void disconnectVideo()} disabled={videoStatus !== "connected"}>
                Disconnect
              </button>
              <button type="button" onClick={() => void checkScreenShare()} disabled={screenShareStatus === "checking"}>
                Check screen
              </button>
              <button
                type="button"
                onClick={() => void startScreenShare()}
                disabled={videoStatus !== "connected" || screenShareStatus === "sharing"}
              >
                Share screen
              </button>
              <button type="button" onClick={() => void stopScreenShare()} disabled={screenShareStatus !== "sharing"}>
                Stop share
              </button>
            </div>
            {videoError ? <p className="video-error">{videoError}</p> : null}
            {screenShareError ? <p className="video-error">{screenShareError}</p> : null}
          </section>

          <section className="output-pane" aria-label="Output">
            <header>
              <h2>Output</h2>
              <span>{execution.status.description}</span>
            </header>
            <pre>{execution.stdout ?? execution.stderr ?? execution.message ?? ""}</pre>
            <dl>
              <div>
                <dt>Time</dt>
                <dd>{execution.timeSeconds ?? "-"}</dd>
              </div>
              <div>
                <dt>Memory</dt>
                <dd>{execution.memoryKb ?? "-"}</dd>
              </div>
            </dl>
          </section>
        </section>
      </section>
    </main>
  );
}

function FieldError(props: { message: string | undefined }): React.ReactElement | null {
  if (!props.message) {
    return null;
  }

  return <p className="field-error">{props.message}</p>;
}
