# [Feature] Client session services: debounced encrypted publishing and pure receiver state

**Role:** Sender, Receiver
**Surface:** Client, Tests
**Estimate:** 30 min
**Depends on:** 01, 02

## Goal
The Angular app has tested, UI-free services that let the sender publish encrypted text as it types and let the receiver show only authentic, newer text, including across reconnects.

## User story
As a sender, I want my text encrypted and sent shortly after I stop typing, so that the receiver sees it live. As a receiver, I want to see only text that decrypts and is newer than what I already have, so that tampered or replayed messages never replace the real text.

## Context
The pages in task 06 need a socket connection, a sender pipeline and a receiver state to bind to. Keeping the receiver's accept-or-reject decision in a pure function (implementation plan T5, security invariants 2 and 7) makes the most security-critical client rule testable without a browser, a socket or WebCrypto mocks.

## Current behaviour
Doesn't exist.

## Desired behaviour

**Socket wrapper**
- One injectable service wraps the Socket.IO client and exposes it as Observables: connect, emit-with-ack and a stream per incoming event.
- It connects with the WebSocket transport only (decision D2) to the same origin, and uses the event names and payload types from task 02 rather than string literals.
- It exposes the connection state (connected, disconnected, reconnected) so the session services can resync.
- It stays thin: no session rules live here, so the session services are tested against a fake of it.

**Pure receiver state**
- The receiver state holds the last accepted text, the last accepted seq and a status: waiting, live, integrity error or disconnected. It starts as waiting, with empty text and no accepted seq.
- The transition takes the current state, the incoming event and the decrypt result from task 01, and returns the next state. It does no I/O and does not decrypt itself.
- An incoming envelope is accepted only when decryption returns ok **and** its seq is higher than the last accepted seq. Then the text and seq are replaced and the status becomes live.
- A decrypt result of integrity error or malformed, an envelope that fails the task 02 validator, or a seq equal to or lower than the last accepted one keeps the previous text and seq and sets the status to integrity error.
- Decision: a valid newer update after an integrity error returns the status to live. The receiver keeps listening; it does not stop the session.
- Decision: the latest envelope delivered on a rejoin after a reconnect is a resync, not an update. If it carries the same seq as the last accepted one it is ignored without a warning; a lower seq still sets integrity error.
- Losing the server connection sets the status to disconnected and keeps the text; reconnecting and rejoining returns it to live (or waiting if nothing was accepted yet).
- Peer status (sender connected or disconnected) is exposed as a separate stream and does not change the receiver status.

**Receiver service (shell)**
- Imports the key from the link fragment via task 01. A missing or invalid key puts the service in a distinct key error state and it never joins the session.
- Joins as receiver, feeds the latest envelope (if any) and every update through decrypt, then the pure transition.
- Decrypts and applies messages strictly one at a time, in arrival order, so a slow decrypt can never let an older message land after a newer one.
- Join failures (unknown session, slot taken) surface as an error state the page can show.
- On reconnect it rejoins as receiver with its rejoin token and applies the returned latest envelope as a resync. The rejoin token from the join ack is kept in the receiver tab's sessionStorage, keyed by session id, so a reload rejoins the same way.

**Sender service (shell)**
- Creates the session (the server returns the session id and sender token), generates the key, builds the receiver link with the key in the fragment, and joins as sender with the token.
- Text input is debounced by 300 ms and repeated identical text is dropped, then encrypted with seq set to last seq plus one and published. Seqs go out strictly increasing, one publish at a time, never reused.
- Decision: publishes are serialised with RxJS `concatMap`, not `switchMap`.
  - "Latest text wins" looks like type-ahead search, but type-ahead cancels reads, which is harmless. A publish is a write.
  - Cancelling a publish can't recall an emit already on the wire. It only drops that publish's ack, so rejections go unseen and the last-sent time is wrong.
  - If the emit runs in the encryption promise's callback, an older envelope can also leave after a newer one and be rejected as stale seq.
- "Latest wins" comes from two places instead:
  - The 300 ms debounce means most intermediate texts are never published.
  - Inside the serialised step, a queued text that is no longer the latest typed text is skipped before encryption, so it uses no seq.
- The seq is assigned inside the serialised step, at send time, never when a text is queued.
- Empty text is a valid update and is published, so clearing the box clears the receiver.
- Text whose envelope would exceed the task 02 size cap is not published; the service reports a too-long state instead.
- It exposes the last-sent time (on a successful ack), peer status, and an error state for ack failures: not sender, bad token, slot taken, stale seq, unknown session (the session has ended, for example after a server restart), rate limited, and server busy on session create.
- On reconnect it rejoins with its token, then publishes the current text with a new seq if the last text was not acknowledged.
- Decision: the session id, sender token, key fragment and last used seq are kept in sessionStorage for the sender tab, so a page reload resumes the same session. The last used seq is stored before each publish, so a reload never reuses a seq. If nothing is stored for the session the sender page opens, the service reports that the session can't be resumed.

