# Test guide: 05 Client session services: debounced encrypted publishing and pure receiver state

## What this covers
The UI-free client services: the Socket.IO wrapper, the pure receiver state transition, the receiver service and the sender service. It verifies all seven acceptance criteria of `docs/tasks/05-client-session-services.md`: the pure transition, serialised publishes, one publish per 300 ms pause, rejection of tampered, malformed, replayed or older envelopes, automatic rejoin after a drop, reload resume without a reused seq, and no key or plaintext in anything emitted.

## Before you start
- Docker. The host may run any Node version; every command below runs in the Node 24 dev container (`.nvmrc`).
- Build the container once: `docker compose build dev`.

## Automated tests
```sh
docker compose run --rm dev npm test
docker compose run --rm dev npm run typecheck
docker compose run --rm dev npm audit --omit=dev
```
Result: shared 262, server 113, client 85 tests, all passing; the type check passes in all three workspaces; the audit finds 0 vulnerabilities.

The tests for this task are the six spec files under `client/src/app/session/` (81 of the 85 client tests). The service specs use a fake socket, an in-memory storage, Vitest fake timers for the debounce, and real WebCrypto.

## Manual steps
1. Run only the session specs with the verbose reporter:
   ```sh
   docker compose run --rm -T dev npm test -w @slm/client -- --include 'src/app/session/**/*.spec.ts' --reporters verbose < /dev/null
   ```
   **Expected:** `Test Files  6 passed (6)` and `Tests  81 passed (81)`. Each test name states a rule. Check these lines in the output:
   - `receiver-state.spec.ts`: 18 tests, from `moves waiting to live with the text and seq of a valid first envelope` to `never mutates the state it is given and always returns a new object`.
   - `sender-session.service.spec.ts`: `publishes once with only the latest text when several values are typed within 300 ms`, `publishes seq n and n+1 for two debounced changes and does not republish the same text`, `serialises publishes behind a held ack and skips the middle text that went stale`, `rejoins with its token after a reconnect and republishes the unacknowledged text with a higher seq`, `resumes after a reload from sessionStorage and publishes with a higher seq than before`.
   - `receiver-session.service.spec.ts`: `applies updates strictly in arrival order even when the first decrypt is slower`, `keeps the text on disconnect, then rejoins with the token from its first join and shows no false warning`.
   - `session-socket.spec.ts`: `uses only the WebSocket transport and waits for an explicit connect`, `fails at once instead of buffering an emit while disconnected`.

## Failure cases
These run in the same command as above; all pass.

1. Tampered update: `keeps the text and shows integrity error for a tampered update, then recovers on a valid newer one`.
   **Expected:** the state keeps the previous text, the status is `integrity_error`, and the tampered text never appears in the state.
2. Replay and invalid envelopes: `rejects a replayed update and one that fails the validator without throwing`, plus the pure cases `rejects a replayed update with the same seq…` and `rejects an out-of-order update with a lower seq…`.
   **Expected:** nothing throws, and the text stays on the last accepted one.
3. Older latest on rejoin: `applies a newer latest on rejoin and flags an older one`.
   **Expected:** seq 4 is applied; a later rejoin returning seq 2 sets `integrity_error` and keeps the seq 4 text.
4. Bad key: `enters key error and never joins for the fragment …` (four fragments).
   **Expected:** error `invalid_key`, no connect call, nothing emitted.
5. Server rejections: the `surfaces a … publish rejection`, `reports … when the session cannot be created`, `reports a … sender join failure` and `surfaces a … join failure` tests, plus the malformed-ack tests.
   **Expected:** each becomes the matching error code, or `protocol_error` for a malformed ack.
6. Nothing secret on the wire: `keeps the sender token out of the receiver link and every payload but the sender join`, `never emits the plaintext or the key fragment, and logs nothing`, and `sends nothing but join payloads, never the key fragment or any plaintext`.
   **Expected:** the recorded emits, serialised as JSON, contain neither the plaintext nor the key fragment, and no console method is called.

## Not covered
- Anything in a browser. This task adds no page or route, so there is no browser check and no screenshot; the pages come in task 06.
- The services against the real server. The specs use a fake socket; the two-browser end-to-end tests against the real server come in task 07.
