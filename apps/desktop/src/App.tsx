import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  connectEditorCollabSession,
  createCodeExecutionClient,
  createEditorYjsDocument,
  type CodeExecutionResult,
  type EditorCollabSession,
} from "@anecites/editor-core";

import {
  type NormalizedJoinSessionInput,
} from "./session.js";
import {
  createLocalDemoJoinLink,
  getLocalDemoWorkspaceState,
  hostLocalDemoMeeting,
  joinLocalDemoMeeting,
  readLocalDemoJoinCode,
  updateLocalDemoWorkspaceState,
  type LocalDemoMeetingCredentials,
} from "./local-demo.js";
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
import { CandidateEditorPanel } from "./CandidateEditorPanel.js";
import {
  LiveKitMediaTileView,
  MeetingCallControls,
  MeetingVideoRail,
  MeetingVideoRoom,
} from "./MeetingVideo.js";
import { NativeMonitorPanel } from "./NativeMonitorPanel.js";
import { ReviewQueuePanel } from "./ReviewQueuePanel.js";
import {
  emptyExecution,
  type CollabStatus,
  type EditorCursorPosition,
  type ExecutionMode,
  type ExecutionStatus,
  type LiveKitMediaTile,
  type LiveKitMediaTileKind,
  type NativeMonitoringStatus,
  type ReviewQueueStatus,
  type ScreenShareStatus,
  type VideoStatus,
} from "./meeting-types.js";
import { readShellIdentity } from "./ui/app-shell.js";
import { Badge, Button, Field, Input } from "./ui/primitives.js";
import { canHostLocalDemo } from "./public-demo.js";

type DemoView = "home" | "candidate";
type DemoRequestStatus = "idle" | "loading" | "error";
type InviteCopyStatus = "idle" | "copied" | "error";

export interface AppProps {
  initialSession?: NormalizedJoinSessionInput | null;
  initialHostedMeeting?: LocalDemoMeetingCredentials | null;
  initialCodeEditorOpen?: boolean;
  initialJoinCode?: string | null;
  hostInterviewAvailableOverride?: boolean;
  nativeMonitoringAvailableOverride?: boolean;
  writeClipboardText?: (value: string) => Promise<void>;
}

