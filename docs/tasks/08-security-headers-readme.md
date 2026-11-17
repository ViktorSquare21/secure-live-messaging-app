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
- [x] Integration: with the server started in production mode against a built client on a random port, the index page, one static script asset and a fallback route such as a receiver path each return the CSP, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff` headers with the exact values above.
- [x] Integration: the CSP on those responses contains no `'unsafe-inline'` or `'unsafe-eval'` in script-src and has `connect-src 'self'`.
- [x] Manual: the compose command starts the container in production mode, and the app at its published port returns the headers above.
- [x] End-to-end: against the production build served by the Node server, the sender creates a session and the receiver sees the typed text, with no Content Security Policy violation reported in either browser console.

## Acceptance criteria
- [x] Running the production start script serves the app and the relay from one origin, and `/r/<id>#<key>` loads directly.
- [x] Every response for the index page, static assets and fallback routes carries the CSP, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`, and the automated header check passes in `npm test`.
- [x] The full sender-to-receiver flow works under the CSP with no violations in the browser console.
- [x] The production build loads no fonts, icons or scripts from a third-party host.
- [x] The README has these required sections: how to run the app; architecture and key technical decisions (with a diagram and D1–D8); security assumptions and considerations as a threat model of what the server can and cannot see or do; tests and how to run them; known limitations and what would be improved with more time; and AI usage covering models and tools, skills used (the task intake and task implementation skills), one useful AI contribution and one thing independently verified or corrected.
- [x] The README and every command in it work as written on a fresh clone.
- [x] The README describes the project only as a product.

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

## Implementation notes

**Built**
- `server/src/static-site.ts` (pure): the exact CSP and security headers, request routing (GET/HEAD only, known build file or index fallback), per-response headers (`no-store` on the index page and on 405) and content types.
- `server/src/static-files.ts` (shell): loads the build into memory once at startup and serves it; `create-server.ts` takes the static site as an option, and Socket.IO still claims `/socket.io/` first. `main.ts` loads it when `NODE_ENV=production` and exits with `server_start_failed missing_client_build` if the build is missing. A new `HOST` setting lets the container bind `0.0.0.0`.
- Root `npm run build` and `npm start` (build, then the server in production mode). The Docker `app` image builds the client and runs the production server; compose publishes it on `127.0.0.1:${CLIENT_PORT:-4200}`.
- Client: the production index has no `<base>` element and uses absolute asset paths (`deployUrl: "/"`), and the router gets its base from `APP_BASE_HREF`. The development build uses `src/index.dev.html`, which keeps the `<base>` element the dev server needs.
- Playwright has a `production` project: `e2e/production-csp.spec.ts` runs the full flow against the production server on :4300 with the receiver link opened directly, and fails on any CSP violation or request to another host.
- `README.md` with the seven required sections; `docs/dev-environment.md` updated for the production `app` service.

**Deviations**
- The Docker `app` service is published on `CLIENT_PORT` (default 4200), not the planned `APP_PORT` 8080: port 8080 was already taken on the development host, and one port setting for both services is simpler. `app` and `dev` use the same host port, so only one runs at a time.
- The task expected no client code change, but the CSP's `base-uri 'none'` blocks Angular's default `<base href="/">`. The production index drops it and the build uses absolute asset paths; see "Verified or corrected".
- `npm run e2e` now builds the client first, and the production webServer only starts the server. Building inside the webServer, next to `ng serve`, ran the dev container out of memory.
- The npm scripts were made shell-independent so the README commands work on Windows too: the server's `start` passes `--production` instead of a POSIX `NODE_ENV=` prefix (`isProductionMode` accepts either, and `main.ts` passes the result to the origin policy as a value), the client's `start` runs `client/serve.mjs`, which reads `CLIENT_HOST` and starts `ng serve` without a shell, and `.gitattributes` keeps text files LF on every checkout. The client launcher and line endings date from task 00 but block this task's fresh-clone criterion on Windows. Only Linux was run.
- The header integration test runs against a small fixture build, so `npm test` needs no client build. The real build is covered by the production e2e test and the manual curl check.

**Decisions**
- No static-serving dependency: `node:http` plus the build preloaded into a `Map`. No request path reaches the file system, so traversal is impossible, and there is no file I/O on the request path.
- Every unknown GET falls back to the index page, including paths that look like assets; `nosniff` stops a browser from running the HTML as a script. Methods other than GET and HEAD get 405 with the security headers.
- The production server runs through `tsx`, as the server already did. Compiling it is listed in the README's limitations.
- In production, `ALLOWED_ORIGINS` stays unset, so the existing same-origin check applies. The Playwright production server sets it blank, so it doesn't inherit the dev container's allow-list.
- The README's AI usage examples are the socket.io-client emit buffering from task 05 (useful contribution) and the `base-uri` finding from this task (verified or corrected).

**Verified or corrected**
- The first production e2e run failed: the receiver opened at `/r/<id>` never loaded. The console showed that `base-uri 'none'` blocks `<base href="/">`, so the relative script and style URLs resolved under `/r/`, came back as the index HTML and were refused under `nosniff`. Fixed in the client without changing the CSP. The dev server then broke the other way, since it ignores `deployUrl` and needs the base element; hence `index.dev.html`.
- The production server first inherited `ALLOWED_ORIGINS` for port 4200 from the dev container, so the sender could not create a session on :4300. Fixed by setting it blank for that webServer.
- Building the client inside the Playwright webServer was killed with exit code 137 (out of memory) next to `ng serve`. The build moved into the `e2e` script.
- Planted faults proved the e2e check can fail: an inline `<script>` in the built index gave `["script-src-elem inline"]`, and removing `'unsafe-inline'` from `style-src` failed the exact-policy assertion. Both were reverted.
- Replacing `NODE_ENV=production` with `--production` first broke the production e2e test: the static build was served, but the origin policy still read `NODE_ENV` and kept the dev allow-list, so the page's own WebSocket was refused. `resolveOriginPolicy` now takes the production mode as an argument instead of reading it from the environment.
- The README commands were run on a fresh clone: `docker compose up --build` served the headers, and in the dev container `npm ci`, `npm test`, `npm run typecheck` and `npm start` worked as written.

**Test results**
- `npm test`: shared 262, server 146 and client 134, all passing.
- `npm run typecheck`: passes in all workspaces.
- `CI=1 npm run e2e`: 5 passed (4 dev, 1 production). After the cross-platform script change: 5 passed twice with `--workers=1`; with the default workers, tests timed out setting up browser contexts at a host load average above 8, with the old scripts as well.
- Docker `app` from a fresh clone, checked with curl: the exact headers on `/r/<id>` and on a script asset, 405 on POST, index fallback for unknown and traversal paths, polling refused with 400.
- Headless Chromium against the production server: 4 screenshots in `docs/guides/screenshots/08/`, no CSP violations. See `docs/guides/08-test-guide.md`.
