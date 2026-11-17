# [Feature] Pure server session core enforces role slots, sender token and increasing seq

**Role:** Sender, Receiver
**Surface:** Server, Tests
**Estimate:** 40 min
**Depends on:** 02

## Goal
All session rules on the server (who may join, who may publish, which update is accepted, when a session ends) live in one pure, fully unit-tested module that the Socket.IO shell only wires up.

## User story
As a sender, I want only my tab to be able to publish and my receiver to get the current text the moment they join, so that the shared text stays mine and stays live without the server ever needing the key.

## Context
Decision D2 makes the session logic a pure module with the Socket.IO handlers as a thin shell, D5 makes a server-issued sender token the only proof of who may publish, and D7 asks for direct unit tests of this core. Keeping every rule here means task 04 has no branching of its own to test.

## Current behaviour
Doesn't exist.

## Desired behaviour

**Purity rule**
- The core takes the current state, one command and the current time, and returns the new state plus a list of effects. It never reads the clock, generates randomness, logs, or touches sockets, timers or the network.
- Session ids, sender tokens and the current time are generated or read by the shell and passed in with the command. The idle TTL is passed in as configuration, not read from the environment.
- The core never mutates the state it receives; it returns a new one.
- Effects are plain data the shell executes: acknowledge a command with a result (ok plus any data, or an error code), send a message update to a socket, send a peer status to a socket, and disconnect a socket.
- Payload shape is checked with the envelope validator from task 02, which is itself pure.

**State**
- One entry per session id. Each session holds: a hash of the sender token (never the token itself), the socket id holding the sender slot if any, the socket id holding the receiver slot if any, a hash of the current receiver rejoin token if any, the latest accepted envelope if any, the last accepted seq (starting at zero, so the first valid seq is 1), and the time of last activity.
- Roles come only from which slot a socket id is bound to in the state. Nothing in a payload can claim a role.
- A socket holds at most one slot in one session at a time.

**Commands and their rules**
- **Create:** if the number of sessions has reached the session cap, nothing is stored and the ack is `server_busy`. Otherwise it stores a new session under the given id with the hashed token, no slots bound, no latest, and last activity set to now. Acknowledges with the session id and the sender token, so the shell can return them to the creating socket. Creating does not bind the creating socket to the sender slot; the sender joins separately.
- **Join as sender** (session id, token, socket id): unknown session gives `unknown_session`. A token whose hash doesn't match gives `bad_token`; the comparison is constant-time over equal-length hashes. A socket that already holds a slot anywhere gives `slot_taken`. On success the socket is bound to the sender slot, the ack is ok, and both sides get a peer status (the sender learns whether a receiver is present; a present receiver is told the sender is connected).
- **Sender takeover (decision):** if the sender slot is already held by another socket and the token matches, the new socket takes the slot and the old socket gets a disconnect effect. The receiver is not told about a disconnect, because a sender is still present. This lets a reconnecting sender publish again even before the server has noticed the old socket is gone.
- **Join as receiver** (session id, socket id, optional rejoin token, freshly generated rejoin token): unknown session gives `unknown_session`. A socket that already holds a slot anywhere gives `slot_taken`. If the receiver slot is free, the socket is bound, the fresh rejoin token's hash replaces any stored one, and the ack is ok with the fresh rejoin token and the latest envelope when one exists.
- **Receiver takeover (decision, D8):** if the receiver slot is held by another socket and the presented rejoin token matches the stored hash (constant-time), the new socket takes the slot, the old socket gets a disconnect effect, the stored token stays valid, and the ack is ok with the same token and the latest envelope. Without a token, or with a wrong one, an occupied slot gives `slot_taken`, so someone holding only the link cannot kick the receiver. Peer status goes to both sides as for the sender.
- **Publish** (socket id, envelope): the session is found by the socket's sender binding, never by anything in the payload. Checks run in this order: a socket that holds no sender slot gives `not_sender` (this covers the receiver socket and unknown sockets); an envelope that fails the task 02 validator gives `invalid_payload`; a seq that is not strictly greater than the last accepted seq gives `stale_seq` (equal and lower are both rejected). On success the envelope becomes the latest, the last accepted seq becomes its seq, last activity becomes now, the ack is ok, and a present receiver gets a message update with the envelope exactly as received. A rejected publish changes nothing in the state.
- **Leave** (socket id): frees whichever slot the socket holds, sets last activity to now, and sends a disconnected peer status to the other side if present. The session, its latest envelope and its last accepted seq stay, so a sender can rejoin with the token and a receiver can rejoin and get the latest. A socket that holds no slot is a no-op with no effects.
- **Expire** (now): removes every session that has neither slot bound and whose last activity is older than now minus the idle TTL. Sessions with a connected sender or receiver are never expired. Expiry produces no effects, since no sockets are attached.

**Rate limiter**
- A second pure function, separate from the session core, decides whether one more event is allowed. It takes a socket's limiter state for one event type, the current time and a limit (events per window), and returns allowed or not allowed plus the new limiter state. It reads no clock and keeps no state of its own; the shell (task 04) holds the state per socket.
- It is a fixed window: at most the limit within one window, counted from the first event in it; the count resets when the window has passed.