export function App({
  initialSession = null,
  initialHostedMeeting = null,
  initialCodeEditorOpen = false,
  initialJoinCode,
  hostInterviewAvailableOverride,
  nativeMonitoringAvailableOverride,
  writeClipboardText = copyTextToClipboard,
}: AppProps = {}): React.ReactElement {
  const [inviteCode] = useState<string | null>(() => {
    const code = initialJoinCode ?? readBrowserJoinCode();
    return code && /^\d{6}$/.test(code.trim()) ? code.trim() : null;
  });
  const hostInterviewAvailable = hostInterviewAvailableOverride ?? canHostLocalDemo(readBrowserPageUrl());
  const [session, setSession] = useState<NormalizedJoinSessionInput | null>(initialSession);
  const document = useMemo(
    () =>
      createEditorYjsDocument({
        documentId: session?.documentId ?? "local-draft",
        initialText: "",
      }),
    [session?.documentId],
  );
  const [demoView, setDemoView] = useState<DemoView>(inviteCode ? "candidate" : "home");
  const [demoRequestStatus, setDemoRequestStatus] = useState<DemoRequestStatus>("idle");
  const [demoError, setDemoError] = useState<string | null>(null);
  const [meetingCode, setMeetingCode] = useState(inviteCode ?? "");
  const [meetingPassword, setMeetingPassword] = useState("");
  const [hostedMeeting, setHostedMeeting] = useState<LocalDemoMeetingCredentials | null>(initialHostedMeeting);
  const [inviteCopyStatus, setInviteCopyStatus] = useState<InviteCopyStatus>("idle");
  const [codeEditorOpen, setCodeEditorOpen] = useState(initialCodeEditorOpen);
  const [workspaceStateError, setWorkspaceStateError] = useState<string | null>(null);
  const [execution, setExecution] = useState<CodeExecutionResult>(emptyExecution);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>("idle");
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
  const nativeMonitoringAvailable = nativeMonitoringAvailableOverride ?? isNativeMonitoringRuntimeAvailable();
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

  useEffect(() => () => document.destroy(), [document]);

  useEffect(() => {
    if (session) {
      return;
    }

    const handleHashChange = () => {
      const code = readBrowserJoinCode();
      if (!code) {
        return;
      }

      setMeetingCode(code);
      setMeetingPassword("");
      setDemoError(null);
      setDemoRequestStatus("idle");
      setDemoView("candidate");
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [session]);

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
    clearBrowserJoinLink();
    setSession(connection);
    setHostedMeeting(meeting);
    setInviteCopyStatus("idle");
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
  }

  async function leaveDemoSession(): Promise<void> {
    await disconnectVideo();
    setSession(null);
    setHostedMeeting(null);
    setInviteCopyStatus("idle");
    setDemoView("home");
    setDemoRequestStatus("idle");
    setDemoError(null);
    setMeetingCode("");
    setMeetingPassword("");
    setCodeEditorOpen(false);
    setWorkspaceStateError(null);
    resetWorkspaceState();
  }

  async function copyHostedMeetingLink(): Promise<void> {
    if (!hostedMeeting) {
      return;
    }

    try {
      const link = hostedMeeting.joinUrl ?? createLocalDemoJoinLink(hostedMeeting.code, readBrowserWebBaseUrl());
      await writeClipboardText(link);
      setInviteCopyStatus("copied");
    } catch {
      setInviteCopyStatus("error");
    }
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
        sourceCode,
        executionMode: mode,
        sessionId: session.sessionId,
        documentId: session.documentId,
        participantId: session.participantId,
      });
      setExecution(result);
      setExecutionStatus("ready");
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
    }
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
    <MeetingCallControls
      videoStatus={videoStatus}
      screenShareStatus={screenShareStatus}
      onConnectVideo={() => void connectVideo()}
      onDisconnectVideo={() => void disconnectVideo()}
      onCheckScreenShare={() => void checkScreenShare()}
      onStartScreenShare={() => void startScreenShare()}
      onStopScreenShare={() => void stopScreenShare()}
    />
  );
  const hiddenAudioTiles = audioTiles.map((tile) => <LiveKitMediaTileView key={tile.id} tile={tile} />);
  const meetingAlerts = (
    <>
      {workspaceStateError ? <p className="meeting-error" role="alert">{workspaceStateError}</p> : null}
      {videoError ? <p className="meeting-error" role="alert">{videoError}</p> : null}
      {screenShareError ? <p className="meeting-error" role="alert">{screenShareError}</p> : null}
    </>
  );

  if (!session) {
    if (demoView === "home") {
      return (
        <>
          <LandingPage
            canHostInterview={hostInterviewAvailable}
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
                  clearBrowserJoinLink();
                  setDemoView("home");
                  setDemoError(null);
                  setDemoRequestStatus("idle");
                  setMeetingCode("");
                  setMeetingPassword("");
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
          <div className="meeting-invite">
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
            <Button
              className="meeting-copy-link"
              variant="secondary"
              size="small"
              onClick={() => void copyHostedMeetingLink()}
              aria-label="Copy candidate join link"
            >
              {inviteCopyStatus === "copied"
                ? "Copied"
                : inviteCopyStatus === "error"
                  ? "Copy failed"
                  : "Copy link"}
            </Button>
            <span className="sr-only" role="status" aria-live="polite">
              {inviteCopyStatus === "copied"
                ? "Candidate join link copied"
                : inviteCopyStatus === "error"
                  ? "Candidate join link could not be copied"
                  : ""}
            </span>
          </div>
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
          <CandidateEditorPanel
            document={document}
            language={session.languageId === 71 ? "python" : "javascript"}
            languageLabel={languageLabel}
            collabStatus={collabStatus}
            cursorPosition={cursorPosition}
            execution={execution}
            executionStatus={executionStatus}
            sessionId={session.sessionId}
            participantId={session.participantId}
            onCursorPositionChange={updateCursorPosition}
            onExecute={(mode) => void executeCurrentCode(mode)}
          />
          <MeetingVideoRail
            localVideoTiles={localVideoTiles}
            remoteVideoTiles={remoteVideoTiles}
            hiddenAudioTiles={hiddenAudioTiles}
            peerLabel={peerLabel}
            controls={callControls}
          />
        </section>
      ) : (
        <MeetingVideoRoom
          localVideoTiles={localVideoTiles}
          remoteVideoTiles={remoteVideoTiles}
          hiddenAudioTiles={hiddenAudioTiles}
          peerLabel={peerLabel}
          controls={callControls}
        />
      )}

      {nativeMonitoringAvailable ? (
        <NativeMonitorPanel
          status={nativeMonitoringStatus}
          error={nativeMonitoringError}
          snapshot={nativeSnapshot}
          protectedWindowCount={protectedWindowCount}
          detectedVmSignalCount={detectedVmSignalCount}
          onRunCheck={() => void runNativeMonitoringCheck()}
        />
      ) : null}

      {canAccessReviewerQueue ? (
        <ReviewQueuePanel
          status={reviewQueueStatus}
          error={reviewQueueError}
          riskSummaries={riskSummaries}
          onRefresh={() => void refreshReviewQueue()}
          onApplyReviewStatus={(riskSummaryId, reviewStatus) => void applyReviewStatus(riskSummaryId, reviewStatus)}
        />
      ) : null}
    </main>
  );
}

function readBrowserJoinCode(): string | null {
  return typeof window === "undefined" ? null : readLocalDemoJoinCode(window.location.href);
}

function readBrowserPageUrl(): string | null {
  return typeof window === "undefined" ? null : window.location.href;
}

function readBrowserWebBaseUrl(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.location.protocol === "http:" || window.location.protocol === "https:"
    ? window.location.href
    : undefined;
}

function clearBrowserJoinLink(): void {
  if (typeof window === "undefined" || !readLocalDemoJoinCode(window.location.href)) {
    return;
  }

  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(window.history.state, "", url);
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof globalThis.document === "undefined") {
    throw new Error("Clipboard is unavailable");
  }

  const input = globalThis.document.createElement("textarea");
  input.value = value;
  input.readOnly = true;
  input.style.position = "fixed";
  input.style.opacity = "0";
  globalThis.document.body.append(input);
  input.select();

  try {
    if (!globalThis.document.execCommand("copy")) {
      throw new Error("Clipboard is unavailable");
    }
  } finally {
    input.remove();
  }
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
