import { useEffect, useRef, type ReactElement, type ReactNode } from "react";

import {
  type ScreenShareStatus,
  type VideoStatus,
  type LiveKitMediaTile,
} from "./meeting-types.js";

export interface MeetingCallControlsProps {
  videoStatus: VideoStatus;
  screenShareStatus: ScreenShareStatus;
  onConnectVideo: () => void;
  onDisconnectVideo: () => void;
  onCheckScreenShare: () => void;
  onStartScreenShare: () => void;
  onStopScreenShare: () => void;
}

export function MeetingCallControls({
  videoStatus,
  screenShareStatus,
  onConnectVideo,
  onDisconnectVideo,
  onCheckScreenShare,
  onStartScreenShare,
  onStopScreenShare,
}: MeetingCallControlsProps): ReactElement {
  return (
    <div className="meeting-call-controls" aria-label="Call controls">
      <button
        type="button"
        onClick={onConnectVideo}
        disabled={videoStatus === "connecting" || videoStatus === "connected" || videoStatus === "reconnecting"}
      >
        Connect camera
      </button>
      <button type="button" onClick={onDisconnectVideo} disabled={videoStatus !== "connected"}>
        Disconnect
      </button>
      <button type="button" onClick={onCheckScreenShare} disabled={screenShareStatus === "checking"}>
        Check screen
      </button>
      <button
        type="button"
        onClick={onStartScreenShare}
        disabled={videoStatus !== "connected" || screenShareStatus === "sharing"}
      >
        Share screen
      </button>
      <button type="button" onClick={onStopScreenShare} disabled={screenShareStatus !== "sharing"}>
        Stop share
      </button>
    </div>
  );
}

export interface MeetingVideoRoomProps {
  localVideoTiles: readonly LiveKitMediaTile[];
  remoteVideoTiles: readonly LiveKitMediaTile[];
  hiddenAudioTiles: ReactNode;
  peerLabel: string;
  controls: ReactNode;
  compact?: boolean;
}

export function MeetingVideoRoom({
  localVideoTiles,
  remoteVideoTiles,
  hiddenAudioTiles,
  peerLabel,
  controls,
  compact = false,
}: MeetingVideoRoomProps): ReactElement {
  return (
    <section
      className={compact ? "candidate-video-room candidate-video-room--compact" : "candidate-video-room"}
      aria-label="Interview video call"
    >
      <div className={compact ? "candidate-video-stage candidate-video-stage--compact" : "candidate-video-stage"}>
        <MeetingVideoCard tile={remoteVideoTiles[0]} label={peerLabel} priority="primary" />
        <MeetingVideoCard tile={localVideoTiles[0]} label="You" priority="secondary" />
        {remoteVideoTiles.slice(1).map((tile) => (
          <MeetingVideoCard key={tile.id} tile={tile} label={tile.participantName} priority="secondary" />
        ))}
        {hiddenAudioTiles}
      </div>
      {controls}
    </section>
  );
}

export type MeetingVideoRailProps = MeetingVideoRoomProps;

export function MeetingVideoRail({
  localVideoTiles,
  remoteVideoTiles,
  hiddenAudioTiles,
  peerLabel,
  controls,
}: MeetingVideoRailProps): ReactElement {
  return (
    <aside className="candidate-video-rail" aria-label="Video call">
      <div className="candidate-video-rail-feed">
        <MeetingVideoCard tile={localVideoTiles[0]} label="You" />
        <MeetingVideoCard tile={remoteVideoTiles[0]} label={peerLabel} />
        {remoteVideoTiles.slice(1).map((tile) => (
          <MeetingVideoCard key={tile.id} tile={tile} label={tile.participantName} />
        ))}
        {hiddenAudioTiles}
      </div>
      {controls}
    </aside>
  );
}

export function MeetingVideoCard({
  tile,
  label,
  priority = "secondary",
}: {
  tile: LiveKitMediaTile | undefined;
  label: string;
  priority?: "primary" | "secondary";
}): ReactElement {
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

export function LiveKitMediaTileView({ tile }: { tile: LiveKitMediaTile }): ReactElement {
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
    return <div className="video-audio-slot" ref={slotRef} aria-label={`${tile.participantName} audio`} />;
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
