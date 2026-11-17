# Secure Live Messaging

A sender shares live-updating text with one receiver through a link. Text is encrypted in the sender's browser (AES-GCM, WebCrypto) and decrypted in the receiver's. The Node + Socket.IO server only relays ciphertext and never has the key or the plaintext.

- Decisions: `docs/architecture-decisions.md` (source of truth)
- Flow and protocol: `docs/implementation-plan.md`
- Tasks: `docs/tasks/` (file new ones with the `secure-live-messaging-task-intake` skill, implement one with the `secure-live-messaging-task-implementation` skill)

## Stack and versions

- **Node 24 LTS.** Angular 21 does not support Node 26. Set it in `engines` and `.nvmrc`.
- **Angular 21 (LTS)** + Angular Material 21: standalone components, signals, zoneless change detection.
- **Server:** Node + TypeScript + Socket.IO.
- **Tests:** Vitest for unit and integration, Playwright for end-to-end.
- **Repo:** npm workspaces `shared/`, `server/`, `client/`. Commit the lockfile and install with `npm ci`.
- **TypeScript:** `strict: true` everywhere, plus `noUncheckedIndexedAccess`. No `any` on any value that crossed the network; such values are `unknown` until a shared validator accepts them.

## Security rules (non-negotiable)

### Key and plaintext
- The key lives only in the receiver link's URL fragment (`/r/<id>#<key>`) and in the sender tab's sessionStorage (D5). Never put it in a query string, route parameter, socket payload, log line, error message or analytics.
- Never send `location.href` or `location.hash` anywhere. Use `location.pathname` when a URL is needed.
- Plaintext never leaves the browser. The only thing published is the encrypted envelope.

### Crypto (`shared/`)
- Use only the WebCrypto API (`crypto.subtle`). No third-party crypto library, no hand-rolled primitives.
- AES-GCM-256 with a fresh 12-byte IV from `crypto.getRandomValues` for every message. Never derive, reuse or count IVs.
- Always bind the session id and seq as additional authenticated data (`slm:v1|<sessionId>|<seq>`). Changing that format is a protocol version bump.
- The receiver imports the key as non-extractable.
- Decrypt returns a result (`ok | integrity_error | malformed`) and never throws to the UI. On failure, show no partial output.
- The receiver accepts text only if decryption succeeds **and** `seq > lastAcceptedSeq`. Anything else keeps the last good text and shows the integrity warning.
- Secrets (session id, sender token, receiver rejoin token) come from `crypto.randomBytes` or `crypto.getRandomValues` and are at least 128 bits (256 bits for tokens). `Math.random` is never used for anything security-related.
- base64url is unpadded and decoded strictly. Reject anything that doesn't round-trip.

### Server
- Treat every inbound value as hostile. Run the shared validator before a payload reaches the session core. Unknown fields are rejected, not ignored.
- Never trust a client's claimed role. The role comes from which slot the socket holds in the core.
- Store only a SHA-256 hash of each token and compare with `crypto.timingSafeEqual` over equal-length hashes.
- Socket.IO settings:
  - `transports: ['websocket']` on both server and client.
  - `cors.origin` is an explicit allow-list, never `*` or `true`.
  - `maxHttpBufferSize` just above the 64 KB envelope cap (about 80 KB).
  - `serveClient: false`.
  - `perMessageDeflate: false`. Ciphertext doesn't compress, and compression next to secrets invites side channels.
  - Leave `connectionStateRecovery` off. Resync goes through our own rejoin, which re-applies the seq rule.
- Every handler requires an ack callback and answers with a fixed error code. Never send stack traces or internal messages to the client.
- Bound the memory: cap the total number of sessions, rate-limit `session:create` and `message:publish` per socket, and expire idle sessions (the TTL is passed into the core as a value).
- Logs carry event names, outcome codes and counts only: no ciphertext, tokens, keys or session ids.
- When serving the built client, send these headers:
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'`
  - `Referrer-Policy: no-referrer`
  - `X-Content-Type-Options: nosniff`

### Angular
- Render untrusted text only through interpolation (`{{ }}`) or form values. Never use `[innerHTML]`, `bypassSecurityTrust*`, `ElementRef.nativeElement.innerHTML`, or `document.write`.
- No third-party origins: self-host fonts and icons, or use system fonts. No CDN links in `index.html`.
- Set `optimization.styles.inlineCritical: false` in the production build. Critical-CSS inlining adds an inline event handler that the CSP blocks.
- Keep Angular's Trusted Types support working: don't add code that writes HTML strings into the DOM.

### Dependencies
- Add a dependency only when it removes real work. Prefer the platform: WebCrypto, `crypto`, RxJS, which already ships with Angular.
- `npm audit --omit=dev` must be clean before merging. Pin exact versions for `socket.io` and `socket.io-client`, and keep them on the same minor version.

## Performance rules

### Server
- Session lookups go through a `Map` keyed by session id, O(1). No scans across sessions on the message path.
- Relay the envelope as received after validation. Don't copy, re-encode or re-serialize it.
- Emit to the one receiver socket (`io.to(socketId)`), never broadcast.
- The expiry sweep runs on an interval timer with `.unref()`, and is cleared on shutdown so tests exit cleanly.
- Never block the event loop. No sync crypto or sync file I/O on the request path.

