import assert from "node:assert/strict";
import test from "node:test";

import {
  connectLiveKitRoom,
  observeLiveKitRoomEvents,
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
