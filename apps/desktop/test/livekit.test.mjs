import assert from "node:assert/strict";
import test from "node:test";

import {
  attachLiveKitMediaTrack,
  connectLiveKitRoom,
  detachLiveKitMediaTrack,
  observeLiveKitRoomEvents,
  publishLiveKitCameraAndMicrophone,
  requestLiveKitToken,
  runDisplayMediaSelfCheck,
  setLiveKitScreenShare,
} from "../dist/livekit.js";

test("requestLiveKitToken requests a backend-issued token without LiveKit credentials", async () => {
  const calls = [];
  const result = await requestLiveKitToken(
    {
      apiBaseUrl: "http://127.0.0.1:3000",
      authToken: "session-jwt",
      sessionId: "session-a",
      participantId: "participant-a",
    },
    async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          livekit: {
            url: "ws://127.0.0.1:7880",
            roomName: "session-session-a",
            participantIdentity: "participant-participant-a",
            token: "livekit-join-token",
          },
        }),
        {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    },
  );

  assert.deepEqual(result, {
    url: "ws://127.0.0.1:7880",
    roomName: "session-session-a",
    participantIdentity: "participant-participant-a",
    token: "livekit-join-token",
  });
  assert.equal(calls[0].url, "http://127.0.0.1:3000/sessions/session-a/livekit-token");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer session-jwt");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    participantId: "participant-a",
  });
  assert.equal(JSON.stringify(calls[0]).includes("LIVEKIT_API_SECRET"), false);
});

test("requestLiveKitToken rejects backend and invalid LiveKit token responses", async () => {
  await assert.rejects(
    () =>
      requestLiveKitToken(
        {
          apiBaseUrl: "http://127.0.0.1:3000",
          authToken: "session-jwt",
          sessionId: "session-a",
          participantId: "participant-a",
        },
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "LIVEKIT_NOT_CONFIGURED",
                message: "LiveKit is not configured",
              },
            }),
            {
              status: 503,
              headers: {
                "Content-Type": "application/json",
              },
            },
          ),
      ),
    /LiveKit is not configured/,
  );

  await assert.rejects(
    () =>
      requestLiveKitToken(
        {
          apiBaseUrl: "http://127.0.0.1:3000",
          authToken: "session-jwt",
          sessionId: "session-a",
          participantId: "participant-a",
        },
        async () =>
          new Response(JSON.stringify({ livekit: { token: "missing-fields" } }), {
            status: 201,
            headers: {
              "Content-Type": "application/json",
            },
          }),
      ),
    /LiveKit token response is invalid/,
  );
});

test("connectLiveKitRoom connects an injected room with the backend-issued token", async () => {
  const calls = [];
  const room = {
    async connect(url, token) {
      calls.push({ url, token });
    },
  };

  await connectLiveKitRoom(room, {
    url: "ws://127.0.0.1:7880",
    roomName: "session-session-a",
    participantIdentity: "participant-participant-a",
    token: "livekit-join-token",
  });

  assert.deepEqual(calls, [
    {
      url: "ws://127.0.0.1:7880",
      token: "livekit-join-token",
    },
  ]);
});

test("publishLiveKitCameraAndMicrophone enables local camera and microphone", async () => {
  const calls = [];

  await publishLiveKitCameraAndMicrophone({
    localParticipant: {
      async enableCameraAndMicrophone() {
        calls.push("combined");
      },
    },
  });

  assert.deepEqual(calls, ["combined"]);

  const fallbackCalls = [];
  await publishLiveKitCameraAndMicrophone({
    localParticipant: {
      async setCameraEnabled(enabled) {
        fallbackCalls.push(["camera", enabled]);
      },
      async setMicrophoneEnabled(enabled) {
        fallbackCalls.push(["microphone", enabled]);
      },
    },
  });

  assert.deepEqual(fallbackCalls, [
    ["camera", true],
    ["microphone", true],
  ]);

  await assert.rejects(
    () => publishLiveKitCameraAndMicrophone({}),
    /does not support local media/,
  );
});

test("attachLiveKitMediaTrack prepares attached media and detachLiveKitMediaTrack detaches it", () => {
  const detached = [];
  const element = {
    autoplay: false,
    controls: true,
  };
  const track = {
    attach() {
      return element;
    },
    detach() {
      detached.push("detached");
    },
  };

  assert.equal(attachLiveKitMediaTrack(track), element);
  assert.equal(element.autoplay, true);
  assert.equal(element.controls, false);

  detachLiveKitMediaTrack(track);
  assert.deepEqual(detached, ["detached"]);
});

