# [Feature] Shared AES-GCM-256 envelope with key-in-fragment encoding and non-throwing decrypt

**Role:** Sender, Receiver
**Surface:** Shared, Tests
**Estimate:** 30 min
**Depends on:** 00

## Goal
Give both browsers one shared, tested way to create a session key, carry it in the link fragment, encrypt each text update into an envelope, and decrypt it only when it is authentic for this session and this sequence number.

## User story
As a sender and a receiver, we want every text update encrypted and authenticated in our own browsers with a key the server never sees, so that the server can relay updates but cannot read, alter, replay or move them to another session unnoticed.

## Context
This is the core of decision D1 (the server is an untrusted ciphertext relay) and of the crypto section of the implementation plan. It lives in the shared workspace (D6) so the sender, the receiver and the server's integration tests use exactly the same envelope rules.

## Current behaviour
Doesn't exist.

## Desired behaviour
The shared workspace offers five operations: generate a key, export a key to a link fragment, import a key from a link fragment, encrypt a text update, and decrypt an envelope.

**Key**
- Generating a key produces an AES-GCM key of 256 bits, usable for encryption and decryption only. The generated key is extractable, because the sender has to export it into the receiver link.
- Exporting takes the raw 32 key bytes and encodes them as base64url without padding. The result is always exactly 43 characters from the base64url alphabet, with no `#` included.
- Importing takes the fragment value and returns a result instead of throwing: either "ok" with the key, or "malformed". The imported key is non-extractable and limited to encryption and decryption.
- Decision: a single leading `#` is tolerated and stripped, so the caller may pass the raw location hash. Everything else must be exactly 43 base64url characters that decode to exactly 32 bytes; empty input, padding characters, standard-base64 characters (plus and slash), whitespace, and shorter or longer values are all "malformed".

**Encrypt**
- Inputs: the key, the session id, the sequence number and the plaintext.
- The plaintext is encoded as UTF-8. Empty text is allowed, because the sender may clear the text box.
- Each call draws a fresh random 96-bit IV from the platform's cryptographically secure random source. An IV is never derived from the sequence number, a counter or the time.
- The authenticated data (AAD) is the UTF-8 encoding of the text `slm:v1|` followed by the session id, a `|` separator and the sequence number in plain decimal. Encrypt and decrypt must build it from the same single place, so they cannot drift apart.
- The authentication tag is 128 bits, the AES-GCM default, appended to the ciphertext.
- Output is an envelope with four fields: version 1, the sequence number, the IV as base64url (16 characters, no padding) and the ciphertext plus tag as base64url (no padding).
- Decision: the sequence number must be a positive safe integer. Encrypt refuses anything else (zero, negative, fractional, not-a-number, beyond the safe integer range), because an envelope with such a seq would be rejected by the server anyway and points to a sender-side bug.

**Decrypt**
- Inputs: the key, the session id the receiver joined, and the envelope as received from the network (treated as untrusted, unknown-shaped data).
- Decrypt never throws and never rejects. It always resolves to exactly one of three results:
  - **ok**, carrying the plaintext and the sequence number that was authenticated;
  - **integrity_error**, when the envelope is well-formed but the authentication tag does not verify (wrong key, tampered ciphertext, tampered IV, changed seq, different session id);
  - **malformed**, when the envelope cannot even be attempted: not an object, version other than 1, seq not a positive safe integer, IV or ciphertext not a string, not valid unpadded base64url, IV not decoding to exactly 12 bytes, or ciphertext shorter than the 16-byte tag.
- The AAD is rebuilt from the session id the receiver joined and the seq inside the envelope, never from any session id carried in the message.
- On integrity_error or malformed, the result carries no plaintext, no partial plaintext and no detail from the underlying crypto error.
- Decrypt only answers "is this authentic for this session and this seq". Whether the seq is newer than the last accepted one is the receiver state's job (task 05).

**Shared base64url codec**
- Decision: the unpadded base64url encode and decode used here is part of this task and exported, so the protocol validators (task 02) reuse it instead of writing a second one. Decoding is strict: it rejects padding, non-alphabet characters and lengths that cannot be valid base64url (a remainder of one character).

**Runtime**
- Uses only the standard WebCrypto API available as a global in both modern browsers and the Node version the project runs on. No Node-only crypto module and no third-party crypto library, so the same code runs in the Angular client and in the server's tests.

## Security considerations
- **Invariant 1 (key and plaintext never reach the server):** this module performs no network, storage or logging calls. The key only ever leaves memory through the export-to-fragment operation, whose output belongs after the `#` in the receiver link. No result, error or thrown value contains key bytes or plaintext.
- **Invariant 2 (show text only when decryption succeeds and seq is newer):** this task delivers the first half. Binding the session id and seq into the AAD means a valid envelope replayed with a different seq, or moved from another session, fails authentication instead of decrypting. The "newer seq" half is enforced on top of the ok result in task 05.
- **Invariant 7 (failures never crash the UI, never show partial plaintext):** decrypt resolves to a result for every input, including garbage, and AES-GCM releases plaintext only after the whole tag verifies, so there is no partial output to leak.
- **IV reuse is catastrophic for AES-GCM** (it leaks the XOR of plaintexts and allows forgery). A fresh random 96-bit IV per call, with no caching or reuse, is mandatory; the test for distinct IVs guards this.
- **Receiver key is non-extractable**, so script running later in the receiver tab cannot read the key back out of the key object (it can still use it, which is a known limitation of in-browser crypto).
- **Strict decoding** of the fragment and of envelope fields closes off ambiguous encodings, so two different strings never map to the same key or IV.
- **Separator safety in the AAD:** the session id comes from the server and is validated elsewhere as URL-safe; the seq is a decimal integer, so the `|` separator cannot appear inside either field and the AAD cannot be made ambiguous.
- **Authorship is not proven here.** Anyone holding the link holds the key and could produce valid envelopes; publishing is restricted by the sender token on the server (D5, tasks 03 and 04).

