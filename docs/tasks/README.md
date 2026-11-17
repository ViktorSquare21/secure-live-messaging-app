# Tasks

Written by the `secure-live-messaging-task-intake` skill from `docs/implementation-plan.md`.

| # | Title | Type | Surface | Estimate | Depends on | Status |
|---|---|---|---|---|---|---|
| [00](00-project-scaffold.md) | Set up the workspaces, test runners, WebSocket dev proxy and a Docker setup to run the app | Feature | Shared, Server, Client, Tests | 35 min | – | Done |
| [01](01-crypto-envelope.md) | Shared AES-GCM-256 envelope with key-in-fragment encoding and non-throwing decrypt | Feature | Shared, Tests | 30 min | 00 | Done |
| [02](02-protocol-types-validators.md) | Shared protocol contract with strict validators for envelopes and join payloads | Feature | Shared, Tests | 10 min | 00, 01 | Done |
| [03](03-server-session-core.md) | Pure server session core enforces role slots, sender token and increasing seq | Feature | Server, Tests | 40 min | 02 | Done |
| [04](04-socket-server-integration.md) | Socket.IO relay server wires the session core to live sender and receiver sockets | Feature | Server, Tests | 45 min | 01, 03 | Todo |
| [05](05-client-session-services.md) | Client session services: debounced encrypted publishing and pure receiver state | Feature | Client, Tests | 30 min | 01, 02 | Todo |
| [06](06-sender-receiver-ui.md) | Home, sender and receiver pages with Material, plain-text rendering and clear error states | Feature | Client, Tests | 40 min | 05 | Todo |
| [07](07-end-to-end-tests.md) | Two-browser end-to-end tests for live updates and a corrupted key link | Feature | Tests | 20 min | 04, 06 | Todo |
| [08](08-security-headers-readme.md) | Server sends strict security headers on the built app, and the README documents architecture, threat model and AI usage | Feature | Server, Client, Tests, Docs | 25 min | 04, 07 | Todo |

**Total:** 275 min.

## Schedule

| Step | Task | Minutes | Mode |
|---|---|---|---|
| 1 | 00 Scaffold | 35 | Serial |
| 2 | 01 Crypto envelope | 30 | Serial |
| 3 | 02 Protocol types and validators | 10 | Serial, after 01 |
| 4a | 03 Session core, then 04 Socket.IO server | 85 | Parallel lane A (`server/` only) |
| 4b | 05 Client services, then 06 Pages | 70 | Parallel lane B (`client/` only) |
| 5 | 07 End-to-end tests | 20 | Serial |
| 6 | 08 Headers and README | 25 | Serial |

Elapsed time is about 205 minutes with the parallel window, against 275 fully serial. Working alone, the numbered order 00 to 08 is the right serial order.

### Decisions

- **Only one window runs in parallel: 03 + 04 alongside 05 + 06.** The two lanes touch different workspaces and meet only through `shared/`, which is finished by then. The client services are tested against a fake socket, so they don't need the real server.
- **01 and 02 run one after the other, 01 first.** The validators in 02 reuse the base64url codec that 01 owns, and the envelope type that 01 defines. Both edit the same `shared/` exports, and 02 is only 10 minutes, so running them in parallel costs more in merging than it saves.
- **07 waits for both lanes.** It drives the real pages against the real server.
- **08 comes last.** Its end-to-end check runs against the production build, and it changes server files that 04 creates.
- **The parallel window needs git with two worktrees**, one per lane. Each lane stays inside its own workspace and doesn't edit `shared/`; a change needed there is made once, before or after the window.
- **The 70 minutes saved is a best case.** Reviewing both lanes is still serial work for one person.
