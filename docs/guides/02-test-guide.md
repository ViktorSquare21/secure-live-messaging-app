# Test guide: 02 Shared protocol contract with strict validators for envelopes and join payloads

## What this covers
The protocol contract in `shared/`: the six Socket.IO event names, the eight ack error codes, the payload and ack types, the named size and length limits, and the validators for envelopes, `sender:join`, `receiver:join` and `peer:status` payloads. It verifies every acceptance criterion of `docs/tasks/02-protocol-types-validators.md`.

## Before you start
- Node 24 LTS on the host (`nvm use`), or only Docker. All steps below ran through Docker, because the host had another Node major.
- Install once: `docker compose run --rm dev npm ci` (or `npm ci` on a Node 24 host).
- No app needs to run: this task adds a library with no page and no server change.

## Automated tests
Run in the `dev` service, or the same commands on a Node 24 host without the `docker compose run --rm dev` prefix:

| Command | Result |
|---|---|
| `docker compose run --rm dev npm test` | shared 262 tests in 6 files, server 14, client 4; all passing |
| `docker compose run --rm dev npm run typecheck` | all three workspaces compile with no errors |
| `docker compose run --rm dev npm audit --omit=dev` | `found 0 vulnerabilities` |

What the new shared tests prove:
- `shared/src/validators.test.ts`: the envelope validator accepts v 1, seq 1, a 12-byte IV and a 16-byte ciphertext, and a ciphertext of exactly 65,536 characters. It rejects 65,537 and 65,538 characters, v as 2 or `"1"`, seq as `"1"`, 0, -1, 1.5, NaN, Infinity or beyond the safe range, iv or ct as a number, an 11- or 13-byte IV, an IV with `=`, `+` or `/`, a 15-byte or empty ciphertext, an extra or missing field, null, an array, a string and undefined. Join payloads accept a 22-character id and 43-character tokens and reject 21/23-character ids, non-base64url ids, a missing or malformed token, a claimed `role` and any other extra field. Peer status accepts only `connected` and `disconnected`. Every validator returns `false` without throwing for null, undefined, arrays, a 10,000-level nested object, symbols, bigints, functions, class instances, a proxy whose traps throw and an object whose getter throws. No `console` method is called, and frozen inputs are accepted and left unchanged.
- `shared/src/protocol.test.ts`: the event names, error codes, peer states and limits, imported from the shared entry point.
- `shared/src/envelope.test.ts` and `shared/src/crypto-envelope.test.ts`: the size cap also applies to the envelope parser and to decrypt, which returns `malformed` for an oversized ciphertext.

## Manual steps
1. Run the validators against a few payloads in Node 24 from the `shared/` folder:
   ```sh
   docker compose run --rm dev sh -c 'cd shared && npx tsx -e "
   import { EVENTS, ACK_ERROR_CODES, SESSION_ID_LENGTH, TOKEN_LENGTH, MAX_CIPHERTEXT_CHARS, isValidEnvelope, isValidSenderJoin, isValidReceiverJoin, isValidPeerStatus, encodeBase64Url } from \"./src/index.ts\";
   const b = (n: number) => encodeBase64Url(new Uint8Array(n));
   const env = { v: 1, seq: 1, iv: b(12), ct: b(16) };
   const sessionId = b(16), token = b(32);
   console.log(\"events:\", Object.values(EVENTS).join(\" \"));
   console.log(\"error codes:\", ACK_ERROR_CODES.join(\" \"));
   console.log(\"limits:\", SESSION_ID_LENGTH, TOKEN_LENGTH, MAX_CIPHERTEXT_CHARS);
   console.log(\"envelope:\", isValidEnvelope(env));
   console.log(\"ct 65536 chars:\", isValidEnvelope({ ...env, ct: \"A\".repeat(65536) }));
   console.log(\"ct 65538 chars:\", isValidEnvelope({ ...env, ct: \"A\".repeat(65538) }));
   console.log(\"seq 0:\", isValidEnvelope({ ...env, seq: 0 }), \"| seq \\\"1\\\":\", isValidEnvelope({ ...env, seq: \"1\" }));
   console.log(\"extra field:\", isValidEnvelope({ ...env, role: \"sender\" }), \"| null:\", isValidEnvelope(null));
   console.log(\"sender join:\", isValidSenderJoin({ sessionId, senderToken: token }), \"| with role:\", isValidSenderJoin({ sessionId, senderToken: token, role: \"sender\" }));
   console.log(\"receiver join:\", isValidReceiverJoin({ sessionId }), isValidReceiverJoin({ sessionId, rejoinToken: token }), \"| 21-char id:\", isValidReceiverJoin({ sessionId: sessionId.slice(1) }));
   console.log(\"peer:\", isValidPeerStatus({ peer: \"connected\" }), isValidPeerStatus({ peer: \"disconnected\" }), isValidPeerStatus({ peer: \"gone\" }));
   const hostile = new Proxy({}, { ownKeys() { throw new Error(\"boom\"); } });
   console.log(\"throwing proxy:\", isValidEnvelope(hostile), isValidSenderJoin(hostile));
   "'
   ```
   **Expected and observed:**
   ```
   events: session:create sender:join receiver:join message:publish message:update peer:status
   error codes: unknown_session bad_token slot_taken not_sender invalid_payload stale_seq server_busy rate_limited
   limits: 22 43 65536
   envelope: true
   ct 65536 chars: true
   ct 65538 chars: false
   seq 0: false | seq "1": false
   extra field: false | null: false
   sender join: true | with role: false
   receiver join: true true | 21-char id: false
   peer: true true false
   throwing proxy: false false
   ```

## Failure cases
Covered by step 1: an oversized ciphertext, seq 0 or as a string, an extra `role` field on an envelope or a join payload, null, a 21-character session id, an unknown peer state and a proxy that throws are all rejected with `false`, and nothing throws. The full list of rejected inputs is in the automated tests above.

## Not covered
- Calling the validators from the socket handlers and turning a rejection into the `invalid_payload` ack (task 04), and on the client for `message:update` and the join ack (task 05).
- The increasing-seq, token and slot rules (task 03) and the receiver's "seq must be newer" rule (task 05). The validators check shape only.
- No screenshots: this task changes nothing visible in a browser.
