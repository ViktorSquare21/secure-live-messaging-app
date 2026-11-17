# Test guide: 03 Pure server session core enforces role slots, sender token and increasing seq

## What this covers
The pure session core in `server/src/session-core.ts`, the token hashing in `server/src/token-hash.ts` and the rate limiter in `server/src/rate-limiter.ts`. It verifies every acceptance criterion of `docs/tasks/03-server-session-core.md`: commands return a new state plus effects; publish is accepted only from the bound sender, with a valid envelope and a strictly higher seq; a late receiver gets the latest envelope; a second receiver is refused while a sender with the token takes over; `server_busy` applies at the cap; the rate limiter is pure; idle expiry works.

## Before you start
- Node 24 LTS on the host (`nvm use`), or only Docker. All steps below ran through Docker, because the host had another Node major.
- Install once: `docker compose run --rm dev npm ci` (or `npm ci` on a Node 24 host).
- No app needs to run: the core is not wired to Socket.IO yet (task 04), so there is nothing to see in a browser and no screenshots.

## Automated tests

| Command | Result |
|---|---|
| `docker compose run --rm dev npm test` | shared 262 tests, server 63 (49 new), client 4; all passing |
| `docker compose run --rm dev npm run typecheck` | all three workspaces compile with no errors |
| `docker compose run --rm dev npm audit --omit=dev` | `found 0 vulnerabilities` |

What the new server tests prove:
- `server/src/session-core.test.ts` (40 tests): the full create → join → publish flow, seq 1 and 2 forwarded in order as the same objects, the latest given to a late receiver, `bad_token`, `unknown_session` for both roles, `slot_taken` for a second receiver (with no token and with a wrong one) and for a socket that already holds a slot, receiver and sender takeover, `not_sender` from the receiver, from an unbound socket and from a replaced sender, `stale_seq` for an equal and a lower seq, `invalid_payload` for five malformed envelopes, leave and rejoin, peer status on every join, expiry at and past the TTL, the session cap, purity (input deep-cloned and compared, two calls equal), only hashes stored for both tokens, and a source scan for clock, randomness, logging, timers and socket access.
- `server/src/rate-limiter.test.ts` (6 tests): allows up to the limit, refuses the next, resets after the window, never mutates a frozen input, uses the default limits, and lets 300 ms debounced typing through.
- `server/src/token-hash.test.ts` (3 tests): the SHA-256 digest, a match for the right token only, and no throw on a hash of the wrong length.

## Manual steps
1. Save this as `.scenario.sh` in the repo root. It drives the core through a whole session and prints the effects of each command:
   ```sh
   cd server && npx tsx -e "
   import { runCommand, emptySessionState, DEFAULT_SESSION_CONFIG as cfg } from './src/session-core.ts';
   import { checkRateLimit, DEFAULT_RATE_LIMITS } from './src/rate-limiter.ts';
   import { encodeBase64Url } from '@slm/shared';
   const b = (n: number, f: number) => encodeBase64Url(new Uint8Array(n).fill(f));
   const id = b(16, 1), token = b(32, 2), env = (seq: number) => ({ v: 1, seq, iv: b(12, seq), ct: b(16, seq) });
   let s = emptySessionState();
   const step = (label: string, cmd: any, now = 0) => { const r = runCommand(s, cmd, now, cfg); s = r.state; console.log(label.padEnd(26), JSON.stringify(r.effects.map((e: any) => e.type === 'ack' ? (e.result.ok ? 'ack ok' : 'ack ' + e.result.error) : e.type + '->' + e.socketId + (e.peer ? ':' + e.peer : '')))); };
   step('create', { type: 'create', sessionId: id, senderToken: token });
   step('sender join, wrong token', { type: 'joinSender', sessionId: id, senderToken: b(32, 9), socketId: 's1' });
   step('sender join', { type: 'joinSender', sessionId: id, senderToken: token, socketId: 's1' });
   step('receiver join', { type: 'joinReceiver', sessionId: id, socketId: 'r1', freshRejoinToken: b(32, 3) });
   step('second receiver', { type: 'joinReceiver', sessionId: id, socketId: 'r2', freshRejoinToken: b(32, 4) });
   step('publish seq 1', { type: 'publish', socketId: 's1', envelope: env(1) });
   step('publish seq 1 again', { type: 'publish', socketId: 's1', envelope: env(1) });
   step('publish from receiver', { type: 'publish', socketId: 'r1', envelope: env(2) });
   step('publish bad payload', { type: 'publish', socketId: 's1', envelope: { v: 1 } });
   step('sender takeover', { type: 'joinSender', sessionId: id, senderToken: token, socketId: 's2' });
   step('publish from old sender', { type: 'publish', socketId: 's1', envelope: env(2) });
   step('receiver leave', { type: 'leave', socketId: 'r1' });
   step('sender leave', { type: 'leave', socketId: 's2' }, 1000);
   step('expire at TTL', { type: 'expire' }, 1000 + cfg.idleTtlMs); console.log('sessions:', s.sessions.size);
   step('expire past TTL', { type: 'expire' }, 1001 + cfg.idleTtlMs); console.log('sessions:', s.sessions.size);
   let rl: any; console.log('publish limiter, 11 in 1s:', Array.from({ length: 11 }, (_, i) => { const d = checkRateLimit(rl, i * 50, DEFAULT_RATE_LIMITS.messagePublish); rl = d.state; return d.allowed ? 'y' : 'n'; }).join(''));
   "
   ```
2. Run it in the dev container, then delete the file:
   ```sh
   docker compose run --rm -T dev sh /app/.scenario.sh < /dev/null; rm .scenario.sh
   ```
   **Expected (actual output):**
   ```
   create                     ["ack ok"]
   sender join, wrong token   ["ack bad_token"]
   sender join                ["ack ok","peerStatus->s1:disconnected"]
   receiver join              ["ack ok","peerStatus->r1:connected","peerStatus->s1:connected"]
   second receiver            ["ack slot_taken"]
   publish seq 1              ["ack ok","messageUpdate->r1"]
   publish seq 1 again        ["ack stale_seq"]
   publish from receiver      ["ack not_sender"]
   publish bad payload        ["ack invalid_payload"]
   sender takeover            ["ack ok","disconnect->s1","peerStatus->s2:connected","peerStatus->r1:connected"]
   publish from old sender    ["ack not_sender"]
   receiver leave             ["peerStatus->s2:disconnected"]
   sender leave               []
   expire at TTL              []
   sessions: 1
   expire past TTL            []
   sessions: 0
   publish limiter, 11 in 1s: yyyyyyyyyyn
   ```

## Failure cases
All of them appear in the output above, each answered with a fixed code and no state change:
- A wrong sender token gives `ack bad_token`.
- A second receiver without the rejoin token gives `ack slot_taken`.
- A replayed seq gives `ack stale_seq`.
- A publish from the receiver socket, and from a sender socket that was taken over, gives `ack not_sender`.
- A malformed envelope gives `ack invalid_payload`.
- The 11th publish within one second is refused by the limiter (`n`).
- A session idle for exactly the TTL is kept; one millisecond later it is removed.

## Not covered
- The Socket.IO wiring, acks on the wire, `rate_limited`, id and token generation, the sweep timer and integration tests on a real server: task 04.
- Anything in a browser: there is no page or served build in this task.