## Security considerations
- Invariant 1: the key and plaintext never leave the browser. The only thing published is the envelope from task 01; nothing is logged to the console. The key is kept only in memory and in the sender tab's sessionStorage, which the server never sees.
- Invariant 2: the accept rule (decrypt ok and seq higher) lives in the pure transition and is covered by unit tests for each rejection path.
- Invariant 3: the sender token is sent only in the sender join and never put in a link or the receiver path.
- Invariant 7: decryption failures become a state, never an exception reaching the UI, and the rejected message's partial or full plaintext is never put into the state.

## Tests
- [ ] Unit (pure): a valid first envelope moves waiting to live with its text and seq.
- [ ] Unit (pure): a tampered envelope (integrity error result) keeps the previous text and seq and sets integrity error.
- [ ] Unit (pure): a malformed result and an envelope failing the validator both keep the previous text and set integrity error.
- [ ] Unit (pure): a replayed envelope with the same seq as the last accepted one is rejected with integrity error.
- [ ] Unit (pure): an out-of-order envelope with a lower seq is rejected after a higher one was accepted.
- [ ] Unit (pure): a valid newer update after an integrity error returns to live with the new text.
- [ ] Unit (pure): a resync latest with the same seq keeps the state without a warning; a resync with a lower seq sets integrity error.
- [ ] Unit (pure): disconnect keeps the text and sets disconnected; the transition never mutates the state it is given.
- [ ] Unit (fake timers, fake socket): typing several values within 300 ms publishes once, with only the latest text.
- [ ] Unit (fake timers, fake socket): two debounced changes publish seq n and n+1; the same text typed again is not republished.
- [ ] Unit (fake timers, fake socket): with the first ack held back and then released, three texts typed with pauses longer than the debounce are published in order, one at a time. The middle text is skipped because it is stale by the time its turn comes. Exactly two envelopes go out, with consecutive seqs, ending on the latest text, and both acks are handled.
- [ ] Unit (fake timers, fake socket): a rejected ack (stale seq) for a publish that a newer text followed still surfaces as an error state; it is never silently dropped.
- [ ] Unit (fake timers, fake socket): after a simulated disconnect and reconnect the sender rejoins with its token and republishes the unacknowledged text with a higher seq.
- [ ] Unit (fake socket): after a simulated reconnect the receiver rejoins with the rejoin token from its first join ack and applies the latest envelope; text is unchanged and no warning shows when the seq is the same.
- [ ] Unit (fake socket): two updates whose decrypts finish in reverse order are still applied in arrival order, ending on the newer text.
- [ ] Unit (fake socket): no emitted payload contains the plaintext or the key fragment.
- [ ] Unit: a reloaded sender service restores session id, token, key and seq from sessionStorage and publishes its next update with a higher seq than before the reload.

## Acceptance criteria
- [ ] The receiver state transition is a pure function, and every case in the tests above passes without a socket or a browser.
- [ ] Publishes are serialised: every envelope sent gets its ack handled, a superseded queued text is never sent, and no envelope is ever sent with a lower seq than one before it.
- [ ] Typing quickly sends one encrypted publish per 300 ms pause, with the latest text and a seq one higher than the previous publish.
- [ ] A tampered, malformed, replayed or older envelope leaves the receiver text unchanged and sets the integrity error status.
- [ ] After a dropped connection, both services rejoin automatically: the receiver ends on the latest text without a false warning, and the sender's unacknowledged text reaches the server.
- [ ] A sender page reload resumes the same session and never reuses a seq.
- [ ] Nothing emitted to the server contains the key or the plaintext.

## Out of scope
- Project scaffold, workspaces and the dev proxy (task 00).
- Key generation, encryption, decryption and fragment encoding (task 01).
- Event names, payload types and the envelope validator (task 02).
- Server session rules and the Socket.IO server (tasks 03 and 04).
- Pages, Material components, the integrity banner, the copy button and plain-text rendering (task 06).
- Two-browser end-to-end tests (task 07).
- Security headers and the README (task 08).

## Notes / open questions
- Decision: the sender's session id, token, key fragment and last used seq live in sessionStorage so a reload resumes the session. Tab storage is cleared with the tab, while a key in the sender URL would persist in browser history, so the sender URL carries no key (D5).
- Decision: after an integrity error the receiver keeps listening, and the next valid newer update clears the warning. If the warning should stay until dismissed, the transition needs a separate flag.
- Decision: a resync latest with the same seq is not treated as a replay. Without this, every reconnect would show a false integrity warning.
- Decision: the stale seq ack is shown as an error rather than retried, since seqs are reserved in sessionStorage before publishing and stale seq should only happen if two tabs share one session.
- Decision: the disconnected status means the receiver's own connection to the server is lost; the sender going away shows only through peer status.
- Decision (D8): the receiver rejoins with its rejoin token, so a stale old socket on the server does not block it. Slot taken is shown as an error only when a different receiver holds the session.

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.
