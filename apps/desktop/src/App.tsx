import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  connectEditorCollabSession,
  createCodeExecutionClient,
  createEditorYjsDocument,
  type CodeExecutionResult,
  type CodeExecutionSubmissionRecord,
  type EditorCollabSession,
  type EditorTelemetryEvent,
} from "@anecites/editor-core";

import {
  type NormalizedJoinSessionInput,
} from "./session.js";
import { GAZE_CALIBRATION_TARGETS } from "@anecites/shared";
import {
  createLocalDemoEditorDocument,
  createLocalDemoJoinLink,
  getLocalDemoWorkspaceState,
  hostLocalDemoMeeting,
  joinLocalDemoMeeting,
  readLocalDemoJoinCode,
  selectLocalDemoEditorDocument,
  updateLocalDemoWorkspaceState,
  type LocalDemoEditorDocument,
  type LocalDemoMeetingCredentials,
  type LocalDemoWorkspaceState,
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
  type NativeMonitoringSnapshot,
} from "./native.js";
import {
  beginCandidateMonitoringLifecycle,
  createMonitoringClientInstanceId,
  parseTrustedMonitoringPolicyPublicKeys,
  type CandidateMonitoringLifecycle,
} from "./monitoring.js";
import {
  getMediaConsentRequirements,
  grantMediaConsent,
  hasCurrentMediaConsent,
  revokeMediaConsent,
  type MediaConsentRequirements,
} from "./media-consent.js";
import {
  getSessionRecordingStatus,
  startSessionRecording,
  stopSessionRecording,
  type SessionRecordingSnapshot,
} from "./recording.js";
import {
  acknowledgeGazeCalibrationStep,
  startGazeCalibration,
  type GazeCalibration,
} from "./gaze-calibration.js";
import {
  createCandidateFocusMonitor,
  type CandidateFocusMonitor,
} from "./focus-monitoring.js";
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
  MeetingVideoRoom,
} from "./MeetingVideo.js";
import { NativeMonitorPanel } from "./NativeMonitorPanel.js";
import { ReviewQueuePanel } from "./ReviewQueuePanel.js";
import { getReviewerEvidencePlayback, type ReviewerEvidencePlayback } from "./evidence-playback.js";
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
import { Dialog } from "./ui/dialog.js";
import { Badge, Button, Field, Input } from "./ui/primitives.js";
import { canHostLocalDemo } from "./public-demo.js";

type DemoView = "home" | "candidate";
type DemoRequestStatus = "idle" | "loading" | "error";
type InviteCopyStatus = "idle" | "copied" | "error";
type MonitoringConsentStatus = "not_required" | "required" | "starting" | "active" | "error";
type MediaConsentStatus = "idle" | "loading" | "required" | "granting" | "active" | "withdrawing" | "error";
type RecordingRequestStatus = "idle" | "loading" | "starting" | "stopping" | "ready" | "error";
type DocumentMutationStatus = "idle" | "creating" | "selecting";
type GazeCalibrationStatus = "idle" | "starting" | "active" | "submitting" | "completed" | "abandoned" | "error";

