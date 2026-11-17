# [Feature] Server sends strict security headers on the built app, and the README documents architecture, threat model and AI usage

**Role:** Operator
**Surface:** Server, Client, Tests, Docs
**Estimate:** 25 min
**Depends on:** 04, 07

## Goal
The production app is served with a strict Content Security Policy and related headers, and a README explains how the app works, what it protects against, and how to run and test it.

## User story
As an operator, I want the server to lock down what the served page may load and leak, and a README that states the security model plainly, so that I can run the app with confidence and judge what it does and does not protect.

## Context
The whole security model rests on the browser: the key lives in the URL fragment and decryption happens client-side (D1). That makes the page itself the thing to protect: a script injection or a referrer leak would defeat the encryption. The README collects decisions D1–D8 and the known limitations from the implementation plan into one place.

## Current behaviour
Doesn't exist. The server only runs the Socket.IO relay, no security headers are set, and there is no README.

## Desired behaviour

### Serving the production build
- Decision: in production mode the Node server also serves the built Angular app as static files, with the Socket.IO relay on the same origin. This is what lets the headers apply and lets the CSP stay at `connect-src 'self'`. In development the Angular dev server and its proxy are unchanged, and the headers are not expected there.
- Unknown paths that are not static files and not the Socket.IO path fall back to the app's index page, so `/s/<id>` and `/r/<id>` load directly.
- A root script builds the client and starts the server in production mode.
- The Docker setup from task 00 switches to this: the image builds the client, the container's command is the production start, and the published port is the server's. The compose command then serves the app with the headers below.

