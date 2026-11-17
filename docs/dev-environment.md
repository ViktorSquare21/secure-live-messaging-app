# Runbook: start the development environment

How to get the app, the unit tests and the end-to-end tests running on a developer machine. There are two ways: in Docker (no Node on the host) or on a host with Node 24.

| You have | Use |
|---|---|
| Docker only, or a Node major other than 24 | [Docker](#docker-recommended) |
| Node 24 installed | [Host](#host-with-node-24) |

The repo pins Node 24 LTS (`.nvmrc`, `engines`, the Docker base image) with `engine-strict=true`. Angular 21 doesn't support Node 26, so an install on any other major fails with `EBADENGINE` on purpose.

## Ports

| Port | What | Reachable from |
|---|---|---|
| 4200 | Angular dev server, serves the app and proxies `/socket.io` | The browser, at `http://localhost:4200` |
| 3000 | Socket.IO server, WebSocket only | Only `127.0.0.1` inside the same machine or container, through the dev proxy |
| 3000 (production) | The Node server serving the built app with the security headers, plus Socket.IO on the same origin | The browser, at `http://localhost:3000` after `npm start`; the `app` container publishes it on host port 4200 |

- `CLIENT_PORT` changes the host port Docker publishes for the app (for example `CLIENT_PORT=4310`). For `dev`, compose sets the server's `ALLOWED_ORIGINS` to the same port, so Socket.IO accepts the page on it. The `app` container serves page and socket from one origin and needs no allow-list.
- `PORT` changes the server port; the dev proxy reads the same variable, so both stay in step.

Open the app at `http://localhost:...`, never a LAN IP: WebCrypto works only on `https` or `localhost`.

## Docker (recommended)

Requires Docker with Compose v2. Run every command from the repo root.

`compose.yaml` has two services:

- `dev`: for development. Mounts the source for live reload, keeps `node_modules` in named volumes so host and container installs never mix, and includes Playwright Chromium. It sits in the `dev` profile, so a plain `docker compose up` doesn't start it.
- `app`: builds the client into the image and runs the server in production mode, which serves the built app with the security headers and the relay on one port. No live reload.

### First start

```bash
docker compose build dev
docker compose run --rm dev npm ci
```

`npm ci` fills the named `node_modules` volumes from the lockfile.

### Start the app with live reload

```bash
docker compose up dev
```

Open `http://localhost:4200`. Edits on the host rebuild the client and restart the server. Stop with `Ctrl+C`, then:

```bash
docker compose --profile dev down
```

### Run the checks

```bash
docker compose run --rm dev npm test
docker compose run --rm dev npm run typecheck
docker compose run --rm dev npm run e2e
```

`run` publishes no ports, so these work while `docker compose up dev` is running and alongside other checkouts. `npm run e2e` starts its own dev stack inside the container.

Any other command works the same way, for example `docker compose run --rm dev npm install -w @slm/server <package>@<exact version>`, or `docker compose run --rm dev bash` for a shell.

### Run the app without live reload

```bash
docker compose up --build
```

Starts only `app` at `http://localhost:4200`, served by the Node server in production mode with the Content Security Policy and the other security headers. Rebuild after a source change. Stop with `Ctrl+C` and `docker compose down`.

## Host with Node 24

```bash
nvm use            # or any manager that reads .nvmrc
npm ci
npm run dev        # server and client together; Ctrl+C stops both
```

Open `http://localhost:4200`.

```bash
npm test
npm run typecheck
npx playwright install chromium   # once, before the first e2e run
npm run e2e
```

## When something goes wrong

| Symptom | Cause and fix |
|---|---|
| `EBADENGINE ... Required: {"node":">=24 <25"}` | The host isn't on Node 24. Switch with `nvm use`, or use Docker. |
| `Bind for 127.0.0.1:4200 failed: port is already allocated` | Something else holds 4200, often another checkout. Start with `CLIENT_PORT=4310 docker compose up dev` and open `http://localhost:4310`. |
| A package is missing after pulling a lockfile change | The `node_modules` volumes don't refresh themselves. Run `docker compose run --rm dev npm ci`. |
| `EACCES` errors on `node_modules` | The volumes were created before the image owned those folders. Reset them with `docker compose --profile dev down -v`, then the [first start](#first-start) again. |
| Two checkouts of the repo share containers or volumes | Compose names projects after the folder. Give each checkout its own name: `COMPOSE_PROJECT_NAME=slm-<name> docker compose ...`. |
| `server_start_failed invalid_port` | `PORT` isn't a number from 1 to 65535. Unset it or fix it. |
| The browser can't connect to Socket.IO | In development, open the app on port 4200 (or your `CLIENT_PORT`), not 3000. The server accepts only WebSocket through the proxy; long-polling is refused by design. |
| `server_start_failed missing_client_build` | Production mode found no client build. Use `npm start`, which builds first, or run `npm run build`. |

## Reset everything

```bash
docker compose --profile dev down -v --rmi local
```

Removes the containers, the `node_modules` volumes and the locally built images. Start again from [First start](#first-start).