## Tests
All unit level (pure, real WebCrypto in Vitest, no mocks):
- [ ] Unit: round-trip. A generated key, encrypting a text at seq 1 and decrypting it with the same session id returns ok with the identical text and seq 1.
- [ ] Unit: round-trip through the link. Exporting the key, importing the fragment, and decrypting with the imported key returns ok with the original text.
- [ ] Unit: round-trip of non-ASCII text (accented letters, emoji, line breaks) and of an empty string returns the exact original.
- [ ] Unit: flipping one bit in the ciphertext returns integrity_error and no plaintext.
- [ ] Unit: flipping one bit in the authentication tag (last ciphertext byte) returns integrity_error.
- [ ] Unit: flipping one bit in the IV returns integrity_error.
- [ ] Unit: decrypting with a different generated key returns integrity_error.
- [ ] Unit: changing the envelope seq (for example 5 to 6, and 5 to 4) returns integrity_error.
- [ ] Unit: decrypting with a different session id than the one used to encrypt returns integrity_error.
- [ ] Unit: encrypting the same plaintext twice with the same key, session id and seq gives different IVs and different ciphertexts; a batch of 1000 encryptions produces 1000 distinct IVs.
- [ ] Unit: every envelope has version 1, an IV of 16 base64url characters that decodes to 12 bytes, and a ciphertext exactly 16 bytes longer than the UTF-8 plaintext.
- [ ] Unit: an exported fragment is 43 characters, contains only the base64url alphabet, and has no padding.
- [ ] Unit: importing a fragment with a single leading `#` succeeds and decrypts the same envelopes.
- [ ] Unit: importing a malformed fragment returns malformed and does not throw, for each of: empty, 42 characters, 44 characters, padded with `=`, containing `+` or `/`, containing whitespace, containing a non-alphabet character, and a valid-looking value that decodes to the wrong byte count.
- [ ] Unit: an imported key reports itself as non-extractable, and attempting to export it fails.
- [ ] Unit: decrypt returns malformed (and does not throw) for: a non-object, a missing field, version 2, seq as a string, zero, negative or fractional seq, an IV that decodes to 11 or 13 bytes, an IV or ciphertext that is not valid base64url, and a ciphertext shorter than 16 bytes.
- [ ] Unit: encrypt refuses seq 0, a negative seq, a fractional seq and not-a-number.
- [ ] Unit: for every failing case above, the result contains no plaintext field and its text does not include the original plaintext.

## Acceptance criteria
- [ ] A text encrypted by the sender for a session and seq decrypts to the identical text on the receiver side only with the same key, session id and seq.
- [ ] A single flipped bit in the ciphertext, tag or IV, a wrong key, a changed seq, or a different session id each yields integrity_error with no plaintext.
- [ ] A broken link fragment yields malformed from key import, and a broken envelope yields malformed from decrypt; neither ever throws.
- [ ] Two encryptions of the same text never share an IV.
- [ ] The receiver's imported key cannot be exported.
- [ ] The same module runs unchanged in the browser and under Node in Vitest, and `npm test` passes in the shared workspace.

## Out of scope
- Scaffolding the workspaces and test runners (task 00).
- Event-name constants, payload types, the network-level envelope validator and the size cap (task 02); it reuses this task's base64url codec.
- The server session core and the server-side increasing-seq check (task 03).
- The Socket.IO shell and the integration test that a tampered envelope is relayed byte-for-byte and rejected by client-side decrypt (task 04).
- The receiver's "accept only if seq is higher" rule, debounce, the sender's seq counter and resend after reconnect (task 05).
- Reading the key from the location hash, building the receiver link, and showing the integrity banner or invalid-key error (task 06).
- End-to-end runs with a corrupted key in a real browser (task 07).
- CSP and other security headers, README threat model (task 08).
- Stripping the key from browser history, signing keypairs for authorship, key rotation.

## Notes / open questions
- Decision: the generated sender key is extractable so it can be exported; only the imported (receiver) key is non-extractable. If the sender tab should also hold a non-extractable key, the sender would re-import its own fragment after export; not done here.
- Decision: a single leading `#` on the fragment is tolerated; everything else about the fragment is strict.
- Decision: decrypt does its own minimal well-formedness checks so it never throws, instead of depending on the task 02 validator (task 02 is not a dependency). The two must agree on version 1, a 12-byte IV and unpadded base64url.
- Decision: the base64url codec is owned by this task and reused by task 02.
- Decision: this task runs before task 02, so it defines the envelope type (version, seq, IV, ciphertext). Task 02 reuses that type rather than defining a second one.
- Decision: encrypt refuses an invalid seq instead of returning a result, since that is a sender-side programming error, not untrusted input.
- Decision: a ciphertext shorter than the 16-byte tag is malformed, not integrity_error, because no authentication can be attempted.

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.
