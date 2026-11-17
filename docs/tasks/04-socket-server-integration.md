# [Feature] Socket.IO relay server wires the session core to live sender and receiver sockets

**Role:** Sender, Receiver
**Surface:** Server, Tests
**Estimate:** 45 min
**Depends on:** 01, 03

## Goal
A running Socket.IO server relays encrypted updates from one sender to one receiver in real time, enforcing the session rules from the pure session core.

## User story
As a sender, I want every update I publish to reach my receiver within moments and in order, so that the receiver always sees my current text without anyone in between being able to read or forge it.

## Context
Decision D2 makes the session logic a pure module and the Socket.IO handlers a thin shell around it; D1 makes the server a blind ciphertext relay; D5 makes the sender token the only publishing credential. This task is the shell: it turns socket events into session core commands and turns the returned effects into acks and emits. Decision D7 asks for integration tests against a real server on a random port.

## Current behaviour
Doesn't exist. The pure session core (task 03) decides outcomes but nothing is listening on a socket.

## Desired behaviour
- **Transport.** WebSocket only, on both the server and the test clients. A client that tries HTTP long-polling is refused.
- **Origin allow-list.** Connections are accepted only from configured origins. In development the allow-list defaults to the Angular dev server origin on localhost; in production it is read from configuration at startup and defaults to same-origin only. A connection from any other origin is refused before any event is handled.
- **Message size cap.** The Socket.IO maximum buffer size is set just above the envelope size limit from the protocol validators (about 80 KB for the 64 KB envelope cap), so oversize frames are dropped by the transport and slightly-oversize envelopes still reach the validator and get a clean `invalid_payload`.
- **Events and acks.** Every client event from the protocol table (session create, sender join, receiver join, message publish) is handled with an ack carrying the outcome code the session core returns (ok, `unknown_session`, `bad_token`, `slot_taken`, `not_sender`, `invalid_payload`, `stale_seq`, `server_busy`). An event sent without an ack callback is ignored. A payload that fails the shared validators is answered with `invalid_payload` and never reaches the core as a malformed command.
- **Thin shell.** Each handler only: validates the payload with the shared validators, reads the current time, builds a core command, runs the core, stores the new state, and executes the returned effects (ack, emit to a specific socket, join or leave a room). All decisions (role slots, token check, seq ordering, who receives what) stay in the session core. The shell holds no branching of its own beyond routing effects.
- **Rate limits.** Before a session create or a message publish reaches the validators or the core, the shell asks the pure rate limiter from task 03, with the limiter state it keeps for that socket and the current time. A refused event is acked with `rate_limited` and goes no further. The limiter state is dropped when the socket disconnects. The limits come from configuration, so tests can lower them.
- **Randomness is sourced here.** On session create, the shell generates the session id (exactly 16 random bytes) and the sender token (32 random bytes) from a cryptographically secure random source, encodes them as base64url, and passes them into the core's create command. Hashing and constant-time comparison of the token stay in the core.
- **Role comes from the session, never the client.** Publishing is authorised only because this socket earlier joined as sender with the right token; the shell never trusts a role or session id claimed in the publish payload.
- **Relay is byte-for-byte.** The envelope the receiver gets as a message update, and the latest envelope a late receiver gets in its join ack, are exactly what the sender published. The server never decrypts, re-encodes or inspects the ciphertext beyond shape.
- **Peer status.** When the second party joins, both sides get a connected peer status; when a socket disconnects, the shell sends a leave command for it, which frees its slot, and the remaining peer gets a disconnected peer status.
- **Receiver rejoin.** The shell generates a fresh 256-bit rejoin token for every receiver join command and passes it to the core; the core decides whether it is used (D8).
- **Sender reconnect.** A sender whose socket drops can reconnect on a new socket, join again with the same session id and token, and publish again with the next seq.
- **Expiry sweep.** A periodic timer runs the core's expire command with the current time every 60 seconds, using the idle TTL defined in the session core. Expired sessions are dropped. Only sessions with no connected socket can expire, so nobody needs to be told. The interval is configurable so tests can shorten it, and the timer is cleared on server shutdown so tests exit cleanly.
- **Start and stop.** The server can be started on a given port (port 0 picks a free one) and stopped cleanly, so integration tests can run their own instance.
- **Logging.** Logs record only event names, outcome codes, connection and disconnection, and counts. They never include envelope fields (IV, ciphertext), sender tokens, keys, or full payloads, and error logs never dump the payload that caused them.

