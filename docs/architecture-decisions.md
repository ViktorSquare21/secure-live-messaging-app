# Architecture decisions

## D1. Server is an untrusted ciphertext relay
- The key lives in the URL fragment of the receiver link (`/r/<sessionId>#<key>`). Browsers never send the fragment to the server. The sender page is `/s/<sessionId>`.
- The server stores only the latest ciphertext per session, in memory, so a receiver who joins late gets the current text.
- No crypto on the server. Integrity is enforced in the browser by AES-GCM, with the session id and a sequence number bound in as authenticated data (AAD).

## D2. Backend: Node + TypeScript + Socket.IO (websocket-only)
- Chosen over plain `ws` for built-in reconnection, rooms and acknowledgements.
- `transports: ['websocket']` on both server and client, so there is no HTTP long-polling surface.
- The session logic (role slots, latest ciphertext, sequence checks) is a pure module. The Socket.IO handlers are a thin shell around it.

## D3. Frontend: Angular LTS + Angular Material
- Fixed requirement.

## D4. Project docs live in `docs/`
- `docs/architecture-decisions.md`: this file.
- `docs/implementation-plan.md`: the flow, protocol and task breakdown.
- `docs/tasks/`: one file per task, written by the task intake skill.

## D5. Sender authorisation: server-issued sender token
- Anyone with the receiver link also has the key, so it could forge valid ciphertext. Knowing the key must not be enough to publish.
- Creating a session returns `{ sessionId, senderToken }`. The token, the key and the last seq stay in the sender tab (memory plus sessionStorage) so a reload resumes; none of them goes into the sender URL. Tab storage dies with the tab, while a URL fragment would persist in history.
- The server accepts `publish` only from the socket that joined with the matching token, and compares tokens in constant time.
- Rejected alternative: a signing keypair (Ed25519 / ECDSA) in the link. It's stronger, because even the server couldn't forge, but it adds more crypto than this scope needs. Listed under future improvements.

## D6. Repo: npm workspaces `shared/`, `server/`, `client/`
- `shared/` holds the protocol types, payload validators and the crypto envelope. Both sides import it, so they can't drift apart.

## D7. Tests: Vitest everywhere + Playwright E2E
- Vitest: shared crypto, server session core (pure), Socket.IO integration on a random port, Angular units.
- Playwright: two browser contexts (sender, receiver) using real WebCrypto.

## D8. Receiver rejoin token
- Socket.IO reconnects quickly, but the server can take up to about 45 seconds to notice a dead connection, so a reconnecting receiver would get `slot_taken`.
- Each successful receiver join returns a random rejoin token, which the receiver tab keeps in sessionStorage. Rejoining with it takes over the slot at once and disconnects the stale socket.
- Without the token, an occupied slot is refused, so someone holding only the link cannot kick the receiver.
- The server stores only a hash of the token, as for the sender token.
