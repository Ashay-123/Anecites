import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  MonacoCollabEditor,
  connectEditorCollabSession,
  createCodeExecutionClient,
  createEditorYjsDocument,
  type CodeExecutionResult,
  type EditorCollabSession,
} from "@anecites/editor-core";
import { type LocalDemoProblem } from "@anecites/shared";

import {
  type NormalizedJoinSessionInput,
} from "./session.js";
import {
  getLocalDemoProblem,
  getLocalDemoWorkspaceState,
  hostLocalDemoMeeting,
  joinLocalDemoMeeting,
  updateLocalDemoWorkspaceState,
  type LocalDemoMeetingCredentials,
} from "./local-demo.js";
import {
  createLocalDemoSubmissionSource,
  localDemoProblem,
  localDemoStarterCode,
  normalizeLocalDemoSubmissionResult,
} from "./local-demo-problem.js";
import { LandingPage } from "./LandingPage.js";
import {
  attachLiveKitMediaTrack,
  connectLiveKitRoom,
  createLiveKitRoom,
  detachLiveKitMediaTrack,
  observeLiveKitRoomEvents,
  publishLiveKitCameraAndMicrophone,
  requestLiveKitToken,
  runDisplayMediaSelfCheck,
  setLiveKitScreenShare,
  type LiveKitAttachableTrack,
  type LiveKitConnectionStatus,
  type LiveKitMediaMode,
  type LiveKitParticipant,
  type LiveKitTrackPublication,
  type ConnectableLiveKitRoom,
} from "./livekit.js";
import {
  collectNativeMonitoringSnapshot,
  isNativeMonitoringRuntimeAvailable,
  submitNativeMonitoringSnapshot,
  type NativeMonitoringSnapshot,
} from "./native.js";
import {
  listSessionRiskSummaries,
  updateRiskSummaryReview,
  type ReviewerRiskSummary,
  type RiskSummaryReviewStatus,
} from "./review.js";
import { readShellIdentity } from "./ui/app-shell.js";
import { Badge, Button, Field, Input } from "./ui/primitives.js";

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
type NativeMonitoringStatus = "idle" | "scanning" | "ready" | "error";
type ReviewQueueStatus = "idle" | "loading" | "ready" | "updating" | "error";
type DemoView = "home" | "candidate";
type DemoRequestStatus = "idle" | "loading" | "error";
type ExecutionStatus = "idle" | "running" | "ready" | "error";
type CollabStatus = "idle" | "connecting" | "connected" | "unavailable";
type ExecutionMode = "run" | "submit";
type LiveKitMediaTileKind = "audio" | "video";

interface LiveKitMediaTile {
  id: string;
  kind: LiveKitMediaTileKind;
  participantName: string;
  source: string;
  local: boolean;
  element: HTMLMediaElement;
}

interface LocalSubmissionRecord {
  id: string;
  mode: ExecutionMode;
  status: string;
  occurredAt: string;
}

interface EditorCursorPosition {
  lineNumber: number;
  column: number;
}

