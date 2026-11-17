# Implementation plan

## Flow
1. The sender opens `/` and clicks **New session**. The browser generates an AES-GCM-256 key, and the server returns `{ sessionId, senderToken }` (via a Socket.IO ack).
2. The sender page shows the receiver link `https://host/r/<sessionId>#<base64url key>` with a copy button. The sender passes the link to the receiver on another platform (chat, email); the app has no way to send it and never sees where it goes.
3. The sender types into the text input, the only editable field in the app. Input is debounced (~300 ms), then encrypted with `seq = lastSeq + 1` and published. The server stores it as `latest` and forwards it to the receiver.
4. The receiver opens the link, reads the key from `location.hash`, joins, gets `latest` immediately, then gets every update as it arrives. The receiver page only displays the text; it has no input and sends nothing back.

## Protocol (Socket.IO events, all with acks)
| Event | From | Payload | Ack / effect |
|---|---|---|---|
| `session:create` | sender | – | `{ sessionId, senderToken }` |
| `sender:join` | sender | `{ sessionId, senderToken }` | ok / `unknown_session` / `bad_token` / `slot_taken` |
| `receiver:join` | receiver | `{ sessionId, rejoinToken? }` | ok + `rejoinToken` + `latest?` / `unknown_session` / `slot_taken` |
| `message:publish` | sender | `Envelope` | ok / `not_sender` / `invalid_payload` / `stale_seq` |
| `message:update` | server → receiver | `Envelope` | – |
| `peer:status` | server → both | `{ peer: 'connected' \| 'disconnected' }` | – |

`Envelope = { v: 1, seq: number, iv: base64url(12 bytes), ct: base64url }`. The server checks only the shape, a size limit (e.g. 64 KB) and that `seq` increases.

## Crypto (shared/)
- AES-GCM-256 via WebCrypto. A fresh random 96-bit IV for each message.
- AAD = `slm:v1|<sessionId>|<seq>`. A ciphertext moved to another session or given a different seq fails the auth tag.
- Receiver rule: show the text only when decryption succeeds **and** `seq > lastAcceptedSeq`. Otherwise keep the last good text and show an integrity warning.
- Key: exported raw, then base64url-encoded into the URL fragment. It's imported as non-extractable on the receiver side.

## Server session core (pure)
`state + command + now → { state, effects[] }`, with commands `create | joinSender | joinReceiver | publish | leave | expire`. The Socket.IO shell turns socket events into commands and turns effects into emits and acks. Random ids and tokens are generated in the shell and passed in.

---

## Tasks

### T0. Scaffold (25 min)
- npm workspaces: `shared`, `server`, `client`. Root scripts `dev`, `test`, `e2e`.
- Angular LTS + Material (standalone components, Vitest runner). Server on Node + TS (`tsx` for dev).
- Dev proxy from Angular to the server for `/socket.io` with `ws: true`.
- **Done when:** `npm test` runs empty suites in all three workspaces.

### T1. Crypto envelope in `shared/` (30 min)
- `generateKey`, `exportKeyToFragment`, `importKeyFromFragment`, `encrypt(key, sessionId, seq, plaintext)`, `decrypt(key, sessionId, envelope)` returning a result (`ok | integrity_error | malformed`), never throwing to the UI.
- **Tests:** round-trip; a flipped ciphertext bit is rejected; a flipped IV bit is rejected; the wrong key is rejected; changed seq or a different sessionId (AAD) is rejected; a malformed fragment is rejected; the same plaintext encrypted twice gives different IVs.

### T2. Protocol types + validators in `shared/` (10 min)
- Event-name constants, payload types, `isValidEnvelope` (shape, base64url, IV length, size cap).
- **Tests:** accepts a valid envelope; rejects oversize, wrong types, a bad IV length and extra fields.

### T3. Server session core, pure (35 min)
- Reducer over `Map<sessionId, Session>`. Session = `{ senderTokenHash, senderSocketId?, receiverSocketId?, latest?, lastSeq, lastActivity }`.
- Constant-time token comparison. Idle sessions expire after a TTL (pass `now` in).
- **Tests:** create → join both → publish forwards to the receiver; a late receiver gets `latest`; a wrong token is rejected; a second receiver gets `slot_taken`; a receiver cannot publish; stale or duplicate seq is rejected; disconnect frees the slot; expire removes idle sessions.

### T4. Socket.IO shell + integration tests (35 min)
- `transports: ['websocket']`, origin allow-list, `maxHttpBufferSize` set, ack-based handlers, and a periodic expiry sweep.
- **Integration tests** (real server on port 0, `socket.io-client`): the full sender → receiver flow with **two consecutive updates** arriving in order; a receiver joining late gets the latest; forged publish from the receiver socket fails; a tampered envelope is relayed byte-for-byte (the server is blind) and the client-side decrypt rejects it; reconnecting the sender with its token restores publishing.

### T5. Angular services + pure receiver state (30 min)
- `SessionSocketService` wraps `socket.io-client` as Observables (`connect`, `emitWithAck`, `on$`).
- `receiverReducer(state, incoming, decryptResult)` is pure and returns `{ text, lastSeq, status: 'waiting' | 'live' | 'integrity_error' | 'disconnected' }`.
- Sender: `debounceTime` + `distinctUntilChanged` → encrypt → publish; seq increases monotonically, and sending is resent after reconnect.
- **Tests:** reducer cases (valid, tampered, replayed seq, out of order); debounce sends only the latest text (fake timers); resync after reconnect.

### T6. Angular UI with Material (40 min)
- `/` Home: a "New session" button.
- `/s/:id` Sender: a multi-line text input, the receiver link with a copy button (the sender shares it on another platform), peer status chip, last-sent indicator.
- `/r/:id` Receiver: the text shown as plain displayed text that updates live (not an input field), status chip, a red integrity banner on rejection, and a clear error for a missing or invalid key.
- Render text as plain text only (Angular interpolation, never `innerHTML`).

### T7. Playwright E2E (20 min)
- Two browser contexts. The sender creates a session, the receiver opens the link, and two consecutive updates show up in the receiver without a reload.
- Receiver with a corrupted `#key` → error state and no plaintext shown.

### T8. Hardening + README (25 min)
- Server security headers on the static build: strict CSP (`connect-src 'self'`), `Referrer-Policy: no-referrer`, `X-Content-Type-Options`.
- README: architecture diagram, decisions D1–D8, threat model (what the server can and can't do), tests and how to run them, limitations, AI usage section.

**Total ≈ 4h10.** If time runs short, cut T6 polish first, then the reconnect test in T5. Never cut T1, T3/T4 or T7, because they cover the core requirements.

## Known limitations (README material)
- The key in the fragment ends up in browser history and in anything the link is pasted into. Possible fix: `history.replaceState` to strip it after import.
- The server operator can see metadata: timing, message sizes, IPs.
- A malicious server could serve modified JS. Whole-app integrity (SRI or a signed build) is out of scope.
- The sender token proves only who may publish to the server. Receiver-verifiable authorship would need signatures.
- Everything is in memory: a server restart ends all sessions.