### Headers on every served response (index page, static assets, fallback)
- Content Security Policy:
  - `default-src 'none'`
  - `script-src 'self'` with no inline scripts and no eval
  - `style-src 'self' 'unsafe-inline'` (see decision below)
  - `connect-src 'self'` so the socket can only reach the origin that served the page
  - `img-src 'self' data:`, `font-src 'self'`
  - `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `object-src 'none'`
- `Referrer-Policy: no-referrer`, so the session id in the path never leaks to another site.
- `X-Content-Type-Options: nosniff`.
- `Cache-Control: no-store` on the index page, so a stale page is never served against a newer server.
- Decision: style-src allows inline styles. Angular and Angular Material inject component styles at runtime as style elements, which a strict style-src would block. Inline styles cannot run code, so script-src stays strict, which is where the risk is.
- Decision: the production build turns off critical-CSS inlining. That optimisation loads stylesheets through an inline event handler, which a strict script-src blocks.
- Decision: no fonts or icons are loaded from a third-party host. Material fonts and icons are either self-hosted in the build or dropped in favour of system fonts, so `font-src 'self'` holds.

### README
The README at the repo root has these sections, in this order:
1. **What it is**: one paragraph on the sender, receiver and live encrypted text.
2. **How to run the app**: prerequisites (Node version), install, running with Docker only (one compose command, no Node needed, `http://localhost` only), development mode, production mode (build plus server), the default ports, and the environment settings the server reads (port, allowed origin).
3. **Architecture and key technical decisions**: a simple diagram of sender browser, relay server and receiver browser showing where the key lives and what travels over the wire; then a short summary of each decision D1–D8 with the main rejected alternative, linking to `docs/architecture-decisions.md` and `docs/implementation-plan.md` for detail.
4. **Security assumptions and considerations (threat model)**:
   - What the server can see: session ids, ciphertext size and timing, IP addresses, when each side connects and disconnects.
   - What the server cannot see or do: it never has the key or plaintext; it cannot alter, move between sessions or replay a message without the receiver detecting it (AES-GCM with session id and seq bound as authenticated data, and the receiver's seq rule); it cannot publish as the sender only by knowing the link, because publishing needs the sender token.
   - What a malicious server could still do: serve modified JavaScript that leaks the key, drop or delay updates, refuse service, and forge ciphertext if it also learns the key.
   - What the receiver link holder can do: read the text; they cannot publish without the sender token.
   - The security headers from this task and what each one defends against.
5. **Tests and how to run them**: what each level covers (unit for shared crypto and the pure session core and receiver reducer, integration with a real Socket.IO server, end-to-end with two browser contexts, and the header check from this task), and the commands to run each.
6. **Known limitations and what would be improved with more time**: at least the five limitations from the implementation plan (key in browser history and pasted links, metadata visible to the operator, malicious server JavaScript, sender token is not receiver-verifiable authorship, in-memory state lost on restart), each with the improvement it would get (stripping the fragment from history after import, signing keypairs, a signed build or SRI, and so on), plus any limitation found while building. The "Implementation notes" sections of the task files are the source for these and for the AI usage examples below.
7. **AI usage**:
   - The models and tools used (for example the coding assistant and its model, and any other AI tool), and what each was used for.
   - The skills used: the task intake skill and the task implementation skill shipped in `.claude/skills`, how the first turned the plan into the task files in `docs/tasks/`, and how the second took each task to a pull request.
   - One concrete, useful AI contribution, naming the part of the app it affected.
   - One concrete thing that was independently verified or corrected, what was wrong or unproven, and how it was checked.
   - Both examples are real ones from this build, not placeholders.
- The README describes the project only as a product: what it does, how it is built and how to run it.

## Security considerations
- Invariant 1 (key and plaintext never reach the server): `Referrer-Policy: no-referrer` stops the session path leaking to other sites; the README states that the fragment is never sent to the server and where the key does leak (history, pasted links).
- Invariant 6 (plain text only): a strict script-src is the second line of defence if text were ever rendered as HTML by mistake; it does not replace plain-text rendering.
- `connect-src 'self'` stops injected or modified code in the page from opening a socket or request to another host, which narrows key exfiltration paths.
- `frame-ancestors 'none'` stops the sender or receiver page being framed by another site for clickjacking.
- The README's threat model must not overclaim: it states plainly that a malicious server serving modified JavaScript defeats the encryption.

## Tests
- [ ] Integration: with the server started in production mode against a built client on a random port, the index page, one static script asset and a fallback route such as a receiver path each return the CSP, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff` headers with the exact values above.
- [ ] Integration: the CSP on those responses contains no `'unsafe-inline'` or `'unsafe-eval'` in script-src and has `connect-src 'self'`.
- [ ] Manual: the compose command starts the container in production mode, and the app at its published port returns the headers above.
- [ ] End-to-end: against the production build served by the Node server, the sender creates a session and the receiver sees the typed text, with no Content Security Policy violation reported in either browser console.

## Acceptance criteria
- [ ] Running the production start script serves the app and the relay from one origin, and `/r/<id>#<key>` loads directly.
- [ ] Every response for the index page, static assets and fallback routes carries the CSP, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`, and the automated header check passes in `npm test`.
- [ ] The full sender-to-receiver flow works under the CSP with no violations in the browser console.
- [ ] The production build loads no fonts, icons or scripts from a third-party host.
- [ ] The README has these required sections: how to run the app; architecture and key technical decisions (with a diagram and D1–D8); security assumptions and considerations as a threat model of what the server can and cannot see or do; tests and how to run them; known limitations and what would be improved with more time; and AI usage covering models and tools, skills used (the task intake and task implementation skills), one useful AI contribution and one thing independently verified or corrected.
- [ ] The README and every command in it work as written on a fresh clone.
- [ ] The README describes the project only as a product.

## Out of scope
- Socket.IO transport, origin allow-list and payload size limit (04).
- The two-browser end-to-end flow and the corrupted-key test (07); this task only reruns the happy path against the production build.
- Stripping the key from browser history, signing keypairs, SRI or a signed build: README limitations only.
- HTTPS termination and HSTS: left to the deployment's reverse proxy and listed in the README's run section.
- UI polish (06).

## Notes / open questions
- Decision: the Node server serves the production build in production mode, so the headers apply; the dev server is not hardened.
- Decision: style-src allows `'unsafe-inline'` because Angular and Angular Material inject styles at runtime. A nonce-based style policy is a possible later improvement and goes in the README's limitations.
- Decision: critical-CSS inlining is turned off in the production build, because its inline event handler breaks a strict script-src.
- Decision: Material fonts and icons are self-hosted or replaced with system fonts, so no third-party host is allowed in the CSP.
- Decision: the CSP does not enforce Trusted Types (`require-trusted-types-for 'script'`). It is unverified with Angular Material and goes in the README's limitations as a later improvement.
- Decision: HSTS is not set by the app, because the app itself does not terminate TLS.
- Older browsers treat `connect-src 'self'` as not covering same-origin WebSocket URLs. The end-to-end test runs in Chromium only; if a browser blocks the socket, add the same-origin `wss:` origin explicitly.

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.