**Values**
- Idle TTL: 30 minutes by default, passed in as configuration.
- Session cap: 1,000 sessions by default, passed in as configuration.
- Rate limits, passed in as configuration: session create at most 5 per minute per socket; message publish at most 10 per second per socket. The sender's 300 ms debounce produces about 3 per second, so normal typing never reaches the limit.
- Last activity is updated by create, both joins, a successful publish and leave. Rejected commands don't update it.

## Security considerations
- **Invariant 1 (key and plaintext never reach the server):** the core only ever handles envelopes as opaque data; it never decrypts, inspects or logs ciphertext, and holds no key.
- **Invariant 3 (only the token holder publishes):** publishing is tied to the socket bound to the sender slot, which only a matching token can bind. Only a hash of the token is stored, and the comparison is constant-time, so neither a memory dump nor timing reveals a usable token.
- **Invariant 4 (one sender, one receiver):** a second receiver gets `slot_taken`. A second sender socket can only replace the first by presenting the token, so there is never more than one sender bound.
- **Invariant 5 (validate shape, don't trust roles):** every envelope passes the task 02 validator before it is stored or forwarded, and roles come only from the server's own slot bindings.
- **Bounded memory:** the session cap, the idle TTL and the one-envelope-per-session rule together bound what the server can be made to hold.
- The sender token is returned only in the create ack to the creating socket and never appears in any other effect.

## Tests
- [x] Unit: create, then sender joins, then receiver joins, then a publish produces an ok ack to the sender and a message update to the receiver carrying the identical envelope.
- [x] Unit: two consecutive publishes with seq 1 and 2 are both accepted and forwarded in order; the latest is the seq 2 envelope.
- [x] Unit: a receiver joining after a publish gets the latest envelope in its ack; a receiver joining before any publish gets an ok ack with no latest.
- [x] Unit: sender join with a wrong token gives `bad_token` and binds nothing; join with an unknown session id gives `unknown_session` for both roles.
- [x] Unit: a second receiver socket gets `slot_taken` while the first is bound, both without a rejoin token and with a wrong one.
- [x] Unit: a receiver socket presenting the current rejoin token takes over the bound slot: the old socket gets a disconnect effect and the new one gets the latest envelope.
- [x] Unit: the stored rejoin token is a hash; the plain token appears only in the join ack effect.
- [x] Unit: publish from the receiver socket, and from an unbound socket, gives `not_sender` and leaves the state unchanged.
- [x] Unit: publish with a duplicate seq and with a lower seq both give `stale_seq`; publish with an invalid envelope gives `invalid_payload`; neither changes the latest.
- [x] Unit: leave by the receiver frees the slot, tells the sender the peer disconnected, and a new receiver can then join and gets the latest.
- [x] Unit: leave by the sender, then a rejoin with the token restores publishing and the next seq must still be higher than the last accepted one.
- [x] Unit: sender takeover with the right token while the old sender socket is still bound gives a disconnect effect for the old socket, and publishing from the old socket afterwards gives `not_sender`.
- [x] Unit: peer status effects on joins tell each side whether the other is present.
- [x] Unit: expire removes a session with no bound slots that has been idle longer than the TTL, keeps one idle for less than the TTL, and keeps one older than the TTL that still has a bound socket.
- [x] Unit: create at the session cap gives `server_busy` and stores nothing; after expire removes a session, create succeeds again.
- [x] Unit: the rate limiter allows events up to the limit within a window, refuses the next one, and allows again once the window has passed; it never mutates the state it is given.
- [x] Unit: the core returns a new state and leaves the input state unchanged; calling it twice with the same inputs gives equal results.
- [x] Unit: the state stores a hash, not the raw sender token, and no effect other than the create ack contains the token.

## Acceptance criteria
- [x] Every command (create, join as sender, join as receiver, publish, leave, expire) returns the new state and a list of effects, and the module contains no clock, randomness, logging or socket access.
- [x] A publish is accepted only from the socket bound to the sender slot, only with a valid envelope and only with a seq strictly higher than the last accepted one; every other publish gets the matching error code and changes nothing.
- [x] A receiver that joins late gets the latest envelope in its join ack, and a present receiver gets every accepted envelope byte-for-byte.
- [x] A second receiver is refused with `slot_taken`, and a sender rejoining with the right token takes over the slot and disconnects the old sender socket.
- [x] Create is refused with `server_busy` at the session cap, and the rate limiter is a pure function with the limits above.
- [x] Sessions with no bound sockets are removed by expire once idle longer than the configured TTL, and never before.
- [x] All the unit tests above pass under `npm test`.

## Out of scope
- Workspace setup and test runner configuration (task 00).
- Encryption, decryption and the AAD binding (task 01).
- Event-name constants, payload types and the envelope validator itself (task 02); this task only calls the validator.
- The Socket.IO server, transport settings, origin allow-list, buffer size limit, generating ids and tokens, running the periodic expiry sweep, and integration tests on a real server (task 04).
- Client services and the receiver state reducer (task 05).
- Any UI (task 06).
- Two-browser end-to-end tests (task 07).
- Security headers and README (task 08).
- Holding limiter state per socket and answering `rate_limited` on the wire (task 04).

## Notes / open questions
- Decision: the idle TTL is 30 minutes, passed in as configuration. Change it if a different lifetime is wanted.
- Decision: expiry only removes sessions with no bound sockets. A connected sender and receiver can stay idle indefinitely; their memory is bounded by open connections.
- Decision: a sender rejoining with the right token while the old sender socket is still bound takes over the slot and the old socket is disconnected. As a result, `sender:join` returns `slot_taken` only when the joining socket already holds a slot.
- Decision (D8): a receiver reconnecting before the server has noticed its old socket is gone proves it is the same receiver with its rejoin token and takes over at once. Without the token, takeover would let anyone with the link kick the real receiver.
- Decision: the core checks a publish in the order not sender, invalid payload, stale seq, so an unauthorised socket never learns the current seq. The shell (task 04) checks the payload shape before calling the core, so over the wire a malformed publish gets `invalid_payload` from any socket; that reveals only the payload rules, which are public.
- Decision: unknown session is checked before the token, so `unknown_session` vs `bad_token` reveals whether an id exists. Session ids are random and already sit in the receiver link, so this leaks nothing useful.
- Decision: creating a session under an id that already exists leaves the existing session untouched and acknowledges with a failure, so the shell can retry with a new id. With random ids of at least 128 bits this should never happen.

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.

---
## Implementation notes

**Built:**
- `server/src/session-core.ts`: `decide(state, command, now, config) → { changes, effects }`, `applyChanges(state, changes) → state`, and `runCommand`, which combines the two into the `{ state, effects }` form the task describes. Commands: `create`, `joinSender`, `joinReceiver`, `publish`, `leave`, `expire`. Defaults: 30 min TTL, 1,000 sessions.
- The state is two maps: sessions by id, and bindings from socket id to `{ sessionId, role }`. The bindings map is the only source of a socket's role, gives an O(1) lookup from a socket to its session, and ensures one slot per socket.
- `server/src/token-hash.ts`: SHA-256 of a token, and a constant-time `timingSafeEqual` comparison over equal-length digests. Both the sender token and the receiver rejoin token are stored only as hashes.
- `server/src/rate-limiter.ts`: a pure fixed-window `checkRateLimit(state, now, limit)`. Defaults: create 5 per 60 s, publish 10 per 1 s.

**Deviations:**
- The task asks each command to return the new state. Doing that literally copies the session map on every publish, which is O(sessions) on the message path and conflicts with the CLAUDE.md performance rule. As decided during planning, `decide` returns a short change list instead, and `applyChanges` builds the new state from it. `runCommand` still returns `{ state, effects }` and is what every test drives. Task 04 can apply the same changes to its own maps in place, so a publish stays O(1).

**Decisions:**
- Creating under an id that already exists acks `server_busy` and changes nothing. That code already exists on the wire, and the shell can retry with a fresh id.
- A successful sender join, including a takeover, always tells a present receiver `connected`; it never tells the receiver `disconnected`.
- A receiver joining a free slot always gets a fresh rejoin token; a presented token is ignored then, as the task says.
- Expiry removes a session only when `now - lastActivity > ttl`; exactly the TTL is kept.
- The rate limiter leaves its state unchanged when it refuses an event, so refused events don't extend the window.
- Hashes are plain `Uint8Array`, not `Buffer`, so a deep clone of the state compares equal in the purity tests.

**Verified or corrected:**
- The first test run failed 7 purity tests: `structuredClone` turns a Node `Buffer` into a plain `Uint8Array`, so the cloned input no longer equalled the original. Fixed by returning a plain `Uint8Array` from `hashToken`.
- On review, the test guide's manual steps failed with `cannot open /app/.scenario.sh`: they asked for the script to be saved by hand before running it. They are now one paste-and-run block that pipes the script into the container, and that block, extracted from the guide, gives output identical to the guide's.
- The acceptance-criteria review found that the test named "returns a new state" never checked for a new state, and for `expire` it couldn't: its fixture had no idle session to remove. The fixture now includes an idle, unbound session, and the test asserts that every command returns a different state. Making `expire` a no-op now fails that test.
- Checked that the tests catch real faults by planting four of them one at a time: accepting an equal seq (2 tests failed), skipping the sender token check (1), skipping the rejoin token check (1), and letting any bound socket publish (2). The source was restored and compared byte for byte with a saved copy.

**Test results:**
- `docker compose run --rm dev npm test`: shared 262, server 63, client 4 tests, all passing.
- `docker compose run --rm dev npm run typecheck`: passes in all three workspaces.
- `docker compose run --rm dev npm audit --omit=dev`: 0 vulnerabilities.
- No lint script in the repo. No browser check: this task touches only the server's pure core.