test("runDisplayMediaSelfCheck verifies capture support and stops captured tracks", async () => {
  const calls = [];
  const stopped = [];
  const result = await runDisplayMediaSelfCheck(async (constraints) => {
    calls.push(constraints);
    return {
      getTracks() {
        return [
          {
            stop() {
              stopped.push("video-track");
            },
          },
        ];
      },
    };
  });

  assert.deepEqual(calls, [
    {
      video: true,
      audio: false,
    },
  ]);
  assert.deepEqual(result, {
    trackCount: 1,
  });
  assert.deepEqual(stopped, ["video-track"]);
});

test("runDisplayMediaSelfCheck rejects missing display media support and empty captures", async () => {
  await assert.rejects(
    () => runDisplayMediaSelfCheck(null),
    /Screen capture is not available/,
  );

  await assert.rejects(
    () =>
      runDisplayMediaSelfCheck(async () => ({
        getTracks() {
          return [];
        },
      })),
    /Screen share self-check did not capture a track/,
  );
});

test("setLiveKitScreenShare toggles screen sharing through the local participant", async () => {
  const calls = [];
  const room = {
    localParticipant: {
      async setScreenShareEnabled(enabled) {
        calls.push(enabled);
      },
    },
  };

  await setLiveKitScreenShare(room, true);
  await setLiveKitScreenShare(room, false);

  assert.deepEqual(calls, [true, false]);
});

test("observeLiveKitRoomEvents maps reconnect events to audio-priority degradation", () => {
  const listeners = new Map();
  const room = {
    on(event, handler) {
      listeners.set(event, handler);
    },
    off(event, handler) {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    },
  };
  const statuses = [];
  const mediaModes = [];
  const cleanup = observeLiveKitRoomEvents(room, {
    onConnectionStatus(status) {
      statuses.push(status);
    },
    onMediaMode(mode) {
      mediaModes.push(mode);
    },
  });

  listeners.get("signalReconnecting")();
  listeners.get("reconnecting")();
  listeners.get("reconnected")();
  listeners.get("disconnected")();

  assert.deepEqual(statuses, [
    "reconnecting",
    "reconnecting",
    "connected",
    "disconnected",
  ]);
  assert.deepEqual(mediaModes, [
    "audio-priority",
    "audio-priority",
    "normal",
    "audio-priority",
  ]);

  cleanup();
  assert.equal(listeners.size, 0);
});

test("observeLiveKitRoomEvents forwards renderable media track events", () => {
  const listeners = new Map();
  const room = {
    on(event, handler) {
      listeners.set(event, handler);
    },
    off(event, handler) {
      if (listeners.get(event) === handler) {
        listeners.delete(event);
      }
    },
  };
  const events = [];
  const videoTrack = { kind: "video", sid: "track-video" };
  const audioTrack = { kind: "audio", sid: "track-audio" };
  const dataTrack = { kind: "data", sid: "track-data" };
  const participant = { identity: "participant-a" };
  const cleanup = observeLiveKitRoomEvents(room, {
    onConnectionStatus() {},
    onMediaMode() {},
    onTrackSubscribed(track, publication, eventParticipant) {
      events.push(["subscribed", track.sid, publication.trackSid, eventParticipant.identity]);
    },
    onTrackUnsubscribed(track, publication, eventParticipant) {
      events.push(["unsubscribed", track.sid, publication.trackSid, eventParticipant.identity]);
    },
    onLocalTrackPublished(track, publication, eventParticipant) {
      events.push(["local-published", track.sid, publication.trackSid, eventParticipant.identity]);
    },
    onLocalTrackUnpublished(track, publication, eventParticipant) {
      events.push(["local-unpublished", track.sid, publication.trackSid, eventParticipant.identity]);
    },
  });

  listeners.get("trackSubscribed")(videoTrack, { trackSid: "remote-video" }, participant);
  listeners.get("trackSubscribed")(dataTrack, { trackSid: "remote-data" }, participant);
  listeners.get("trackUnsubscribed")(videoTrack, { trackSid: "remote-video" }, participant);
  listeners.get("localTrackPublished")({ trackSid: "local-audio", track: audioTrack }, participant);
  listeners.get("localTrackUnpublished")({ trackSid: "local-audio", track: audioTrack }, participant);

  assert.deepEqual(events, [
    ["subscribed", "track-video", "remote-video", "participant-a"],
    ["unsubscribed", "track-video", "remote-video", "participant-a"],
    ["local-published", "track-audio", "local-audio", "participant-a"],
    ["local-unpublished", "track-audio", "local-audio", "participant-a"],
  ]);

  cleanup();
  assert.equal(listeners.size, 0);
});