## Security considerations
- **Invariant 1 (key and plaintext never reach the server):** the server receives only envelopes; logging rules above keep ciphertext and tokens out of logs, and nothing in the shell reads the URL fragment.
- **Invariant 3 (only the token holder publishes):** publish is checked against the socket's joined role in the core; a publish from the receiver socket, or from a socket that never joined, is refused.
- **Invariant 4 (one sender, one receiver):** slot checks live in the core; the shell routes the `slot_taken` outcome to the ack and does not add the socket to the session.
- **Invariant 5 (validate shape and size, never trust the claimed role):** shared validators run before the core; the buffer size cap bounds memory per frame; role comes from session state.
- **Bounded memory and load:** per-socket rate limits and the session cap stop one client from filling the session store or flooding the receiver. The limits are per socket, so many connections from one host are still possible; that is a known limitation.
- **Transport surface:** WebSocket-only and an origin allow-list remove the long-polling surface and cross-site socket use from other origins.
- **Token and id entropy:** both come from a cryptographically secure source, never from a general-purpose random function.

## Tests
- [ ] Integration (real server on port 0, socket.io-client, WebSocket transport): sender creates a session, joins as sender, receiver joins, sender publishes **two consecutive updates** (seq 1 then seq 2), and the receiver gets both message updates in that order with envelopes identical to what was sent.
- [ ] Integration: the sender publishes before any receiver joins; a receiver joining afterwards gets the latest envelope in its join ack, and nothing older.
- [ ] Integration: a publish sent from the receiver socket is acked with `not_sender`, and the sender does not get anything relayed back.
- [ ] Integration: a sender joining with a wrong token gets `bad_token`; a second receiver gets `slot_taken`; joining an unknown session id gets `unknown_session`.
- [ ] Integration: the sender encrypts a real update with the task 01 crypto envelope, flips one ciphertext byte, and publishes it; the receiver gets the envelope byte-for-byte as tampered (the server is blind), and decrypting it with the shared decrypt returns an integrity error.
- [ ] Integration: a publish with a stale or duplicate seq gets `stale_seq` and is not relayed; a malformed envelope gets `invalid_payload` and the server keeps serving other sockets.
- [ ] Integration: the sender disconnects, the receiver gets a disconnected peer status; the sender reconnects on a new socket with the same token, rejoins, the receiver gets a connected peer status, and the next published update reaches the receiver.
- [ ] Integration: with a low configured limit, a socket that sends more session creates than allowed gets `rate_limited` for the extra ones, and a sender that publishes faster than allowed gets `rate_limited` and nothing is relayed for those; a different socket is not affected.
- [ ] Integration: with a session cap of one, a second session create gets `server_busy`.
- [ ] Integration: a client forcing long-polling transport cannot connect, and a client presenting an origin outside the allow-list cannot connect.
- [ ] Integration: a receiver whose old socket is still connected rejoins on a new socket with its rejoin token and receives the next update; the old socket is disconnected. A third socket joining with only the session id gets `slot_taken`.
- [ ] Integration: with a short sweep interval and an injected short TTL, an idle session expires and a later receiver join gets `unknown_session`.

## Acceptance criteria
- [ ] Two consecutive updates published by a sender arrive at the receiver in seq order, unchanged byte-for-byte, over a WebSocket-only connection.
- [ ] A receiver joining late sees the latest envelope immediately in its join ack.
- [ ] A publish from any socket other than the one that joined with the correct sender token is refused with `not_sender`, and nothing is relayed.
- [ ] A tampered envelope is relayed unchanged, and the shared decrypt on the receiver side reports an integrity error.
- [ ] A sender that reconnects with its token can publish again, and the receiver's peer status goes disconnected then connected.
- [ ] A socket that exceeds the create or publish limit gets `rate_limited`, and creates beyond the session cap get `server_busy`.
- [ ] Idle sessions are removed by the periodic sweep, and the sweep timer stops when the server stops.
- [ ] No log line contains an IV, ciphertext, sender token or key.

## Out of scope
- Workspace setup, dev proxy for the socket path and root scripts (task 00).
- The crypto envelope itself; this task only uses it in a test (task 01).
- Event-name constants, payload types and the envelope validator (task 02).
- Session rules: slots, token hashing and comparison, seq ordering, TTL value, effects (task 03).
- The Angular socket service, receiver reducer and sender debounce and resync (task 05).
- Any UI, including peer status display (task 06).
- Two-browser end-to-end tests (task 07).
- Serving the static build, security headers and README (task 08).
- Rate limits per IP address or across sockets, persistence across restarts and multiple receivers.

## Notes / open questions
- Decision: the expiry sweep runs every 60 seconds; the TTL itself is owned by the session core.
- Decision: allowed origins default to the local Angular dev server origin in development and same-origin in production, overridable by configuration at startup.
- Decision: the transport buffer cap is about 80 KB, just above the 64 KB envelope limit, so the validator rather than the transport rejects most oversize envelopes with a readable code.
- Decision: the session id is exactly 16 random bytes and the sender token and receiver rejoin token are 32 random bytes each, all as unpadded base64url. These are the lengths the task 02 validators accept.
- Decision: logs carry event names, outcome codes, connection events and counts only; session ids are not logged either, to keep log lines unlinkable to receiver links.
- Decision: the sweep only removes sessions with no bound sockets (task 03), so no connected socket is ever expired under it and no expiry event is needed.

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.
