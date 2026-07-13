# Free Public Demo

This mode lets an interviewer host Anecites on the development computer while a candidate joins from another device over a temporary HTTPS URL.

## Architecture

```text
Interviewer browser (127.0.0.1:4173)
                 |
Cloudflare Quick Tunnel (temporary HTTPS URL)
                 |
Vite production preview gateway
  /api    -> Express on 127.0.0.1:3100
  /collab -> collaboration WebSocket on 127.0.0.1:3101
                 |
  Piston, PostgreSQL, Redis and MinIO stay on localhost
                 |
  LiveKit Cloud carries remote WebRTC video
```

The public page is candidate-only. Meeting creation is blocked at the public gateway and remains available from the loopback host page.

## Prerequisites

1. Docker Desktop is running.
2. PostgreSQL, Redis, MinIO and Piston are running locally.
3. The pinned Node.js and Python runtimes are installed in Piston.
4. A real `.env` file exists.
5. The `.env` file contains backend-only credentials for a remote LiveKit project:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_URL=https://your-project.livekit.cloud
LIVEKIT_API_KEY=<backend-only-key>
LIVEKIT_API_SECRET=<backend-only-secret>
```

Do not add these values to `.env.example`, source control, or any `VITE_` variable.

## Start

From the repository root, prepare the local infrastructure:

```powershell
docker compose -f .\docker\docker-compose.yml --profile infra --profile piston up -d postgres redis minio piston
```

Build the services once after code changes:

```powershell
npm run demo:public:build
```

Start the public demo:

```powershell
npm run demo:public
```

The launcher prints two addresses:

```text
Host locally: http://127.0.0.1:4173/
Candidate link base: https://random-words.trycloudflare.com/
```

Open the local host address, select **Host interview**, and use **Copy link**. Send the copied link and the separately displayed meeting password to the candidate.

Press `Ctrl+C` in the launcher terminal to stop the API, collaboration server, preview gateway, and temporary tunnel. Docker data volumes are not deleted.

## Verification

On a second device using a different network when possible:

1. Open the copied candidate link.
2. Confirm the meeting code is prefilled and the password is empty.
3. Enter the password and join.
4. Connect video on both devices.
5. Open the code editor from the interviewer side.
6. Confirm edits synchronize in both directions.
7. Run code and confirm output appears without exposing Piston publicly.

## Security Boundaries

- Only the exact generated tunnel hostname is accepted by the preview server.
- The public hostname cannot create meetings.
- Join attempts are rate limited by client address.
- Every public run generates a fresh JWT signing secret.
- Piston, PostgreSQL, Redis, MinIO, the API and collaboration ports remain bound to loopback.
- LiveKit keys and secrets remain backend-only.
- The public URL contains only the meeting code; the password remains separate.

## Limitations

- Cloudflare Quick Tunnel URLs change every time the launcher starts.
- Quick Tunnels are intended for development and demonstrations, not production uptime.
- The host computer and Docker services must remain running for the entire interview.
- Remote video requires remote LiveKit credentials. Local LiveKit cannot provide reliable Internet WebRTC through this HTTP tunnel.
- A stable production deployment still needs a domain, durable hosting, monitoring, backups and operational hardening.
