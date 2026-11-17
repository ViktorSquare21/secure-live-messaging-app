# [Feature] Set up the workspaces, test runners and WebSocket dev proxy

**Role:** Operator
**Surface:** Shared, Server, Client, Tests
**Estimate:** 25 min

## Goal
A developer can clone the repo, install once, and run the app, the unit suites and the end-to-end suite from the root, with every later task landing in a ready-made place.

## User story
As a developer, I want one install and three root commands (dev, test, e2e) that work across shared, server and client, so that each later task only adds behaviour and never has to set up tooling.

## Context
Decisions D2, D3, D6 and D7 fix the stack: npm workspaces for shared, server and client; Angular LTS with Material; Node, TypeScript and Socket.IO on WebSocket transport only; Vitest everywhere plus Playwright. Every other task depends on this one.

## Current behaviour
Doesn't exist. The repo holds only docs.

## Desired behaviour
- **Workspaces:** one root package with three npm workspaces, shared, server and client. A single install at the root installs all of them. Server and client depend on shared by its package name, so the protocol and crypto code have one home.
- **Shared:** a TypeScript package with no runtime dependencies and no build step during development; server and client consume its TypeScript source directly. It contains no logic yet, only what is needed for its test suite to run.
- **Server:** Node with TypeScript, run in development with tsx in watch mode. It starts a Socket.IO server on a fixed development port (3000, overridable by an environment variable) with WebSocket as the only allowed transport. It registers no events yet; the handlers come later.
- **Client:** an Angular app on the current LTS major, with standalone components, Angular Material installed with one prebuilt theme, and Vitest as the unit test runner. The app shows a single placeholder page; routes come later. The Socket.IO client package is installed but not wired up.
- **Dev proxy:** the Angular development server forwards the Socket.IO path to the server on the development port with WebSocket forwarding turned on, so the browser connects to its own origin and never needs a cross-origin URL in development.
- **Strict TypeScript:** all three workspaces share one strict base configuration, so the crypto and validation code written later is type-checked strictly from the start.
- **Root scripts:**
  - dev starts the server and the Angular dev server together from one command, and stopping it stops both.
  - test runs the Vitest suite of each workspace in turn and fails if any of them fails.
  - e2e runs Playwright from the root against the running app (Chromium only), starting the dev stack itself. It passes when there are no end-to-end tests yet.
- **Node version:** the required Node LTS version is pinned for the repo, so everyone runs the same runtime.

## Security considerations
- The WebSocket-only rule (D2) is set from day one on the server; no HTTP long-polling endpoint is ever reachable, even in development.
- The proxy forwards only the Socket.IO path, so nothing else reaches the server through the dev setup.
- No logging of request URLs or bodies is added to the server shell. Later tasks must not have to remove something that could leak a key or plaintext (invariant 1).

## Tests
- [ ] Unit: running the root test command from a clean install runs one smoke test in each of shared, server and client and exits successfully.
- [ ] Unit: a deliberately failing test in any one workspace makes the root test command exit with a failure.
- [ ] Unit: the client smoke test renders the placeholder root component under Vitest, proving the Angular test runner is wired.
- [ ] End-to-end: running the root e2e command starts the stack and exits successfully with no tests present.
- [ ] Manual: with the dev command running, opening the app in a browser shows a WebSocket upgrade on the Socket.IO path to the app's own origin that succeeds, and no long-polling requests appear in the network panel.

## Acceptance criteria
- [ ] One install at the root sets up shared, server and client, and server and client resolve shared by its package name.
- [ ] The root test command runs the Vitest suites of all three workspaces and exits successfully.
- [ ] The root dev command serves the Angular placeholder page and the Socket.IO server together, and a browser on the Angular dev origin connects to Socket.IO through the proxy over WebSocket.
- [ ] The server refuses long-polling connections; only WebSocket transport is accepted.
- [ ] The root e2e command runs Playwright and passes with no tests yet.
- [ ] All three workspaces compile under the shared strict TypeScript configuration with no errors.

## Out of scope
- Crypto envelope, key generation and fragment handling (01).
- Protocol event names, payload types and validators (02).
- Session rules and the pure session core (03).
- Socket.IO event handlers, origin allow-list, buffer size limit, expiry sweep and integration tests (04).
- Angular socket service, receiver state and sender publishing (05).
- Home, sender and receiver pages, routes and Material components beyond the theme (06).
- Real end-to-end scenarios with two browser contexts (07).
- Security headers on the static build, production serving and the README (08).

## Notes / open questions
- Decision: the client uses the newest Angular major that is under long-term or active support and ships the Vitest unit-test builder; Karma and Jasmine are not used.
- Decision: shared is consumed as TypeScript source, with no build step during development. If the Angular build refuses source outside its project, add a path mapping rather than a separate build.
- Decision: the server in this task is a bare Socket.IO server with no events, only so the proxy and the WebSocket-only rule can be checked now.
- Decision: the Playwright suite lives at the root, outside the three workspaces, because it drives the whole stack rather than one package.
- Decision: development ports are 4200 for the client and 3000 for the server.
- Decision: the proxy check is manual here; automated coverage of the full socket path arrives with the integration tests (04) and the end-to-end tests (07).

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.