const NATIVE_MONITORING_SCAN_INTERVAL_MS = 30_000;
const GAZE_CALIBRATION_TARGET_DELAY_MS = 2_000;
const SHARED_EXECUTION_REFRESH_INTERVAL_MS = 1_500;

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
  const [workspaceDocuments, setWorkspaceDocuments] = useState<LocalDemoEditorDocument[]>(() =>
    initialSession ? [{ id: initialSession.documentId, label: "Solution 1" }] : [],
  );
  const [activeDocumentId, setActiveDocumentId] = useState(
    initialSession?.documentId ?? "local-draft",
  );
  const document = useMemo(
    () =>
      createEditorYjsDocument({
        documentId: activeDocumentId,
        initialText: "",
      }),
    [activeDocumentId],
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
  const [documentMutationStatus, setDocumentMutationStatus] = useState<DocumentMutationStatus>("idle");
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
  const [monitoringConsentOpen, setMonitoringConsentOpen] = useState(false);
  const [monitoringConsentStatus, setMonitoringConsentStatus] = useState<MonitoringConsentStatus>("not_required");
  const [monitoringHeartbeatError, setMonitoringHeartbeatError] = useState<string | null>(null);
  const [mediaConsentRequirements, setMediaConsentRequirements] = useState<MediaConsentRequirements | null>(null);
  const [mediaConsentOpen, setMediaConsentOpen] = useState(false);
  const [mediaConsentStatus, setMediaConsentStatus] = useState<MediaConsentStatus>("idle");
  const [mediaConsentError, setMediaConsentError] = useState<string | null>(null);
  const [recordingSnapshot, setRecordingSnapshot] = useState<SessionRecordingSnapshot>({
    recordingStatus: null,
    recordingControl: null,
  });
  const [recordingRequestStatus, setRecordingRequestStatus] = useState<RecordingRequestStatus>("idle");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [gazeCalibration, setGazeCalibration] = useState<GazeCalibration | null>(null);
  const [gazeCalibrationOpen, setGazeCalibrationOpen] = useState(false);
  const [gazeCalibrationStatus, setGazeCalibrationStatus] = useState<GazeCalibrationStatus>("idle");
  const [gazeCalibrationError, setGazeCalibrationError] = useState<string | null>(null);
  const [gazeCalibrationTargetReady, setGazeCalibrationTargetReady] = useState(false);
  const [reviewQueueStatus, setReviewQueueStatus] = useState<ReviewQueueStatus>("idle");
  const [reviewQueueError, setReviewQueueError] = useState<string | null>(null);
  const [riskSummaries, setRiskSummaries] = useState<ReviewerRiskSummary[]>([]);
  const [reviewerEvidencePlayback, setReviewerEvidencePlayback] = useState<ReviewerEvidencePlayback | null>(null);
  const nativeMonitoringAvailable = nativeMonitoringAvailableOverride ?? isNativeMonitoringRuntimeAvailable();
  const livekitRoomRef = useRef<ConnectableLiveKitRoom | null>(null);
  const livekitRoomCleanupRef = useRef<(() => void) | null>(null);
  const editorCollabRef = useRef<EditorCollabSession | null>(null);
  const monitoringLifecycleRef = useRef<CandidateMonitoringLifecycle | null>(null);
  const focusMonitorRef = useRef<CandidateFocusMonitor | null>(null);
  const monitoringClientInstanceIdRef = useRef<string | null>(null);
  const nativeMonitoringScanIntervalRef = useRef<number | null>(null);
  const nativeMonitoringScanInFlightRef = useRef(false);
  const latestSharedExecutionIdRef = useRef<string | null>(null);
  const sessionIdentity = useMemo(
    () => (session ? readShellIdentity(session.authToken, "Local demo") : null),
    [session],
  );
  const candidateMonitoringRequired =
    nativeMonitoringAvailable && sessionIdentity?.role === "candidate";
  const canPresentMediaConsent = !candidateMonitoringRequired || monitoringConsentStatus === "active";

  useEffect(
    () => () => {
      editorCollabRef.current?.close();
      livekitRoomCleanupRef.current?.();
      void livekitRoomRef.current?.disconnect?.();
      const monitoringLifecycle = monitoringLifecycleRef.current;
      monitoringLifecycleRef.current = null;
      focusMonitorRef.current?.stop();
      focusMonitorRef.current = null;
      stopAutomaticNativeMonitoring();
      void monitoringLifecycle?.stop("client_shutdown");
    },
    [],
  );

  useEffect(() => () => document.destroy(), [document]);

  useEffect(() => {
    if (!session || !candidateMonitoringRequired) {
      setMonitoringConsentOpen(false);
      setMonitoringConsentStatus("not_required");
      return;
    }

    setMonitoringConsentStatus("required");
    setMonitoringConsentOpen(true);
    setNativeMonitoringError(null);
  }, [candidateMonitoringRequired, session]);

  useEffect(() => {
    if (!session) {
      setMediaConsentRequirements(null);
      setMediaConsentOpen(false);
      setMediaConsentStatus("idle");
      setMediaConsentError(null);
      return;
    }

    let active = true;
    setMediaConsentRequirements(null);
    setMediaConsentOpen(false);
    setMediaConsentStatus("loading");
    setMediaConsentError(null);

    void getMediaConsentRequirements({
      apiBaseUrl: session.apiBaseUrl,
      authToken: session.authToken,
      sessionId: session.sessionId,
    }).then((requirements) => {
      if (!active) {
        return;
      }

      setMediaConsentRequirements(requirements);
      setMediaConsentStatus(hasCurrentMediaConsent(requirements) ? "active" : "required");
    }).catch((error: unknown) => {
      if (!active) {
        return;
      }

      setMediaConsentStatus("error");
      setMediaConsentError(error instanceof Error ? error.message : "Recording consent could not be verified");
    });

    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      setRecordingSnapshot({ recordingStatus: null, recordingControl: null });
      setRecordingRequestStatus("idle");
      setRecordingError(null);
      return;
    }

    const activeSession = session;
    let active = true;

    async function refreshRecordingStatus(): Promise<void> {
      try {
        const snapshot = await getSessionRecordingStatus({
          apiBaseUrl: activeSession.apiBaseUrl,
          authToken: activeSession.authToken,
          sessionId: activeSession.sessionId,
        });
        if (!active) {
          return;
        }

        setRecordingSnapshot(snapshot);
        setRecordingRequestStatus("ready");
        setRecordingError(null);
      } catch (error) {
        if (!active) {
          return;
        }

        setRecordingRequestStatus("error");
        setRecordingError(error instanceof Error ? error.message : "Recording status is unavailable");
      }
    }

    setRecordingRequestStatus("loading");
    setRecordingError(null);
    void refreshRecordingStatus();
    const intervalId = window.setInterval(() => {
      void refreshRecordingStatus();
    }, 4_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [session]);

  useEffect(() => {
    if (
      canPresentMediaConsent &&
      (mediaConsentStatus === "required" || mediaConsentStatus === "error")
    ) {
      setMediaConsentOpen(true);
    }
  }, [canPresentMediaConsent, mediaConsentStatus]);

  useEffect(() => {
    if (
      !gazeCalibrationOpen ||
      gazeCalibrationStatus !== "active" ||
      !gazeCalibration ||
      gazeCalibration.steps.length >= GAZE_CALIBRATION_TARGETS.length
    ) {
      setGazeCalibrationTargetReady(false);
      return;
    }

    setGazeCalibrationTargetReady(false);
    const timeoutId = window.setTimeout(
      () => setGazeCalibrationTargetReady(true),
      GAZE_CALIBRATION_TARGET_DELAY_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [gazeCalibration, gazeCalibrationOpen, gazeCalibrationStatus]);

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
          applyWorkspaceState(state);
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
    setExecution(emptyExecution);
    setExecutionStatus("idle");
    latestSharedExecutionIdRef.current = null;
    setCollabStatus("idle");
    setCursorPosition({ lineNumber: 1, column: 1 });
  }, [activeDocumentId]);

  useEffect(() => {
    if (!session || !codeEditorOpen || executionStatus === "running") {
      return;
    }

    const activeSession = session;
    const selectedDocumentId = activeDocumentId;
    const client = createCodeExecutionClient({
      baseUrl: activeSession.apiBaseUrl,
      token: activeSession.authToken,
    });
    let active = true;

    async function refreshSharedExecution(): Promise<void> {
      try {
        const submissions = await client.listSubmissions({
          sessionId: activeSession.sessionId,
          documentId: selectedDocumentId,
          limit: 1,
        });
        const latestSubmission = submissions[0];
        if (!active || !latestSubmission || latestSharedExecutionIdRef.current === latestSubmission.id) {
          return;
        }

        latestSharedExecutionIdRef.current = latestSubmission.id;
        setExecution(toSharedExecutionResult(latestSubmission));
        setExecutionStatus("ready");
      } catch {
        // Execution history is a best-effort shared display. The local result remains visible.
      }
    }

    void refreshSharedExecution();
    const intervalId = window.setInterval(() => {
      void refreshSharedExecution();
    }, SHARED_EXECUTION_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [activeDocumentId, codeEditorOpen, executionStatus, session]);

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

  function recordEditorTelemetryEvent(event: EditorTelemetryEvent): void {
    if (event.type !== "editor.paste_blocked") {
      return;
    }

    try {
      editorCollabRef.current?.sendPasteBlockedTelemetry();
    } catch {
      // Editor telemetry is best effort and must not interrupt collaboration.
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
    monitoringClientInstanceIdRef.current = null;
    setHostedMeeting(meeting);
    setInviteCopyStatus("idle");
    setCodeEditorOpen(false);
    setWorkspaceDocuments([{ id: connection.documentId, label: "Solution 1" }]);
    setActiveDocumentId(connection.documentId);
    setDocumentMutationStatus("idle");
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
    setMonitoringConsentOpen(false);
    setMonitoringConsentStatus("not_required");
    setMonitoringHeartbeatError(null);
    setMediaConsentRequirements(null);
    setMediaConsentOpen(false);
    setMediaConsentStatus("idle");
    setMediaConsentError(null);
    setRecordingSnapshot({ recordingStatus: null, recordingControl: null });
    setRecordingRequestStatus("idle");
    setRecordingError(null);
    setGazeCalibration(null);
    setGazeCalibrationOpen(false);
    setGazeCalibrationStatus("idle");
    setGazeCalibrationError(null);
    setGazeCalibrationTargetReady(false);
    setReviewQueueStatus("idle");
    setReviewQueueError(null);
    setRiskSummaries([]);
    setExecution(emptyExecution);
    setExecutionStatus("idle");
    setCollabStatus("idle");
  }

  async function leaveDemoSession(): Promise<void> {
    if (
      sessionIdentity?.role === "interviewer" &&
      recordingSnapshot.recordingStatus?.state === "active" &&
      recordingSnapshot.recordingControl
    ) {
      const stopped = await stopCurrentSessionRecording();
      if (!stopped) {
        return;
      }
    }

    await stopMonitoringLifecycle("session_left");
    await disconnectVideo();
    setSession(null);
    monitoringClientInstanceIdRef.current = null;
    setHostedMeeting(null);
    setInviteCopyStatus("idle");
    setDemoView("home");
    setDemoRequestStatus("idle");
    setDemoError(null);
    setMeetingCode("");
    setMeetingPassword("");
    setCodeEditorOpen(false);
    setWorkspaceDocuments([]);
    setActiveDocumentId("local-draft");
    setDocumentMutationStatus("idle");
    setWorkspaceStateError(null);
    resetWorkspaceState();
  }

  async function acceptMonitoringConsent(): Promise<void> {
    if (!session || !candidateMonitoringRequired) {
      return;
    }

    try {
      setMonitoringConsentStatus("starting");
      setNativeMonitoringStatus("scanning");
      setNativeMonitoringError(null);
      setMonitoringHeartbeatError(null);
      const lifecycle = await beginCandidateMonitoringLifecycle(
        {
          apiBaseUrl: session.apiBaseUrl,
          authToken: session.authToken,
          sessionId: session.sessionId,
          participantId: session.participantId,
          clientInstanceId:
            monitoringClientInstanceIdRef.current ??= createMonitoringClientInstanceId(),
          clientVersion: "0.0.0",
        },
        {
          trustedMonitoringPolicyPublicKeys: parseTrustedMonitoringPolicyPublicKeys(
            import.meta.env.VITE_MONITORING_POLICY_PUBLIC_KEYS_JSON,
          ),
          onHeartbeatSuccess() {
            setMonitoringConsentStatus("active");
            setMonitoringHeartbeatError(null);
          },
          onHeartbeatError(error) {
            setMonitoringConsentStatus("error");
            setMonitoringHeartbeatError(error.message);
          },
        },
      );
      monitoringLifecycleRef.current = lifecycle;
      startCandidateFocusMonitoring(lifecycle);
      setMonitoringConsentStatus("active");
      setMonitoringConsentOpen(false);
      setNativeMonitoringStatus("ready");
      startAutomaticNativeMonitoring();
    } catch (error) {
      setMonitoringConsentStatus("error");
      setNativeMonitoringStatus("error");
      setMonitoringHeartbeatError(error instanceof Error ? error.message : "Monitoring could not start");
    }
  }

  async function declineMonitoringConsent(): Promise<void> {
    setMonitoringConsentOpen(false);
    await leaveDemoSession();
  }

  async function acceptMediaConsent(): Promise<void> {
    if (!session || !mediaConsentRequirements || mediaConsentStatus === "granting") {
      return;
    }

    try {
      setMediaConsentStatus("granting");
      setMediaConsentError(null);
      const mediaConsent = await grantMediaConsent({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
        scopes: mediaConsentRequirements.requiredScopes,
      });
      const updatedRequirements = {
        ...mediaConsentRequirements,
        mediaConsent,
      };

      if (!hasCurrentMediaConsent(updatedRequirements)) {
        throw new Error("Media consent response did not include every required scope");
      }

      setMediaConsentRequirements(updatedRequirements);
      setMediaConsentStatus("active");
      setMediaConsentOpen(false);
    } catch (error) {
      setMediaConsentStatus("required");
      setMediaConsentError(error instanceof Error ? error.message : "Recording consent could not be saved");
      setMediaConsentOpen(true);
    }
  }

  async function withdrawMediaConsentAndLeave(): Promise<void> {
    if (
      !session ||
      !mediaConsentRequirements?.mediaConsent ||
      mediaConsentStatus === "withdrawing"
    ) {
      return;
    }

    try {
      setMediaConsentStatus("withdrawing");
      setMediaConsentError(null);
      await revokeMediaConsent({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
        mediaConsentId: mediaConsentRequirements.mediaConsent.id,
      });
      await leaveDemoSession();
    } catch (error) {
      setMediaConsentStatus("active");
      setMediaConsentError(error instanceof Error ? error.message : "Recording consent could not be withdrawn");
    }
  }

  async function declineMediaConsent(): Promise<void> {
    setMediaConsentOpen(false);
    await leaveDemoSession();
  }

  async function startCurrentSessionRecording(): Promise<void> {
    if (!session || sessionIdentity?.role !== "interviewer" || recordingRequestStatus === "starting") {
      return;
    }

    if (mediaConsentStatus !== "active") {
      setRecordingError("Accept recording consent before starting a recording");
      return;
    }

    try {
      setRecordingRequestStatus("starting");
      setRecordingError(null);
      const recording = await startSessionRecording({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
      });
      setRecordingSnapshot({
        recordingStatus: {
          state: recording.state,
          startedAt: recording.startedAt,
          stopRequestedAt: recording.stopRequestedAt,
          completedAt: recording.completedAt,
        },
        recordingControl: {
          egressId: recording.egressId,
        },
      });
      setRecordingRequestStatus("ready");
    } catch (error) {
      setRecordingRequestStatus("error");
      setRecordingError(error instanceof Error ? error.message : "Recording could not start");
    }
  }

  async function stopCurrentSessionRecording(): Promise<boolean> {
    if (!session || sessionIdentity?.role !== "interviewer" || !recordingSnapshot.recordingControl) {
      setRecordingError("Recording control is unavailable. Refresh the interview and try again.");
      return false;
    }

    try {
      setRecordingRequestStatus("stopping");
      setRecordingError(null);
      const result = await stopSessionRecording({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
        egressId: recordingSnapshot.recordingControl.egressId,
      });
      setRecordingSnapshot({
        recordingStatus: result.recording,
        recordingControl: null,
      });
      setRecordingRequestStatus("ready");
      return true;
    } catch (error) {
      setRecordingRequestStatus("error");
      setRecordingError(error instanceof Error ? error.message : "Recording could not stop");
      return false;
    }
  }

  async function startCandidateGazeCalibration(): Promise<void> {
    if (!session || sessionIdentity?.role !== "candidate" || gazeCalibrationStatus === "starting") {
      return;
    }

    try {
      setGazeCalibrationStatus("starting");
      setGazeCalibrationError(null);
      const calibration = await startGazeCalibration({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
      });
      setGazeCalibration(calibration);
      setGazeCalibrationStatus(calibration.state);
      setGazeCalibrationOpen(true);
    } catch (error) {
      setGazeCalibrationStatus("error");
      setGazeCalibrationError(error instanceof Error ? error.message : "Camera calibration could not start");
      setGazeCalibrationOpen(true);
    }
  }

  async function acknowledgeCurrentGazeCalibrationTarget(): Promise<void> {
    if (
      !session ||
      !gazeCalibration ||
      gazeCalibrationStatus !== "active" ||
      !gazeCalibrationTargetReady
    ) {
      return;
    }

    const target = GAZE_CALIBRATION_TARGETS[gazeCalibration.steps.length];
    if (!target) {
      return;
    }

    try {
      setGazeCalibrationStatus("submitting");
      setGazeCalibrationError(null);
      const updated = await acknowledgeGazeCalibrationStep({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
        gazeCalibrationId: gazeCalibration.id,
        target,
        sequence: gazeCalibration.steps.length + 1,
      });
      setGazeCalibration(updated);
      setGazeCalibrationStatus(updated.state);
    } catch (error) {
      setGazeCalibrationStatus("error");
      setGazeCalibrationError(error instanceof Error ? error.message : "Camera calibration could not continue");
    }
  }

  async function stopMonitoringLifecycle(reason: "session_left" | "client_shutdown"): Promise<void> {
    stopAutomaticNativeMonitoring();
    stopCandidateFocusMonitoring();
    const lifecycle = monitoringLifecycleRef.current;
    monitoringLifecycleRef.current = null;
    if (!lifecycle) {
      return;
    }

    try {
      await lifecycle.stop(reason);
    } catch (error) {
      setNativeMonitoringError(error instanceof Error ? error.message : "Monitoring could not stop cleanly");
    }
  }

  function startAutomaticNativeMonitoring(): void {
    stopAutomaticNativeMonitoring();
    void runNativeMonitoringCheck();
    nativeMonitoringScanIntervalRef.current = window.setInterval(() => {
      void runNativeMonitoringCheck();
    }, NATIVE_MONITORING_SCAN_INTERVAL_MS);
  }

  function stopAutomaticNativeMonitoring(): void {
    if (nativeMonitoringScanIntervalRef.current !== null) {
      window.clearInterval(nativeMonitoringScanIntervalRef.current);
      nativeMonitoringScanIntervalRef.current = null;
    }
  }

  function startCandidateFocusMonitoring(lifecycle: CandidateMonitoringLifecycle): void {
    stopCandidateFocusMonitoring();
    focusMonitorRef.current = createCandidateFocusMonitor({
      onFocusLoss(event) {
        void lifecycle.recordFocusLoss(event).catch((error: unknown) => {
          if (monitoringLifecycleRef.current === lifecycle) {
            setMonitoringHeartbeatError(
              error instanceof Error ? error.message : "Focus monitoring event could not be recorded",
            );
          }
        });
      },
    });
  }

  function stopCandidateFocusMonitoring(): void {
    focusMonitorRef.current?.stop();
    focusMonitorRef.current = null;
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

  function applyWorkspaceState(state: LocalDemoWorkspaceState): void {
    setCodeEditorOpen(state.codeEditorOpen);
    setWorkspaceDocuments(state.documents);
    setActiveDocumentId(state.activeDocumentId);
  }

  async function toggleCodeEditorForSession(): Promise<void> {
    if (!session) {
      setWorkspaceStateError("Join a session before updating the code editor");
      return;
    }

    try {
      setWorkspaceStateError(null);
      const state = await updateLocalDemoWorkspaceState({
        sessionId: session.sessionId,
        authToken: session.authToken,
        codeEditorOpen: !codeEditorOpen,
      });
      applyWorkspaceState(state);
    } catch (error) {
      setWorkspaceStateError(error instanceof Error ? error.message : "Unable to update code editor");
    }
  }

  async function createEditorTab(): Promise<void> {
    if (!session || documentMutationStatus !== "idle") {
      return;
    }
    try {
      setDocumentMutationStatus("creating");
      setWorkspaceStateError(null);
      const state = await createLocalDemoEditorDocument({
        sessionId: session.sessionId,
        authToken: session.authToken,
      });
      applyWorkspaceState(state);
    } catch (error) {
      setWorkspaceStateError(error instanceof Error ? error.message : "Unable to create editor tab");
    } finally {
      setDocumentMutationStatus("idle");
    }
  }

  async function selectEditorTab(documentId: string): Promise<void> {
    if (!session || documentMutationStatus !== "idle" || documentId === activeDocumentId) {
      return;
    }
    try {
      setDocumentMutationStatus("selecting");
      setWorkspaceStateError(null);
      const state = await selectLocalDemoEditorDocument({
        sessionId: session.sessionId,
        authToken: session.authToken,
        documentId,
      });
      applyWorkspaceState(state);
    } catch (error) {
      setWorkspaceStateError(error instanceof Error ? error.message : "Unable to select editor tab");
    } finally {
      setDocumentMutationStatus("idle");
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
        documentId: activeDocumentId,
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

    const monitoringLifecycle = monitoringLifecycleRef.current;
    if (!monitoringLifecycle) {
      setNativeMonitoringStatus("error");
      setNativeMonitoringError("Accept interview monitoring before running native checks");
      return;
    }

    if (nativeMonitoringScanInFlightRef.current) {
      return;
    }

    try {
      nativeMonitoringScanInFlightRef.current = true;
      setNativeMonitoringStatus("scanning");
      setNativeMonitoringError(null);
      const snapshot = await collectNativeMonitoringSnapshot({
        prohibitedApplicationRules: monitoringLifecycle.prohibitedApplicationRules,
      });
      if (monitoringLifecycleRef.current !== monitoringLifecycle) {
        return;
      }
      await monitoringLifecycle.recordNativeRiskReport(snapshot.riskSignalReport);
      if (monitoringLifecycleRef.current !== monitoringLifecycle) {
        return;
      }
      setNativeSnapshot(snapshot);
      setNativeMonitoringStatus("ready");
    } catch (error) {
      setNativeSnapshot(null);
      setNativeMonitoringStatus("error");
      setNativeMonitoringError(error instanceof Error ? error.message : "Native monitoring check failed");
    } finally {
      nativeMonitoringScanInFlightRef.current = false;
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

  async function playReviewerEvidence(summary: ReviewerRiskSummary): Promise<void> {
    if (!session || !summary.evidenceObjectId) {
      return;
    }
    try {
      setReviewQueueStatus("loading");
      setReviewQueueError(null);
      setReviewerEvidencePlayback(await getReviewerEvidencePlayback({
        apiBaseUrl: session.apiBaseUrl,
        authToken: session.authToken,
        sessionId: session.sessionId,
        evidenceObjectId: summary.evidenceObjectId,
        riskSummaryId: summary.id,
      }));
      setReviewQueueStatus("ready");
    } catch (error) {
      setReviewQueueStatus("error");
      setReviewQueueError(error instanceof Error ? error.message : "Evidence playback failed");
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
  const managingMediaConsent = mediaConsentStatus === "active" || mediaConsentStatus === "withdrawing";
  const recordingState = recordingSnapshot.recordingStatus?.state ?? "idle";
  const recordingInProgress = recordingState === "active" || recordingState === "stop_requested";
  const candidateGazeCalibrationAvailable =
    sessionIdentity?.role === "candidate" &&
    mediaConsentStatus === "active" &&
    mediaConsentRequirements?.requiredScopes.includes("video_gaze_calibration") === true &&
    videoStatus === "connected";
  const currentGazeCalibrationTarget = gazeCalibration
    ? GAZE_CALIBRATION_TARGETS[gazeCalibration.steps.length] ?? null
    : null;
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
      {candidateMonitoringRequired && nativeMonitoringError ? (
        <p className="meeting-error" role="alert">{nativeMonitoringError}</p>
      ) : null}
      {candidateMonitoringRequired && monitoringHeartbeatError ? (
        <p className="meeting-error" role="alert">{monitoringHeartbeatError}</p>
      ) : null}
      {mediaConsentError && !mediaConsentOpen ? (
        <p className="meeting-error" role="alert">{mediaConsentError}</p>
      ) : null}
      {recordingError ? <p className="meeting-error" role="alert">{recordingError}</p> : null}
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
          {mediaConsentStatus === "active" ? (
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                setMediaConsentError(null);
                setMediaConsentOpen(true);
              }}
            >
              Recording consent
            </Button>
          ) : null}
          {candidateGazeCalibrationAvailable ? (
            <Button
              variant="secondary"
              size="small"
              loading={gazeCalibrationStatus === "starting"}
              onClick={() => void startCandidateGazeCalibration()}
            >
              {gazeCalibrationStatus === "completed" || gazeCalibrationStatus === "abandoned"
                ? "Recalibrate camera"
                : "Calibrate camera"}
            </Button>
          ) : null}
          {candidateMonitoringRequired ? (
            <Badge
              tone={
                monitoringConsentStatus === "error" || nativeMonitoringStatus === "error"
                  ? "danger"
                  : monitoringConsentStatus === "active"
                    ? "success"
                    : "info"
              }
            >
              {monitoringConsentStatus === "error" || nativeMonitoringStatus === "error"
                ? "Monitoring issue"
                : monitoringConsentStatus === "active"
                  ? "Monitoring active"
                  : "Monitoring required"}
            </Badge>
          ) : null}
          <Badge tone={videoStatus === "error" ? "danger" : videoStatus === "connected" ? "success" : "info"}>
            {videoStatus}
          </Badge>
          {recordingState !== "idle" ? (
            <Badge tone={recordingState === "failed" ? "danger" : recordingInProgress ? "warning" : "info"}>
              {describeRecordingState(recordingState)}
            </Badge>
          ) : null}
          {isInterviewer ? (
            <Button
              variant={recordingState === "active" ? "destructive" : "secondary"}
              size="small"
              loading={recordingRequestStatus === "starting" || recordingRequestStatus === "stopping"}
              disabled={
                recordingState === "stop_requested" ||
                (recordingState !== "active" && mediaConsentStatus !== "active")
              }
              onClick={() => {
                if (recordingState === "active") {
                  void stopCurrentSessionRecording();
                } else {
                  void startCurrentSessionRecording();
                }
              }}
            >
              {recordingState === "active"
                ? "Stop recording"
                : recordingState === "stop_requested"
                  ? "Finishing recording"
                  : "Start recording"}
            </Button>
          ) : null}
          {isInterviewer ? (
            <Button
              variant={codeEditorOpen ? "secondary" : "primary"}
              size="small"
              onClick={() => void toggleCodeEditorForSession()}
            >
              {codeEditorOpen ? "Close editor" : "Code editor"}
            </Button>
          ) : null}
          <Button variant="secondary" size="small" onClick={() => void leaveDemoSession()}>
            Leave
          </Button>
        </div>
      </header>

      {meetingAlerts}

      <section className={codeEditorOpen ? "candidate-coding-room" : undefined} aria-label={codeEditorOpen ? "Interview workspace" : undefined}>
        {codeEditorOpen ? (
          <CandidateEditorPanel
            key="code-editor"
            document={document}
            language={session.languageId === 71 ? "python" : "javascript"}
            languageLabel={languageLabel}
            collabStatus={collabStatus}
            cursorPosition={cursorPosition}
            execution={execution}
            executionStatus={executionStatus}
            sessionId={session.sessionId}
            participantId={session.participantId}
            disablePaste={!isInterviewer}
            documents={workspaceDocuments}
            activeDocumentId={activeDocumentId}
            creatingDocument={documentMutationStatus === "creating"}
            onCursorPositionChange={updateCursorPosition}
            onExecute={(mode) => void executeCurrentCode(mode)}
            onSelectDocument={(documentId) => void selectEditorTab(documentId)}
            onCreateDocument={() => void createEditorTab()}
            onTelemetryEvent={recordEditorTelemetryEvent}
          />
        ) : null}
        <MeetingVideoRoom
          key="meeting-video"
          compact={codeEditorOpen}
          localVideoTiles={localVideoTiles}
          remoteVideoTiles={remoteVideoTiles}
          hiddenAudioTiles={hiddenAudioTiles}
          peerLabel={peerLabel}
          controls={callControls}
        />
      </section>

      {candidateMonitoringRequired ? (
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
          onPlayEvidence={(summary) => void playReviewerEvidence(summary)}
          evidencePlayback={reviewerEvidencePlayback}
        />
      ) : null}

      <Dialog
        open={monitoringConsentOpen}
        title="Interview monitoring consent"
        description="The desktop app must monitor the interview environment for this high-assurance session."
        onOpenChange={(open) => {
          if (!open && monitoringConsentStatus !== "starting") {
            void declineMonitoringConsent();
          }
        }}
        footer={(
          <>
            <Button
              variant="secondary"
              disabled={monitoringConsentStatus === "starting"}
              onClick={() => void declineMonitoringConsent()}
            >
              Decline and leave
            </Button>
            <Button
              loading={monitoringConsentStatus === "starting"}
              onClick={() => void acceptMonitoringConsent()}
            >
              Accept and continue
            </Button>
          </>
        )}
      >
        <p>
          Anecites will check running applications, visible windows, capture-protection flags, and virtualization
          indicators while this interview is active. Only monitoring status and detected risk signals are sent to
          the Anecites backend.
        </p>
        <p>No automatic rejection is made from these signals. Interview evidence requires human review.</p>
        {monitoringConsentStatus === "error" && monitoringHeartbeatError ? (
          <p className="meeting-error" role="alert">{monitoringHeartbeatError}</p>
        ) : null}
      </Dialog>

      <Dialog
        open={mediaConsentOpen}
        title={managingMediaConsent ? "Recording consent" : "Recording and analysis consent"}
        description="Review the current recording terms before continuing this interview."
        onOpenChange={(open) => {
          if (open) {
            setMediaConsentOpen(true);
            return;
          }

          if (mediaConsentStatus === "withdrawing") {
            return;
          }

          if (managingMediaConsent) {
            setMediaConsentOpen(false);
          } else if (mediaConsentStatus !== "granting") {
            void declineMediaConsent();
          }
        }}
        footer={managingMediaConsent ? (
          <>
            <Button
              variant="secondary"
              disabled={mediaConsentStatus === "withdrawing"}
              onClick={() => setMediaConsentOpen(false)}
            >
              Close
            </Button>
            <Button
              variant="secondary"
              loading={mediaConsentStatus === "withdrawing"}
              onClick={() => void withdrawMediaConsentAndLeave()}
            >
              Withdraw consent and leave
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              disabled={mediaConsentStatus === "granting"}
              onClick={() => void declineMediaConsent()}
            >
              Decline and leave
            </Button>
            <Button
              loading={mediaConsentStatus === "granting"}
              disabled={!mediaConsentRequirements || mediaConsentStatus === "error"}
              onClick={() => void acceptMediaConsent()}
            >
              Accept and continue
            </Button>
          </>
        )}
      >
        {mediaConsentRequirements ? (
          <>
            <p>{mediaConsentRequirements.noticeText}</p>
            <p>
              Notice version: <strong>{mediaConsentRequirements.noticeVersion}</strong>
            </p>
            <ul>
              {mediaConsentRequirements.requiredScopes.map((scope) => (
                <li key={scope}>{describeMediaConsentScope(scope)}</li>
              ))}
            </ul>
            <p>No automatic rejection is made from recording or media-analysis evidence. Any signal requires human review.</p>
          </>
        ) : (
          <p>Recording consent requirements could not be loaded. You cannot continue this interview until they are available.</p>
        )}
        {mediaConsentError ? <p className="meeting-error" role="alert">{mediaConsentError}</p> : null}
      </Dialog>

      <Dialog
        open={gazeCalibrationOpen}
        title="Camera calibration"
        description="This creates a calibration record for later server-side evaluation. It does not make an interview decision."
        onOpenChange={(open) => {
          if (gazeCalibrationStatus !== "submitting") {
            setGazeCalibrationOpen(open);
          }
        }}
        footer={gazeCalibrationStatus === "completed" || gazeCalibrationStatus === "abandoned" ? (
          <Button onClick={() => setGazeCalibrationOpen(false)}>Done</Button>
        ) : (
          <>
            <Button
              variant="secondary"
              disabled={gazeCalibrationStatus === "starting" || gazeCalibrationStatus === "submitting"}
              onClick={() => setGazeCalibrationOpen(false)}
            >
              Continue later
            </Button>
            <Button
              loading={gazeCalibrationStatus === "submitting"}
              disabled={
                gazeCalibrationStatus !== "active" ||
                !currentGazeCalibrationTarget ||
                !gazeCalibrationTargetReady
              }
              onClick={() => void acknowledgeCurrentGazeCalibrationTarget()}
            >
              {gazeCalibrationTargetReady ? "Next target" : "Hold position"}
            </Button>
          </>
        )}
      >
        {gazeCalibrationStatus === "active" && gazeCalibration && currentGazeCalibrationTarget ? (
          <>
            <div
              className="gaze-calibration-stage"
              data-target={currentGazeCalibrationTarget}
              role="img"
              aria-label={`Calibration target ${gazeCalibration.steps.length + 1} of ${GAZE_CALIBRATION_TARGETS.length}`}
            >
              <span className="gaze-calibration-target" aria-hidden="true" />
            </div>
            <p aria-live="polite">
              Target {gazeCalibration.steps.length + 1} of {GAZE_CALIBRATION_TARGETS.length}
            </p>
          </>
        ) : gazeCalibrationStatus === "completed" ? (
          <p>Camera calibration is complete. Gaze analysis remains in evaluation mode and cannot make an automatic decision.</p>
        ) : gazeCalibrationStatus === "abandoned" ? (
          <p>The source recording changed. Start a new camera calibration to continue the evaluation study.</p>
        ) : (
          <p>Camera calibration could not be loaded.</p>
        )}
        {gazeCalibrationError ? <p className="meeting-error" role="alert">{gazeCalibrationError}</p> : null}
      </Dialog>
    </main>
  );
}

function describeMediaConsentScope(scope: string): string {
  if (scope === "session_recording") {
    return "The interview room may be recorded.";
  }

  if (scope === "video_face_analysis") {
    return "Candidate video may be analyzed after the interview for face presence and multiple-face review evidence.";
  }

  if (scope === "video_gaze_calibration") {
    return "Candidate video may be used for a camera calibration study in evaluation mode; it cannot make an automatic decision.";
  }

  return "A supported recording scope is required for this interview.";
}

function describeRecordingState(state: "idle" | "active" | "stop_requested" | "completed" | "failed"): string {
  if (state === "active") {
    return "Recording";
  }

  if (state === "stop_requested") {
    return "Finishing recording";
  }

  if (state === "completed") {
    return "Recording complete";
  }

  if (state === "failed") {
    return "Recording failed";
  }

  return "Recording off";
}

function toSharedExecutionResult(submission: CodeExecutionSubmissionRecord): CodeExecutionResult {
  return {
    token: null,
    status: {
      id: 0,
      description: submission.status,
    },
    stdout: submission.stdout,
    stderr: submission.stderr,
    compileOutput: null,
    message: null,
    timeSeconds: submission.timeMs === null ? null : submission.timeMs / 1_000,
    memoryKb: submission.memoryKb,
  };
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
