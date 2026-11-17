# [Feature] Shared protocol contract with strict validators for envelopes and join payloads

**Role:** Operator
**Surface:** Shared, Tests
**Estimate:** 10 min
**Depends on:** 00, 01

## Goal
Give the server and the client one shared definition of the Socket.IO protocol, and pure validators that reject any payload that doesn't match it exactly.

## User story
As the developer of the server and the client, I want event names, payload shapes, error codes and validators defined once in the shared workspace, so that both sides can't drift apart and the server never trusts a payload it hasn't checked.

## Context
Decision D6 puts the protocol types and payload validators in the shared workspace so both sides import them. Security invariant 5 requires the server to validate payload shape and size, because it can't check integrity: that only happens in the receiver's browser.

## Current behaviour
Doesn't exist.

## Desired behaviour

**Event names**, defined once as shared constants and used by both sides:

| Event | Direction | Payload |
|---|---|---|
| session:create | sender → server | none |
| sender:join | sender → server | session id, sender token |
| receiver:join | receiver → server | session id, optional receiver rejoin token |
| message:publish | sender → server | envelope |
| message:update | server → receiver | envelope |
| peer:status | server → both | peer, either "connected" or "disconnected" |

**Ack results**, also shared: success, or one error code from a fixed set: unknown_session, bad_token, slot_taken, not_sender, invalid_payload, stale_seq, server_busy, rate_limited. The session:create ack carries the session id and sender token; the receiver:join success ack carries the receiver rejoin token and may carry the latest envelope.

**Envelope rules.** A payload is a valid envelope only when all of these hold:
- It is a plain object with exactly four fields: v, seq, iv and ct. Any extra or missing field rejects it. Null, arrays and primitives are rejected.
- v is the number 1.
- seq is an integer from 1 up to the largest safe integer. Zero, negatives, fractions, NaN, Infinity and numeric strings are rejected.
- iv is unpadded base64url (letters, digits, "-" and "_" only, no "=") that decodes to exactly 12 bytes.
- ct is unpadded base64url that decodes to at least 16 bytes (the AES-GCM tag alone), and its encoded length is at most 65,536 characters (64 KiB).

**Join payload rules.**
- Session id: unpadded base64url of 16 random bytes, so exactly 22 characters.
- Sender token: unpadded base64url of 32 random bytes, so exactly 43 characters.
- The sender:join payload has exactly session id and sender token; the receiver:join payload has session id and, optionally, a receiver rejoin token in the same format as the sender token. Extra fields are rejected.

**Peer status rule.** A plain object with exactly one field, peer, which is "connected" or "disconnected".

**Validator behaviour.**
- Every validator takes untrusted input of any type and returns valid or not valid. It never throws, never logs, and never changes its input.
- All validators are pure: no randomness, time, or configuration reads. The limits (protocol version, IV length, minimum and maximum ciphertext size, id and token lengths) are named shared constants so the server's transport buffer limit in task 04 can be set from them.
- The validators check shape only. They never decrypt and never judge whether seq is higher than the last one; that belongs to the session core (task 03) and the receiver (task 05).

## Security considerations
- Invariant 5: the server can run every inbound payload through these validators before touching session state, so a malformed or oversized payload is turned into invalid_payload instead of reaching the session core.
- Invariant 1: validators never log or echo the payload, so a sender token or ciphertext can't leak through an error path.
- Invariant 7: the client reuses the envelope validator on message:update and on the latest envelope in the join ack, so a malformed envelope is rejected before decryption is attempted.
- Rejecting extra fields stops a client from smuggling data (for example a claimed role) through the relay. The server never takes a role from the payload.

## Tests
- [x] Unit: a valid envelope (v 1, seq 1, 12-byte IV, 16-byte ciphertext) is accepted.
- [x] Unit: an envelope whose ciphertext is exactly 65,536 characters is accepted, and one at 65,537 characters is rejected.
- [x] Unit: wrong types are rejected one field at a time: v as 2 or "1", seq as "1", 0, -1, 1.5, NaN or Infinity, iv or ct as a number.
- [x] Unit: an IV decoding to 11 or 13 bytes is rejected; an IV with "=", "+" or "/" is rejected.
- [x] Unit: a ciphertext shorter than 16 bytes, or empty, is rejected.
- [x] Unit: an envelope with an extra field, or with a missing field, is rejected; null, an array, a string and undefined are rejected without throwing.
- [x] Unit: sender:join and receiver:join payloads with a correctly sized id and token are accepted; a 21- or 23-character id, a non-base64url id, a missing token, and an extra field are each rejected.
- [x] Unit: peer status accepts "connected" and "disconnected" and rejects any other value or extra field.

