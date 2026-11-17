# Secure Live Messaging: Project Context

> Context for the task intake skill. It helps ask the right follow-up questions and keep tasks consistent with decisions already made.

## 1. What it is

A small web app where a **sender** shares a live-updating text with one **receiver** through a unique link. The text is encrypted in the sender's browser and decrypted in the receiver's browser. The server only relays ciphertext and never has the key or the plaintext.

## 2. Parts

| Part | What lives there |
|---|---|
| **client** | Angular (LTS) + Angular Material. Pages: home (new session), sender (one text input, receiver link with a copy button, peer status), receiver (the text displayed and updated live, with no input; status, integrity warning). |
| **server** | Node + TypeScript + Socket.IO, WebSocket transport only. An in-memory session store and relay. The session rules are a pure function; the socket handlers are a thin shell around it. |
| **shared** | Message types, payload validation, and the crypto envelope (encrypt / decrypt). Imported by both client and server. |
| **tests** | Vitest (unit and integration) and Playwright (end-to-end with two browser contexts). |

## 3. Vocabulary

- **session**: one sender and one receiver, identified by a random session id.
- **sender**: creates the session, types the text, and is the only one allowed to publish.
- **receiver**: opens the link and sees the latest text displayed live. Read-only: it has no input and sends nothing back.
- **receiver link**: `/r/<sessionId>#<key>`. The key sits in the part after `#`, which browsers never send to the server. The sender copies it and passes it on through another platform (chat, email); the app never sends it.
- **sender token**: a random secret the server issues when the session is created. It proves to the server who may publish. It never goes into a link.
- **receiver rejoin token**: a random secret given to the receiver on join, so it can take its slot back after a reconnect. Someone with only the link cannot.
- **envelope**: what goes over the wire: version, sequence number, IV, ciphertext.
- **sequence number (seq)**: increases by one with every update. It is bound into the encryption, so it can't be altered unnoticed.
- **latest**: the last envelope the server holds, so a receiver who joins late gets the current text immediately.

## 4. Decisions already made

Summary only. `docs/architecture-decisions.md` is the source of truth, with the reasoning and rejected alternatives.

- **D1:** the server is an untrusted relay: no crypto, no key, no plaintext, memory only. AES-GCM-256 via WebCrypto, with a fresh random 96-bit IV per message; the session id and seq are bound in as authenticated data.
- **D2:** Socket.IO with WebSocket transport only (no HTTP long-polling). Session rules are a pure module.
- **D3:** Angular LTS + Angular Material.
- **D4:** project docs live in `docs/`.
- **D5:** a server-issued sender token authorises publishing. Signing keypairs are a possible future improvement. The sender's key, token and seq live in tab storage, never in the sender URL.
- **D6:** npm workspaces: `shared/`, `server/`, `client/`.
- **D7:** Vitest everywhere plus Playwright end-to-end.
- **D8:** a receiver rejoin token lets a reconnecting receiver take its slot back.

Plain-text rendering is not a numbered decision; it is invariant 6 below.

## 5. Security invariants (every task must keep these)

1. The key and plaintext never reach the server: not in requests, logs, query strings, or error reports.
2. The receiver shows text only when decryption succeeds **and** its seq is higher than the last accepted one. Otherwise it keeps the last good text and shows an integrity warning.
3. Only the socket that presented the correct sender token can publish to a session.
4. At most one sender and one receiver per session. Extra joiners are refused; only the holder of the matching sender token or receiver rejoin token can take over an occupied slot.
5. The server validates payload shape and size, and never trusts the client's claimed role.
6. Received text is rendered as plain text, never as HTML.
7. Decryption failures never crash the UI and never show partial plaintext.

## 6. Known limitations (don't file as bugs unless asked)

- The key appears in browser history and anywhere the link is pasted.
- The server operator can see metadata: timing, message sizes, IP addresses.
- A malicious server could serve modified JavaScript.
- A server restart ends all sessions.

## 7. Anti-patterns to watch for in requests

- "Store messages so they survive a restart." Persistence is out of scope.
- "Let the server check the message is valid." It can only check the shape; integrity is checked in the receiver's browser.
- "Allow several receivers." The scope is one sender and one receiver.
- "Let the receiver reply or edit." Text flows one way, from the sender's input to the receiver's display.
- "Send the link from the app." The sender shares it on another platform; the server must never handle the link, because it holds the key.
- "Show the text even if decryption fails, with a warning." This breaks invariant 2.