export function App(): React.ReactElement {
  const document = useMemo(
    () =>
      createEditorYjsDocument({
        documentId: "local-draft",
        initialText: localDemoStarterCode,
      }),
    [],
  );
  const [demoView, setDemoView] = useState<DemoView>("home");
  const [demoRequestStatus, setDemoRequestStatus] = useState<DemoRequestStatus>("idle");
  const [demoError, setDemoError] = useState<string | null>(null);
  const [meetingCode, setMeetingCode] = useState("");
  const [meetingPassword, setMeetingPassword] = useState("");
  const [hostedMeeting, setHostedMeeting] = useState<LocalDemoMeetingCredentials | null>(null);
  const [session, setSession] = useState<NormalizedJoinSessionInput | null>(null);
  const [activeProblem, setActiveProblem] = useState<LocalDemoProblem>(localDemoProblem);
  const [codeEditorOpen, setCodeEditorOpen] = useState(false);
  const [workspaceStateError, setWorkspaceStateError] = useState<string | null>(null);
  const [execution, setExecution] = useState<CodeExecutionResult>(emptyExecution);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>("idle");
  const [submissionHistory, setSubmissionHistory] = useState<LocalSubmissionRecord[]>([]);
  const [collabStatus, setCollabStatus] = useState<CollabStatus>("idle");
  const [cursorPosition, setCursorPosition] = useState<EditorCursorPosition>({
    lineNumber: 1,
    column: 1,
  });
  const [videoStatus, setVideoStatus] = useState<VideoStatus>("idle");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [mediaTiles, setMediaTiles] = useState<LiveKitMediaTile[]>([]);
  const [mediaMode, setMediaMode] = useState<LiveKitMediaMode>("normal");
  const [screenShareStatus, setScreenShareStatus] = useState<ScreenShareStatus>("idle");
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [nativeMonitoringStatus, setNativeMonitoringStatus] = useState<NativeMonitoringStatus>("idle");
  const [nativeMonitoringError, setNativeMonitoringError] = useState<string | null>(null);
  const [nativeSnapshot, setNativeSnapshot] = useState<NativeMonitoringSnapshot | null>(null);
  const [reviewQueueStatus, setReviewQueueStatus] = useState<ReviewQueueStatus>("idle");
  const [reviewQueueError, setReviewQueueError] = useState<string | null>(null);
  const [riskSummaries, setRiskSummaries] = useState<ReviewerRiskSummary[]>([]);
  const nativeMonitoringAvailable = isNativeMonitoringRuntimeAvailable();
  const livekitRoomRef = useRef<ConnectableLiveKitRoom | null>(null);
  const livekitRoomCleanupRef = useRef<(() => void) | null>(null);
  const editorCollabRef = useRef<EditorCollabSession | null>(null);

  useEffect(
    () => () => {
      editorCollabRef.current?.close();
      livekitRoomCleanupRef.current?.();
      void livekitRoomRef.current?.disconnect?.();
    },
    [],
  );

  useEffect(() => {
    if (!session) {
      return;
    }

    const activeSession = session;
    let active = true;

    async function refreshWorkspaceState(): Promise<void> {
      try {
        const state = await getLocalDemoWorkspaceState({
          sessionId: activeSession.sessionId,
          authToken: activeSession.authToken,
        });

        if (active) {
          setCodeEditorOpen(state.codeEditorOpen);
          setWorkspaceStateError(null);
        }
      } catch (error) {
        if (active) {
          setWorkspaceStateError(error instanceof Error ? error.message : "Workspace state unavailable");
        }
      }
    }

    void refreshWorkspaceState();
    const intervalId = window.setInterval(() => {
      void refreshWorkspaceState();
    }, 1_500);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const activeSession = session;
    let active = true;

    async function refreshProblem(): Promise<void> {
      try {
        const details = await getLocalDemoProblem({
          sessionId: activeSession.sessionId,
          authToken: activeSession.authToken,
        });

        if (!active) {
          return;
        }

        setActiveProblem(details.problem);
        if (document.text.toString() === localDemoStarterCode || document.text.length === 0) {
          document.doc.transact(() => {
            document.text.delete(0, document.text.length);
            document.text.insert(0, details.starterCode);
          });
        }
      } catch (error) {
        if (active) {
          setWorkspaceStateError(error instanceof Error ? error.message : "Problem unavailable");
        }
      }
    }

    void refreshProblem();

    return () => {
      active = false;
    };
  }, [document, session]);

  useEffect(() => {
    if (!session || !codeEditorOpen) {
      setCollabStatus("idle");
      return;
    }

    let active = true;
    let removeTextObserver: (() => void) | null = null;
    let collab: EditorCollabSession;

    try {
      collab = connectEditorCollabSession({
        baseUrl: session.collabBaseUrl,
        sessionId: session.sessionId,
        token: session.authToken,
        document,
      });
    } catch {
      setCollabStatus("unavailable");
      return;
    }

    editorCollabRef.current?.close();
    editorCollabRef.current = collab;
    setCollabStatus("connecting");

    void collab.ready.then(() => {
      if (!active) {
        return;
      }

      setCollabStatus("connected");
      collab.sendLocalState();
      const textObserver = () => {
        try {
          collab.sendLocalState();
        } catch {
          setCollabStatus("unavailable");
        }
      };
      document.text.observe(textObserver);
      removeTextObserver = () => {
        document.text.unobserve(textObserver);
      };
    }).catch(() => {
      if (active) {
        setCollabStatus("unavailable");
      }
    });

    return () => {
      active = false;
      removeTextObserver?.();
      collab.close();
      if (editorCollabRef.current === collab) {
        editorCollabRef.current = null;
      }
    };
  }, [codeEditorOpen, document, session]);

  async function joinDemoSession(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      setDemoRequestStatus("loading");
      setDemoError(null);
      const bootstrap = await joinLocalDemoMeeting({
        code: meetingCode,
        password: meetingPassword,
      });
      enterDemoSession(bootstrap.connection, null);
    } catch (error) {
      setDemoRequestStatus("error");
      setDemoError(error instanceof Error ? error.message : "Unable to join local demo");
    }
  }

  async function hostDemoSession(): Promise<void> {
    try {
      setDemoRequestStatus("loading");
      setDemoError(null);
      const bootstrap = await hostLocalDemoMeeting();
      if (!bootstrap.meeting) {
        throw new Error("Local demo meeting credentials are missing");
      }
      enterDemoSession(bootstrap.connection, bootstrap.meeting);
    } catch (error) {
      setDemoRequestStatus("error");
      setDemoError(error instanceof Error ? error.message : "Unable to host local demo");
    }
  }

  function enterDemoSession(
    connection: NormalizedJoinSessionInput,
    meeting: LocalDemoMeetingCredentials | null,
  ): void {
    setSession(connection);
    setHostedMeeting(meeting);
    setCodeEditorOpen(false);
    setWorkspaceStateError(null);
    setDemoRequestStatus("idle");
    resetWorkspaceState();
  }

  function resetWorkspaceState(): void {
    setVideoStatus("idle");
    setVideoError(null);
    clearMediaTiles();
    setMediaMode("normal");
    setScreenShareStatus("idle");
    setScreenShareError(null);
    setNativeMonitoringStatus("idle");
    setNativeMonitoringError(null);
    setNativeSnapshot(null);
    setReviewQueueStatus("idle");
    setReviewQueueError(null);
    setRiskSummaries([]);
    setExecution(emptyExecution);
    setExecutionStatus("idle");
    setCollabStatus("idle");
    setSubmissionHistory([]);
    setActiveProblem(localDemoProblem);
  }

  async function leaveDemoSession(): Promise<void> {
    await disconnectVideo();
    setSession(null);
    setHostedMeeting(null);
    setDemoView("home");
    setDemoRequestStatus("idle");
    setDemoError(null);
    setMeetingCode("");
    setMeetingPassword("");
    setCodeEditorOpen(false);
    setWorkspaceStateError(null);
    resetWorkspaceState();
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
      livekitRoomRef.current = room;
      livekitRoomCleanupRef.current?.();
      livekitRoomCleanupRef.current = observeLiveKitRoomEvents(room, {
        onConnectionStatus(status) {
          setVideoStatus(status);
        },
        onMediaMode(mode) {
          setMediaMode(mode);
        },
        onTrackSubscribed(track, publication, participant) {
          addMediaTile(track, publication, participant, false);
        },
        onTrackUnsubscribed(track, publication, participant) {
          removeMediaTile(track, publication, participant, false);
        },
        onLocalTrackPublished(track, publication, participant) {
          addMediaTile(track, publication, participant, true);
        },
        onLocalTrackUnpublished(track, publication, participant) {
          removeMediaTile(track, publication, participant, true);
        },
      });
      clearMediaTiles();
      await connectLiveKitRoom(room, details);
      await publishLiveKitCameraAndMicrophone(room);
      setVideoStatus("connected");
      setMediaMode("normal");
      setScreenShareStatus("idle");
    } catch (error) {
      livekitRoomCleanupRef.current?.();
      livekitRoomCleanupRef.current = null;
      livekitRoomRef.current = null;
      clearMediaTiles();
      setVideoStatus("error");
      setVideoError(error instanceof Error ? error.message : "Video connection failed");
    }
  }

  async function disconnectVideo(): Promise<void> {
    livekitRoomCleanupRef.current?.();
    livekitRoomCleanupRef.current = null;
    await livekitRoomRef.current?.disconnect?.();
    livekitRoomRef.current = null;
    clearMediaTiles();
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

  function addMediaTile(
    track: LiveKitAttachableTrack,
    publication: LiveKitTrackPublication,
    participant: LiveKitParticipant,
    local: boolean,
  ): void {
    const kind = normalizeMediaTileKind(track.kind ?? publication.kind);

    if (!kind || (local && kind === "audio")) {
      return;
    }

    try {
      const element = attachLiveKitMediaTrack(track);
      element.muted = local;
      const id = createMediaTileId(track, publication, participant, local);
      setMediaTiles((current) => [
        ...current.filter((tile) => tile.id !== id),
        {
          id,
          kind,
          participantName: local ? "You" : participant.name || participant.identity || "Guest",
          source: publication.source ?? "camera",
          local,
          element,
        },
      ]);
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : "Unable to render video track");
    }
  }

  function removeMediaTile(
    track: LiveKitAttachableTrack,
    publication: LiveKitTrackPublication,
    participant: LiveKitParticipant,
    local: boolean,
  ): void {
    detachLiveKitMediaTrack(track);
    const id = createMediaTileId(track, publication, participant, local);
    setMediaTiles((current) => current.filter((tile) => tile.id !== id));
  }

  function clearMediaTiles(): void {
    setMediaTiles([]);
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

  async function openCodeEditorForSession(): Promise<void> {
    if (!session) {
      setWorkspaceStateError("Join a session before opening the code editor");
      return;
    }

    try {
      setWorkspaceStateError(null);
      const state = await updateLocalDemoWorkspaceState({
        sessionId: session.sessionId,
        authToken: session.authToken,
        codeEditorOpen: true,
      });
      setCodeEditorOpen(state.codeEditorOpen);
    } catch (error) {
      setWorkspaceStateError(error instanceof Error ? error.message : "Unable to open code editor");
    }
  }

  async function executeCurrentCode(mode: ExecutionMode): Promise<void> {
    if (!session) {
      setExecutionStatus("error");
      setExecution({
        ...emptyExecution,
        status: {
          id: 0,
          description: "Failed",
        },
        message: "Join a session before executing code",
      });
      recordSubmission(mode, "Failed");
      return;
    }

    const sourceCode = document.text.toString();
    if (!sourceCode.trim()) {
      setExecutionStatus("error");
      setExecution({
        ...emptyExecution,
        status: {
          id: 0,
          description: "Failed",
        },
        message: "Write code before executing",
      });
      recordSubmission(mode, "Failed");
      return;
    }

    try {
      setExecutionStatus("running");
      setExecution({
        ...emptyExecution,
        status: {
          id: 0,
          description: "Running",
        },
      });
      const client = createCodeExecutionClient({
        baseUrl: session.apiBaseUrl,
        token: session.authToken,
      });
      const result = await client.execute({
        languageId: session.languageId,
        sourceCode: mode === "submit"
          ? createLocalDemoSubmissionSource(sourceCode, session.languageId, activeProblem)
          : sourceCode,
        sessionId: session.sessionId,
        documentId: session.documentId,
        participantId: session.participantId,
      });
      const normalizedResult = mode === "submit" ? normalizeLocalDemoSubmissionResult(result) : result;
      setExecution(normalizedResult);
      setExecutionStatus("ready");
      recordSubmission(mode, normalizedResult.status.description);
    } catch (error) {
      setExecutionStatus("error");
      setExecution({
        ...emptyExecution,
        status: {
          id: 0,
          description: "Failed",
        },
        message: error instanceof Error ? error.message : "Code execution failed",
      });
      recordSubmission(mode, "Failed");
    }
  }

  function recordSubmission(mode: ExecutionMode, status: string): void {
    setSubmissionHistory((current) => [
      {
        id: `${Date.now()}-${current.length}`,
        mode,
        status,
        occurredAt: new Date().toLocaleTimeString(),
      },
      ...current,
    ].slice(0, 5));
  }

  const updateCursorPosition = useCallback((position: EditorCursorPosition) => {
    setCursorPosition(position);
  }, []);

  async function runNativeMonitoringCheck(): Promise<void> {
    if (!nativeMonitoringAvailable) {
      setNativeMonitoringStatus("error");
      setNativeMonitoringError("Native monitoring is available only in the desktop app");
      return;
    }

    if (!session) {
      setNativeMonitoringStatus("error");
      setNativeMonitoringError("Join a session before running native check");
      return;
    }

    try {
      setNativeMonitoringStatus("scanning");
      setNativeMonitoringError(null);
      const snapshot = await collectNativeMonitoringSnapshot();
      await submitNativeMonitoringSnapshot({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
        participantId: session.participantId,
        windowStartedAt: new Date(new Date(snapshot.occurredAt).getTime() - 60_000).toISOString(),
        windowEndedAt: snapshot.occurredAt,
        snapshot,
      });
      setNativeSnapshot(snapshot);
      setNativeMonitoringStatus("ready");
    } catch (error) {
      setNativeSnapshot(null);
      setNativeMonitoringStatus("error");
      setNativeMonitoringError(error instanceof Error ? error.message : "Native monitoring check failed");
    }
  }

  async function refreshReviewQueue(): Promise<void> {
    if (!session) {
      setReviewQueueStatus("error");
      setReviewQueueError("Join a session before refreshing reviews");
      return;
    }

    try {
      setReviewQueueStatus("loading");
      setReviewQueueError(null);
      const result = await listSessionRiskSummaries({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
      });
      setRiskSummaries(result.riskSummaries);
      setReviewQueueStatus("ready");
    } catch (error) {
      setReviewQueueStatus("error");
      setReviewQueueError(error instanceof Error ? error.message : "Review queue refresh failed");
    }
  }

  async function applyReviewStatus(riskSummaryId: string, reviewStatus: RiskSummaryReviewStatus): Promise<void> {
    if (!session) {
      setReviewQueueStatus("error");
      setReviewQueueError("Join a session before reviewing summaries");
      return;
    }

    try {
      setReviewQueueStatus("updating");
      setReviewQueueError(null);
      const result = await updateRiskSummaryReview({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
        riskSummaryId,
        reviewStatus,
      });
      setRiskSummaries((current) =>
        current.map((summary) => (summary.id === result.riskSummary.id ? result.riskSummary : summary)),
      );
      setReviewQueueStatus("ready");
    } catch (error) {
      setReviewQueueStatus("error");
      setReviewQueueError(error instanceof Error ? error.message : "Review update failed");
    }
  }

  const protectedWindowCount =
    nativeSnapshot?.riskSignalReport.captureAffinityReports?.filter((report) => report.protectedFromCapture).length ?? 0;
  const detectedVmSignalCount =
    nativeSnapshot?.riskSignalReport.virtualizationReports?.reduce(
      (count, report) => count + report.signals.filter((signal) => signal.detected).length,
      0,
    ) ?? 0;
  const tokenIdentity = session ? readShellIdentity(session.authToken, "Local demo") : null;
  const shellIdentity = tokenIdentity
    ? {
        ...tokenIdentity,
        displayName: tokenIdentity.role === "interviewer" ? "Demo interviewer" : "Demo candidate",
      }
    : null;
  const canAccessReviewerQueue = shellIdentity?.role === "reviewer" || shellIdentity?.role === "admin";
  const isInterviewer = shellIdentity?.role === "interviewer";
  const remoteVideoTiles = mediaTiles.filter((tile) => tile.kind === "video" && !tile.local);
  const localVideoTiles = mediaTiles.filter((tile) => tile.kind === "video" && tile.local);
  const audioTiles = mediaTiles.filter((tile) => tile.kind === "audio");
  const peerLabel = isInterviewer ? "Candidate" : "Interviewer";
  const sessionRoleLabel = isInterviewer ? "Interviewer" : "Candidate";
  const languageLabel = session?.languageId === 71 ? "Python" : "JavaScript";
  const callControls = (
    <div className="meeting-call-controls" aria-label="Call controls">
      <button
        type="button"
        onClick={() => void connectVideo()}
        disabled={videoStatus === "connecting" || videoStatus === "connected" || videoStatus === "reconnecting"}
      >
        Connect camera
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
  );
  const hiddenAudioTiles = audioTiles.map((tile) => <LiveKitMediaTileView key={tile.id} tile={tile} />);
  const meetingAlerts = (
    <>
      {workspaceStateError ? <p className="meeting-error" role="alert">{workspaceStateError}</p> : null}
      {videoError ? <p className="meeting-error" role="alert">{videoError}</p> : null}
      {screenShareError ? <p className="meeting-error" role="alert">{screenShareError}</p> : null}
    </>
  );
  const executionOutput =
    execution.stdout ?? execution.stderr ?? execution.compileOutput ?? execution.message ?? "";
  const hasExecutionOutput = executionOutput.trim().length > 0;
  const problemPanel = (
    <aside className="candidate-problem-pane" aria-label="Interview problem">
      <header>
        <div>
          <span>{activeProblem.difficulty}</span>
          <h1>{activeProblem.title}</h1>
        </div>
      </header>
      <div className="candidate-problem-content">
        <p>{activeProblem.prompt}</p>
        <section aria-labelledby="problem-examples">
          <h2 id="problem-examples">Examples</h2>
          {activeProblem.examples.map((example, index) => (
            <article key={example.input}>
              <h3>Example {index + 1}</h3>
              <dl>
                <div>
                  <dt>Input</dt>
                  <dd>{example.input}</dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>{example.output}</dd>
                </div>
              </dl>
            </article>
          ))}
        </section>
        <section aria-labelledby="problem-constraints">
          <h2 id="problem-constraints">Constraints</h2>
          <ul>
            {activeProblem.constraints.map((constraint) => (
              <li key={constraint}>{constraint}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="problem-testcases">
          <h2 id="problem-testcases">Local testcases</h2>
          <ol className="candidate-testcase-list">
            {activeProblem.testcases.map((testcase, index) => (
              <li key={`${testcase.target}-${testcase.nums.join(",")}`}>
                <strong>Case {index + 1}</strong>
                <span>nums = [{testcase.nums.join(", ")}], target = {testcase.target}</span>
                <span>expected = [{testcase.expected.join(", ")}]</span>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="submission-history">
          <h2 id="submission-history">Submissions</h2>
          {submissionHistory.length === 0 ? (
            <p className="candidate-submission-empty">No runs yet</p>
          ) : (
            <ol className="candidate-submission-list">
              {submissionHistory.map((submission) => (
                <li key={submission.id}>
                  <span>{submission.mode === "submit" ? "Submit" : "Run"}</span>
                  <strong>{submission.status}</strong>
                  <time>{submission.occurredAt}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </aside>
  );
  const editorPanel = (
    <section className="candidate-code-pane" aria-label="Shared code editor">
      <header className="candidate-editor-tabs">
        <nav aria-label="Editor sections">
          <button type="button" aria-current="page">
            <span aria-hidden="true">{"</>"}</span>
            Code
          </button>
          <button type="button" disabled>
            Solutions
          </button>
          <button type="button" disabled>
            Submissions
          </button>
        </nav>
        <div className="candidate-editor-window-actions" aria-label="Editor tools">
          <button type="button" aria-label="Reset editor" disabled>
            Reset
          </button>
          <button type="button" aria-label="Fullscreen editor" disabled>
            Fullscreen
          </button>
        </div>
      </header>
      <div className="candidate-code-toolbar">
        <div className="candidate-language-select" aria-label={`Current language: ${languageLabel}`}>
          <span>{languageLabel}</span>
          <span aria-hidden="true">v</span>
        </div>
        <span className="candidate-autosave-status">Saved automatically</span>
        <div className="candidate-editor-assist">
          <span>{formatCollabStatus(collabStatus)}</span>
          <span>Anecites</span>
          <span>
            Ln {cursorPosition.lineNumber}, Col {cursorPosition.column}
          </span>
        </div>
      </div>
      <MonacoCollabEditor
        className="candidate-editor-host"
        document={document}
        language={session?.languageId === 71 ? "python" : "javascript"}
        onCursorPositionChange={updateCursorPosition}
        telemetry={{
          sessionId: session?.sessionId ?? "local",
          participantId: session?.participantId ?? "local",
          onEvent() {},
        }}
      />
      <section className="candidate-console-pane" aria-label="Execution output">
        <header className="candidate-console-toolbar">
          <div className="candidate-console-tabs" role="tablist" aria-label="Console panels">
            <button type="button" role="tab" aria-selected="false" disabled>
              Testcase
            </button>
            <button type="button" role="tab" aria-selected="true">
              Test Result
            </button>
          </div>
          <div className="candidate-run-actions">
            <button
              className="candidate-run-button"
              type="button"
              onClick={() => void executeCurrentCode("run")}
              disabled={executionStatus === "running"}
            >
              {executionStatus === "running" ? "Running" : "Run"}
            </button>
            <button
              className="candidate-submit-button"
              type="button"
              onClick={() => void executeCurrentCode("submit")}
              disabled={executionStatus === "running"}
            >
              Submit
            </button>
          </div>
        </header>
        <div className="candidate-console-body" data-status={executionStatus}>
          {executionStatus === "idle" && !hasExecutionOutput ? (
            <div className="candidate-testcase-preview">
              {activeProblem.testcases.map((testcase, index) => (
                <article key={`${testcase.target}-${index}`}>
                  <strong>Case {index + 1}</strong>
                  <span>Input: [{testcase.nums.join(", ")}], {testcase.target}</span>
                  <span>Expected: [{testcase.expected.join(", ")}]</span>
                </article>
              ))}
            </div>
          ) : executionStatus === "running" ? (
            <p>Running code through the Anecites backend...</p>
          ) : (
            <pre>{executionOutput}</pre>
          )}
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{execution.status.description}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{execution.timeSeconds ?? "-"}</dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>{execution.memoryKb ?? "-"}</dd>
            </div>
          </dl>
        </div>
      </section>
    </section>
  );

  if (!session) {
    if (demoView === "home") {
      return (
        <>
          <LandingPage
            loading={demoRequestStatus === "loading"}
            onHostInterview={() => void hostDemoSession()}
            onJoinInterview={() => {
              setDemoError(null);
              setDemoRequestStatus("idle");
              setDemoView("candidate");
            }}
          />
          {demoError ? (
            <p className="demo-error demo-error-floating" role="alert">
              {demoError}
            </p>
          ) : null}
        </>
      );
    }

    return (
      <main className="demo-gateway" data-anecites-desktop="local-demo-gateway">
        <section className="demo-gateway-panel" aria-labelledby="demo-title">
          <div className="demo-brand" aria-label="Anecites">
            <span className="application-brand-mark" aria-hidden="true">
              A
            </span>
            <strong>Anecites</strong>
          </div>

          <form className="demo-join-form" onSubmit={(event) => void joinDemoSession(event)} noValidate>
            <div>
              <p className="demo-eyebrow">Candidate</p>
              <h1 id="demo-title">Join interview</h1>
            </div>
            <Field label="Meeting code" htmlFor="meeting-code" required>
              <Input
                id="meeting-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={meetingCode}
                onChange={(event) => setMeetingCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
            </Field>
            <Field label="Password" htmlFor="meeting-password" required>
              <Input
                id="meeting-password"
                type="password"
                autoComplete="off"
                maxLength={8}
                value={meetingPassword}
                onChange={(event) => setMeetingPassword(event.target.value.toUpperCase().slice(0, 8))}
                required
              />
            </Field>
            <div className="demo-form-actions">
              <Button
                variant="ghost"
                disabled={demoRequestStatus === "loading"}
                onClick={() => {
                  setDemoView("home");
                  setDemoError(null);
                  setDemoRequestStatus("idle");
                }}
              >
                Back
              </Button>
              <Button type="submit" loading={demoRequestStatus === "loading"}>
                Join
              </Button>
            </div>
          </form>

          {demoError ? (
            <p className="demo-error" role="alert">
              {demoError}
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main
      className="meeting-shell"
      data-anecites-desktop="interview-shell"
      data-code-editor-open={codeEditorOpen}
      data-meeting-role={isInterviewer ? "interviewer" : "candidate"}
    >
      <header className="meeting-topbar">
        <div className="meeting-brand" aria-label="Anecites">
          <span className="application-brand-mark" aria-hidden="true">
            A
          </span>
          <div>
            <strong>Anecites</strong>
            <span>{sessionRoleLabel} local demo</span>
          </div>
        </div>

        {hostedMeeting ? (
          <dl className="meeting-credentials" aria-label="Candidate joining credentials">
            <div>
              <dt>Code</dt>
              <dd>{hostedMeeting.code}</dd>
            </div>
            <div>
              <dt>Password</dt>
              <dd>{hostedMeeting.password}</dd>
            </div>
          </dl>
        ) : (
          <p className="meeting-waiting-copy">
            {codeEditorOpen
              ? "The interviewer opened the editor."
              : "Video call first. The editor opens when the interviewer starts it."}
          </p>
        )}

        <div className="meeting-topbar-actions">
          <Badge tone={videoStatus === "error" ? "danger" : videoStatus === "connected" ? "success" : "info"}>
            {videoStatus}
          </Badge>
          {isInterviewer ? (
            <Button
              variant={codeEditorOpen ? "secondary" : "primary"}
              size="small"
              onClick={() => void openCodeEditorForSession()}
              disabled={codeEditorOpen}
            >
              {codeEditorOpen ? "Editor open" : "Code editor"}
            </Button>
          ) : null}
          <Button variant="secondary" size="small" onClick={() => void leaveDemoSession()}>
            Leave
          </Button>
        </div>
      </header>

      {meetingAlerts}

      {codeEditorOpen ? (
        <section className="candidate-coding-room" aria-label="Interview workspace">
          {problemPanel}
          {editorPanel}
          <aside className="candidate-video-rail" aria-label="Video call">
            <div className="candidate-video-rail-feed">
              <MeetingVideoCard tile={localVideoTiles[0]} label="You" />
              <MeetingVideoCard tile={remoteVideoTiles[0]} label={peerLabel} />
              {remoteVideoTiles.slice(1).map((tile) => (
                <MeetingVideoCard key={tile.id} tile={tile} label={tile.participantName} />
              ))}
              {hiddenAudioTiles}
            </div>
            {callControls}
          </aside>
        </section>
      ) : (
        <section className="candidate-video-room" aria-label="Interview video call">
          <div className="candidate-video-stage">
            <MeetingVideoCard tile={remoteVideoTiles[0]} label={peerLabel} priority="primary" />
            <MeetingVideoCard tile={localVideoTiles[0]} label="You" priority="secondary" />
            {remoteVideoTiles.slice(1).map((tile) => (
              <MeetingVideoCard key={tile.id} tile={tile} label={tile.participantName} priority="secondary" />
            ))}
            {hiddenAudioTiles}
          </div>
          {callControls}
        </section>
      )}

      {nativeMonitoringAvailable ? (
        <section className="meeting-native-panel" id="native-monitor" aria-label="Native monitor">
          <header>
            <h2>Native monitor</h2>
            <span aria-live="polite">{nativeMonitoringStatus}</span>
          </header>
          <button
            type="button"
            onClick={() => void runNativeMonitoringCheck()}
            disabled={nativeMonitoringStatus === "scanning"}
          >
            Run native check
          </button>
          <dl>
            <div>
              <dt>Processes</dt>
              <dd>{nativeSnapshot?.processReport.processes.length ?? "-"}</dd>
            </div>
            <div>
              <dt>Windows</dt>
              <dd>{nativeSnapshot?.windowReport.windows.length ?? "-"}</dd>
            </div>
            <div>
              <dt>Capture flags</dt>
              <dd>{protectedWindowCount}</dd>
            </div>
            <div>
              <dt>VM signals</dt>
              <dd>{detectedVmSignalCount}</dd>
            </div>
          </dl>
          {nativeMonitoringError ? <p className="meeting-error" role="alert">{nativeMonitoringError}</p> : null}
        </section>
      ) : null}

      {canAccessReviewerQueue ? (
        <section className="review-pane" id="review-queue" aria-label="Reviewer queue">
          <header>
            <h2>Reviewer queue</h2>
            <span aria-live="polite">{reviewQueueStatus}</span>
          </header>
          <div className="review-actions">
            <button
              type="button"
              onClick={() => void refreshReviewQueue()}
              disabled={reviewQueueStatus === "loading" || reviewQueueStatus === "updating"}
            >
              Refresh reviews
            </button>
          </div>
          <div className="review-list">
            {riskSummaries.length === 0 ? (
              <p className="review-empty">No risk summaries loaded</p>
            ) : (
              riskSummaries.map((summary) => (
                <article className="review-item" key={summary.id}>
                  <div className="review-item-header">
                    <strong>{Math.round(summary.score * 100)}%</strong>
                    <span>{summary.reviewStatus}</span>
                  </div>
                  <p>{summary.rationale ?? "Review required"}</p>
                  <dl>
                    <div>
                      <dt>Signals</dt>
                      <dd>{summary.correlatedSignalCount}</dd>
                    </div>
                    <div>
                      <dt>Window</dt>
                      <dd>{formatReviewWindow(summary.windowStartedAt, summary.windowEndedAt)}</dd>
                    </div>
                  </dl>
                  <div className="review-item-actions">
                    <button
                      type="button"
                      onClick={() => void applyReviewStatus(summary.id, "confirmed")}
                      disabled={reviewQueueStatus === "updating"}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyReviewStatus(summary.id, "dismissed")}
                      disabled={reviewQueueStatus === "updating"}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyReviewStatus(summary.id, "needs_more_context")}
                      disabled={reviewQueueStatus === "updating"}
                    >
                      Need context
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
          {reviewQueueError ? (
            <p className="review-error" role="alert">
              {reviewQueueError}
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function formatReviewWindow(windowStartedAt: string, windowEndedAt: string): string {
  const start = new Date(windowStartedAt);
  const end = new Date(windowEndedAt);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "-";
  }

  return `${start.toLocaleTimeString()}-${end.toLocaleTimeString()}`;
}

function formatCollabStatus(status: CollabStatus): string {
  switch (status) {
    case "connected":
      return "Synced";
    case "connecting":
      return "Syncing";
    case "unavailable":
      return "Local only";
    case "idle":
      return "Local draft";
  }
}

function MeetingVideoCard({
  tile,
  label,
  priority = "secondary",
}: {
  tile: LiveKitMediaTile | undefined;
  label: string;
  priority?: "primary" | "secondary";
}): React.ReactElement {
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const slot = slotRef.current;

    if (!slot || !tile) {
      return;
    }

    const element = tile.element;
    element.classList.add("video-media-element");
    slot.replaceChildren(element);

    return () => {
      if (element.parentElement === slot) {
        slot.removeChild(element);
      }
    };
  }, [tile]);

  if (!tile) {
    return (
      <article className="meeting-video-card" data-priority={priority} data-empty="true" aria-label={`${label} video`}>
        <div className="meeting-video-placeholder">
          <strong>{label}</strong>
          <span>Waiting for video</span>
        </div>
      </article>
    );
  }

  return (
    <article
      className="meeting-video-card"
      data-priority={priority}
      data-local={tile.local}
      aria-label={`${tile.participantName} video`}
    >
      <div className="video-media-slot" ref={slotRef} />
      <footer>
        <span>{tile.local ? "You" : tile.participantName}</span>
        <span>{formatMediaSource(tile.source)}</span>
      </footer>
    </article>
  );
}

function LiveKitMediaTileView({ tile }: { tile: LiveKitMediaTile }): React.ReactElement {
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const slot = slotRef.current;

    if (!slot) {
      return;
    }

    const element = tile.element;
    element.classList.add("video-media-element");
    slot.replaceChildren(element);

    return () => {
      if (element.parentElement === slot) {
        slot.removeChild(element);
      }
    };
  }, [tile.element]);

  if (tile.kind === "audio") {
    return (
      <div className="video-audio-slot" ref={slotRef} aria-label={`${tile.participantName} audio`} />
    );
  }

  return (
    <article className="video-tile" data-local={tile.local} aria-label={`${tile.participantName} video`}>
      <div className="video-media-slot" ref={slotRef} />
      <footer>
        <span>{tile.participantName}</span>
        <span>{formatMediaSource(tile.source)}</span>
      </footer>
    </article>
  );
}

function normalizeMediaTileKind(kind: string | undefined): LiveKitMediaTileKind | null {
  if (kind === "audio" || kind === "video") {
    return kind;
  }

  return null;
}

function createMediaTileId(
  track: LiveKitAttachableTrack,
  publication: LiveKitTrackPublication,
  participant: LiveKitParticipant,
  local: boolean,
): string {
  const participantIdentity = participant.identity ?? (local ? "local" : "remote");
  const trackId = publication.trackSid ?? track.sid ?? publication.source ?? track.kind ?? "media";
  return `${local ? "local" : "remote"}:${participantIdentity}:${trackId}`;
}

function formatMediaSource(source: string): string {
  switch (source) {
    case "camera":
      return "Camera";
    case "screen_share":
      return "Screen";
    default:
      return source;
  }
}