## Acceptance criteria
- [x] Every event name and ack error code from the protocol table is available from the shared workspace, and no other workspace needs to spell them out.
- [x] The envelope validator accepts exactly the shape described above and rejects every case listed under Tests.
- [x] Join payloads and the peer status payload have their own validators with the rules above.
- [x] No validator throws on any input, including null, undefined, arrays and deeply nested objects.
- [x] The size and length limits are exported as named constants, not repeated as literals elsewhere.
- [x] npm test passes in the shared workspace with the new unit tests.

## Out of scope
- Workspace setup and test runner configuration (task 00).
- Encryption, decryption, key export and import, and the authenticated data string (task 01).
- Seq ordering, duplicate and stale seq checks, token comparison and slot rules (task 03).
- Calling the validators from socket handlers, generating session ids and tokens, and setting the transport buffer limit (task 04).
- Calling the validator on the client and the receiver state rules (task 05).
- Any UI (task 06), end-to-end tests (task 07), and headers or README (task 08).

## Notes / open questions
- Decision: the receiver rejoin token (D8) is 32 random bytes as unpadded base64url, like the sender token.
- Decision: validators cover the join payloads and peer status, not only the envelope, because invariant 5 applies to every payload the server receives and the plan only named the envelope.
- Decision: the session id is 16 random bytes and the sender token is 32 random bytes, both as unpadded base64url. The plan doesn't fix either format; task 04 must generate them to match.
- Decision: the 64 KB cap from the plan applies to the encoded ciphertext length (65,536 characters). That keeps a full envelope comfortably under a transport limit set a little above it.
- Decision: the envelope type and the base64url codec come from task 01, which runs first. This task adds the validators and the other payload types around them and doesn't define a second envelope type.
- Decision: seq starts at 1, since the sender publishes lastSeq + 1 from an initial 0.
- Decision: the minimum ciphertext is 16 bytes, the AES-GCM tag, so an empty text still produces a valid envelope.

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.

## Implementation notes

**Built:**
- `shared/src/protocol.ts`: the `EVENTS` name map, `ACK_ERROR_CODES`, `PEER_STATES`, the payload types (`SenderJoinPayload`, `ReceiverJoinPayload`, `PeerStatusPayload`), the ack types (`{ ok: true, … } | { ok: false, error }`), and the limits `SESSION_ID_BYTES`, `TOKEN_BYTES`, `SESSION_ID_LENGTH` (22) and `TOKEN_LENGTH` (43), with the lengths derived from the byte counts.
- `shared/src/validators.ts`: `isValidEnvelope`, `isValidSenderJoin`, `isValidReceiverJoin`, `isValidPeerStatus`, `isSessionId` and `isToken`. Each returns a boolean type guard and catches anything a hostile input throws.
- `shared/src/object-shape.ts`: `hasExactKeys`, the plain-object and exact-field check shared by the envelope parser and the validators.
- `shared/src/envelope.ts`: `MAX_CIPHERTEXT_CHARS` (65,536), checked before the ciphertext is decoded, so decrypt and the server-side validator reject the same oversized envelopes.
- `shared/src/index.ts` re-exports all of it.

**Deviations:**
- None from the task. One addition to the test list: a 65,537-character string can never be valid base64url (a length remainder of one), so it would be rejected even without the cap. The tests also check a 65,538-character ciphertext that decodes cleanly, which only the cap rejects.

**Decisions:**
- The receiver join field is named `rejoinToken`, as in the implementation plan's protocol table.
- Acks are a discriminated union on `ok`, with `error` holding one of the eight codes.
- Class instances are rejected as not plain objects; objects with a null prototype are accepted, since their fields are checked the same way and JSON never produces either.
- `hasExactKeys` lives in its own module so `envelope.ts` and `validators.ts` don't import each other.
- No typed Socket.IO event-map interfaces: they would type inbound payloads as trusted before validation. Tasks 04 and 05 can add them around the validators.

**Verified or corrected:**
- Checked that the tests catch real faults by planting three of them one at a time: the size cap removed (3 tests failed), the try/catch in the validators removed (5 failed), and the plain-object prototype check removed (2 failed). The source was restored after each and compared byte for byte with a saved copy.
- The task's 65,537-character test alone would not prove the cap (see Deviations); caught while choosing the fixtures.
- The acceptance-criteria review found the "IV with `=`" fixture was 17 characters, so the decoder rejected it for its length before reaching the character rule. It now keeps the IV at 16 characters. The two oversized-ciphertext tests were renamed to say which one proves the cap.

**Test results:**
- `docker compose run --rm dev npm test`: shared 262, server 14, client 4 tests, all passing.
- `docker compose run --rm dev npm run typecheck`: passes in all three workspaces.
- `docker compose run --rm dev npm audit --omit=dev`: 0 vulnerabilities.
- No lint script in the repo. No browser check: this task touches only `shared/`.
