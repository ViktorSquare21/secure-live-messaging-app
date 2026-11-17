# [Feature] Set up the workspaces, test runners, WebSocket dev proxy and a Docker setup to run the app

**Role:** Operator
**Surface:** Shared, Server, Client, Tests
**Estimate:** 35 min

## Goal
A developer can clone the repo, install once, and run the app, the unit suites and the end-to-end suite from the root, with every later task landing in a ready-made place. Someone with only Docker installed can run the app with one command.

## User story
As a developer, I want one install and four root commands (dev, test, typecheck, e2e) that work across shared, server and client, so that each later task only adds behaviour and never has to set up tooling.

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
  - typecheck compiles all three workspaces without emitting files and fails on any type error.
- **Ignored files:** a `.gitignore` covers installed packages, build output, Playwright reports and test results, and local environment files.
- **No third-party origins:** the Material setup adds no font or icon links to other hosts in the index page; the app uses system fonts until fonts are self-hosted.
- **Node version:** Node 24 LTS is pinned for the repo in three places that must agree: the Node version file, the engines field of the root package, and the Docker base image. Installing with a different Node version fails at once with a clear message (strict engine check), instead of failing later in a confusing way.
- **Docker:** the repo can be run and developed without Node installed on the host. The compose file has two services: `app` to run the app, and `dev` for development and the test suites.
  - One image, built from the official slim Node 24 image, installs the dependencies from the lockfile and contains the three workspaces.
  - One compose file at the root starts the `app` service with a single command (`docker compose up --build`). It runs the same dev command as on the host, so the app is reachable at `http://localhost:4200` and the browser reaches Socket.IO through the same dev proxy.
  - Only the client port is published to the host. The server port stays inside the container.
  - Inside the container the Angular dev server listens on all interfaces, otherwise the published port reaches nothing. On the host it keeps listening on localhost only.
  - For `app`, the source is copied into the image at build time, not mounted.
  - The `dev` service uses an image from the same Node 24 base with the Playwright Chromium browser and its system libraries installed. It mounts the repo source, keeps `node_modules` in named volumes so host and container installs never mix, and starts the dev command with live reload. The root commands run inside it, for example `docker compose run --rm dev npm ci`, `docker compose run --rm dev npm test`, `docker compose run --rm dev npm run typecheck` and `docker compose run --rm dev npm run e2e`.
  - The `dev` service publishes no port unless started explicitly for the browser (`docker compose up dev`, client port only), so several checkouts can run their tests side by side.
  - The process runs as the image's non-root user.
  - A Docker ignore file keeps installed packages, build output, test reports, git data, local environment files and anything else not needed to run the app out of the image.
  - The dependency install is its own image layer, before the source is copied, so a source change doesn't reinstall everything.

## Security considerations
- The WebSocket-only rule (D2) is set from day one on the server; no HTTP long-polling endpoint is ever reachable, even in development.
- The proxy forwards only the Socket.IO path, so nothing else reaches the server through the dev setup.
- The container publishes only the client port and runs as a non-root user. The image contains no local environment files and no secrets; the app needs none to start.
- The browser's WebCrypto API works only on `https` or `localhost`. The Docker setup is for `http://localhost` on the same machine; serving it to other machines needs TLS in front, which is out of scope here.
- No logging of request URLs or bodies is added to the server shell. Later tasks must not have to remove something that could leak a key or plaintext (invariant 1).

## Tests
- [ ] Unit: running the root test command from a clean install runs one smoke test in each of shared, server and client and exits successfully.
- [ ] Unit: a deliberately failing test in any one workspace makes the root test command exit with a failure.
- [ ] Unit: the client smoke test renders the placeholder root component under Vitest, proving the Angular test runner is wired.
- [ ] End-to-end: running the root e2e command starts the stack and exits successfully with no tests present.
- [ ] Manual: on a machine with Docker, the compose command builds the image and starts the app; the placeholder page loads at `http://localhost:4200`, the WebSocket upgrade on the Socket.IO path succeeds, and the server port is not reachable from the host.
- [ ] Manual: `docker compose run --rm dev npm ci`, then `npm test`, `npm run typecheck` and `npm run e2e` in the `dev` service, all succeed with no Node on the host.
- [ ] Manual: running the install with a Node major other than 24 fails with a message naming the required version.
- [ ] Manual: with the dev command running, opening the app in a browser shows a WebSocket upgrade on the Socket.IO path to the app's own origin that succeeds, and no long-polling requests appear in the network panel.

## Acceptance criteria
- [ ] One install at the root sets up shared, server and client, and server and client resolve shared by its package name.
- [ ] The root test command runs the Vitest suites of all three workspaces and exits successfully.
- [ ] The root dev command serves the Angular placeholder page and the Socket.IO server together, and a browser on the Angular dev origin connects to Socket.IO through the proxy over WebSocket.
- [ ] The server refuses long-polling connections; only WebSocket transport is accepted.
- [ ] The root e2e command runs Playwright and passes with no tests yet.
- [ ] The root typecheck command passes: all three workspaces compile under the shared strict TypeScript configuration with no errors.
- [ ] The index page loads nothing from another host.
- [ ] One Docker compose command builds and starts the app on Node 24 without Node on the host, and the placeholder page and its socket connection work at `http://localhost:4200`.
- [ ] The `dev` compose service installs, runs the dev stack with live reload from the mounted source, and runs the test, typecheck and e2e commands.
- [ ] The Node version file, the engines field and the Docker base image all name Node 24, and an install on another major fails.

## Out of scope
- Crypto envelope, key generation and fragment handling (01).
- Protocol event names, payload types and validators (02).
- Session rules and the pure session core (03).
- Socket.IO event handlers, origin allow-list, buffer size limit, expiry sweep and integration tests (04).
- Angular socket service, receiver state and sender publishing (05).
- Home, sender and receiver pages, routes and Material components beyond the theme (06).
- Real end-to-end scenarios with two browser contexts (07).
- Security headers on the static build, production serving and the README (08). Task 08 switches the container to the production start once that exists.
- A CI pipeline.
- TLS, a reverse proxy, and publishing the image to a registry.

## Notes / open questions
- Decision: the client uses the newest Angular major that is under long-term or active support and ships the Vitest unit-test builder; Karma and Jasmine are not used.
- Decision: shared is consumed as TypeScript source, with no build step during development. If the Angular build refuses source outside its project, add a path mapping rather than a separate build.
- Decision: the server in this task is a bare Socket.IO server with no events, only so the proxy and the WebSocket-only rule can be checked now.
- Decision: the Playwright suite lives at the root, outside the three workspaces, because it drives the whole stack rather than one package.
- Decision: development ports are 4200 for the client and 3000 for the server.
- Decision: the `app` container runs the dev command for now, because the server can't serve the built client until task 08. Task 08 changes the `app` service's command to the production start and its published port to the server's.
- Decision: development and the test suites run in the `dev` container as well as on a host with Node 24. The repo works either way; the container is the default when the host has another Node major.
- Decision: the Docker checks are manual, since the test suites must also pass on a machine without Docker. If Docker isn't available where the task is implemented, the files are still written and the check is recorded as not run.
- Decision: the proxy check is manual here; automated coverage of the full socket path arrives with the integration tests (04) and the end-to-end tests (07).

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.