### Client
- The sender pipeline is described under "RxJS" below.
- Use zoneless change detection, with `ChangeDetectionStrategy.OnPush` on every component.
- Lazy-load the sender and receiver routes. Import only the Material components each page uses.
- Keep the production budgets in `angular.json`. Build-size warnings are failures, not noise.
- Import the key once per page and reuse the `CryptoKey`. Don't re-import it for every message.

## Angular conventions

### Components
- Standalone components only, with `ChangeDetectionStrategy.OnPush`. Use `inject()` instead of constructor parameters.
- Pages (routed) are thin: they read signals from services and forward user events. Logic lives in pure functions or services.
- Put host bindings and listeners in the `host` object of `@Component`, not in `@HostBinding` / `@HostListener`.
- Templates use the built-in `@if` / `@for` / `@switch`, with a `track` expression on every `@for`. Call only signals in templates, never methods that compute something.

### Inputs and outputs
- Use `input()` and `input.required()`, never `@Input()`. Inputs are read-only signals; derive from them with `computed()` and never copy them into mutable fields.
- Use `transform` (for example `booleanAttribute`) instead of parsing an input in the component body.
- Use `output()`, never `@Output()` with `EventEmitter`. Emit plain values that describe what happened (`textChanged`), not commands for the parent.
- Use `model()` only for genuine two-way bindings, such as a custom form control.

### Signals
- Derive state with `computed()`. A computed is pure: no signal writes, no I/O, no subscriptions inside it.
- Use `linkedSignal()` for local state that must reset when a source changes but can also be edited locally.
- Use `effect()` only to push state out to non-Angular APIs (sessionStorage, the clipboard). Never use an effect to copy one signal into another; that is a `computed()` or `linkedSignal()`.
- Services keep writable signals `private` and expose them with `.asReadonly()`. State changes go through named service methods.
- For state transitions with rules (the receiver state), use a pure reducer and hold its result in one signal. Don't scatter related state across several signals that must change together.
- Bridge RxJS into templates with `toSignal()` (with `initialValue` or `requireSync`) in an injection context. Use `toObservable()` only when an RxJS operator is really needed.

## RxJS

### Mapping strategies
Choose the flattening operator by what should happen when a new value arrives while the previous inner work is still running:

| Operator | Behaviour | Use here for |
|---|---|---|
| `concatMap` | Queue: run one at a time, in order | Publishing envelopes, because seq order must match send order |
| `switchMap` | Cancel the previous one, keep the latest | Reads where only the latest matters, such as route param → join session |
| `exhaustMap` | Ignore new values while busy | The "New session" button, so a double click can't create two sessions |
| `mergeMap` | Run everything in parallel, unordered | Avoid in this app: nothing here is order-independent |

- **The sender pipeline:** `debounceTime(300)` → `distinctUntilChanged()` → `concatMap(encrypt and publish)`.
  - Assign seq inside the `concatMap`, when the item is actually sent, never when it is queued.
  - Inside the `concatMap`, skip an item whose text is no longer the latest typed text. This keeps the queue at one in practice.
- Never use `switchMap` to publish, even though "latest text wins" looks like type-ahead search. Type-ahead cancels reads, which is harmless. Here, cancelling can't recall an emit already on the wire; it only drops that publish's ack, so rejections go unseen and the "last sent" indicator lies. If the emit sits in a promise callback, an older envelope can also leave after a newer one and be rejected as `stale_seq`. The debounce plus the skip-stale check in `concatMap` already give "latest wins" without losing acks.

### Rules
- No nested `subscribe`. Compose with operators instead.
- Put `catchError` on the inner observable, so one failed publish doesn't end the outer stream.
- Retry with `retry({ count, delay })` and exponential backoff, never in a tight loop.
- Every manual subscription in a component or service ends with `takeUntilDestroyed()`. Prefer `toSignal()`, which cleans up on its own.
- Wrap Socket.IO events in an `Observable` whose teardown calls `socket.off` for that handler.
- Expose `Subject`s only as `.asObservable()`. Use `shareReplay({ bufferSize: 1, refCount: true })` when a stream is shared, and never without `refCount`.

## Testing rules
- Pure cores (crypto envelope, validators, session core, receiver state) get direct unit tests: no mocks, no sockets.
- Integration tests start the real server on port 0, use `socket.io-client` with WebSocket transport, and close every client and the server in `afterEach`.
- Never wait with a fixed sleep. Await the event with a timeout, use Vitest fake timers for debounce and backoff, and rely on Playwright's auto-retrying assertions.
- Every security rule above has at least one negative test. Examples: a flipped ciphertext bit is rejected, a replayed seq is rejected, a receiver cannot publish, a second receiver is refused, oversized payloads are refused, the key never appears in a socket frame, and HTML in the text is shown literally.
- End-to-end tests use two browser contexts (sender and receiver) with real WebCrypto, and include at least two consecutive updates.

## Commands
- `npm ci`: install
- `npm run dev`: server and client with the dev proxy
- `npm test`: Vitest in all workspaces
- `npm run e2e`: Playwright

## Writing in this repo
- Code, docs, commits and PRs describe the product only. Never write about where the project came from.
- Docs that get committed live in `docs/`. The README is at the root.
