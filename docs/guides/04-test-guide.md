# Test guide: 04 Socket.IO relay server wires the session core to live sender and receiver sockets

## What this covers
The running Socket.IO server relays encrypted updates from one sender to one receiver, refuses everything the session rules forbid, and logs only event names, outcome codes and counts. It verifies all eight acceptance criteria of `docs/tasks/04-socket-server-integration.md`: ordered byte-identical relay over WebSocket, the latest envelope for a late receiver, `not_sender` for any other socket, blind relay of a tampered envelope, sender reconnect with peer status, rate limits and the session cap, the expiry sweep and its timer, and logs free of IVs, ciphertext, tokens and keys.

## Before you start
- Docker. The host may run any Node version; every command below runs in the Node 24 dev container (`.nvmrc`).
- Nothing else may listen on port 3000 inside the container. The scenarios start their own server and stop it.
- Build the container once: `docker compose build dev`.

## Automated tests
```sh
docker compose run --rm dev npm test
docker compose run --rm dev npm run typecheck
```
Result: shared 262, server 113, client 4 tests, all passing; the type check passes in all three workspaces.

The server tests that matter for this task are `server/src/relay.test.ts` (the integration tests: a real server on port 0 with `socket.io-client` over WebSocket) and the unit tests `origin-policy.test.ts`, `event-intake.test.ts`, `log.test.ts`, `session-store.test.ts` and `socket-options.test.ts`.

## Manual steps
1. Run this whole block from the repo root in one paste. It starts the real server (`server/src/main.ts`) in the dev container, drives one sender and one receiver through a session with real encryption, prints the outcome of each step, and then prints the server log. It prints no ids, tokens or ciphertext. No file is created.

```sh
docker compose run --rm -T dev sh <<'EOF'
cd server
touch /tmp/server.log
npx tsx src/main.ts > /tmp/server.log 2>&1 &
SERVER=$!
until grep -q server_listening /tmp/server.log; do sleep 0.2; done
npx tsx -e "
import { io } from 'socket.io-client';
import { EVENTS, generateKey, encrypt, decrypt, decodeBase64Url, encodeBase64Url } from '@slm/shared';
const url = 'http://127.0.0.1:3000';
const open = (origin: string) => new Promise<any>((ok) => { const s = io(url, { transports: ['websocket'], reconnection: false, extraHeaders: { origin } }); s.on('connect', () => ok(s)); s.on('connect_error', () => ok(null)); });
const ask = (s: any, ev: string, ...a: unknown[]) => s.timeout(2000).emitWithAck(ev, ...a);
const out = (label: string, v: unknown) => console.log(label.padEnd(34), v);
const code = (a: any) => a.ok ? 'ok' : a.error;
(async () => {
out('connect from evil.example', (await open('http://evil.example')) ? 'connected' : 'refused');
const sender = await open('http://localhost:4200'); const receiver = await open('http://localhost:4200');
out('connect from localhost:4200', sender && receiver ? 'connected' : 'refused');
const created = await ask(sender, EVENTS.sessionCreate);
out('session:create', code(created) + ', id bytes ' + decodeBase64Url(created.sessionId)!.length + ', token bytes ' + decodeBase64Url(created.senderToken)!.length);
const { sessionId, senderToken } = created;
out('sender:join', code(await ask(sender, EVENTS.senderJoin, { sessionId, senderToken })));
const key = await generateKey();
const first = await encrypt(key, sessionId, 1, 'hello');
out('publish seq 1 (no receiver yet)', code(await ask(sender, EVENTS.messagePublish, first)));
const updates: any[] = []; receiver.on(EVENTS.messageUpdate, (e: any) => updates.push(e));
const statuses: string[] = []; receiver.on(EVENTS.peerStatus, (p: any) => statuses.push(p.peer));
const joined = await ask(receiver, EVENTS.receiverJoin, { sessionId });
out('receiver:join', code(joined) + ', latest is seq 1: ' + (JSON.stringify(joined.latest) === JSON.stringify(first)));
const second = await encrypt(key, sessionId, 2, 'hello world');
out('publish seq 2', code(await ask(sender, EVENTS.messagePublish, second)));
out('publish seq 2 again', code(await ask(sender, EVENTS.messagePublish, second)));
out('publish from receiver', code(await ask(receiver, EVENTS.messagePublish, await encrypt(key, sessionId, 3, 'x'))));
const ct = decodeBase64Url(second.ct)!; ct[0] ^= 1;
const tampered = { ...(await encrypt(key, sessionId, 3, 'x')), ct: encodeBase64Url(ct) };
out('publish tampered seq 3', code(await ask(sender, EVENTS.messagePublish, tampered)));
out('second receiver', code(await ask(await open('http://localhost:4200'), EVENTS.receiverJoin, { sessionId })));
out('wrong sender token', code(await ask(await open('http://localhost:4200'), EVENTS.senderJoin, { sessionId, senderToken: encodeBase64Url(new Uint8Array(32)) })));
await ask(receiver, EVENTS.senderJoin, {});
out('receiver got updates (seq)', updates.map((e) => e.seq).join(', '));
out('seq 2 byte-identical', JSON.stringify(updates[0]) === JSON.stringify(second));
out('decrypt seq 2', (await decrypt(key, sessionId, updates[0])).status);
out('decrypt tampered seq 3', (await decrypt(key, sessionId, updates[1])).status);
sender.close();
await new Promise((ok) => receiver.once(EVENTS.peerStatus, ok));
const back = await open('http://localhost:4200');
out('sender rejoins on a new socket', code(await ask(back, EVENTS.senderJoin, { sessionId, senderToken })));
out('publish seq 4', code(await ask(back, EVENTS.messagePublish, await encrypt(key, sessionId, 4, 'back'))));
await ask(receiver, EVENTS.senderJoin, {});
out('receiver peer statuses', statuses.join(' -> '));
out('receiver got updates (seq)', updates.map((e) => e.seq).join(', '));
process.exit(0);
})();
"
kill $SERVER
echo '--- server log ---'
cat /tmp/server.log
EOF
```

**Expected (actual output):**
```
connect from evil.example          refused
connect from localhost:4200        connected
session:create                     ok, id bytes 16, token bytes 32
sender:join                        ok
publish seq 1 (no receiver yet)    ok
receiver:join                      ok, latest is seq 1: true
publish seq 2                      ok
publish seq 2 again                stale_seq
publish from receiver              not_sender
publish tampered seq 3             ok
second receiver                    slot_taken
wrong sender token                 bad_token
receiver got updates (seq)         2, 3
seq 2 byte-identical               true
decrypt seq 2                      ok
decrypt tampered seq 3             integrity_error
sender rejoins on a new socket     ok
publish seq 4                      ok
receiver peer statuses             connected -> disconnected -> connected
receiver got updates (seq)         2, 3, 4
--- server log ---
server_listening port=3000
event=connect count=1
event=connect count=2
event=session:create outcome=ok
event=sender:join outcome=ok
event=message:publish outcome=ok
event=receiver:join outcome=ok
event=message:publish outcome=ok
event=message:publish outcome=stale_seq
event=message:publish outcome=not_sender
event=message:publish outcome=ok
event=connect count=3
event=receiver:join outcome=slot_taken
event=connect count=4
event=sender:join outcome=bad_token
event=sender:join outcome=invalid_payload
event=disconnect count=3
event=connect count=4
event=sender:join outcome=ok
event=message:publish outcome=ok
event=sender:join outcome=invalid_payload
event=disconnect count=3
event=disconnect count=2
event=disconnect count=1
event=disconnect count=0
```

What to check in it:
- The receiver gets seq 2, then the tampered seq 3, then seq 4, in that order. Seq 1 reached it only through the join ack, as `latest`.
- The server relayed the tampered envelope (`ok`); only the receiver's decrypt catches it (`integrity_error`).
- The receiver sees the sender go and come back (`connected -> disconnected -> connected`), and the reconnected sender publishes again.
- The log has only `event=`, `outcome=` and `count=` fields. The `sender:join outcome=invalid_payload` lines are the receiver's round trips that make sure all updates have arrived before printing them.

## Failure cases
1. Run this block from the repo root in one paste. It tries connections the server must refuse, exceeds the default create limit (5 per minute per socket), sends an event without an ack callback, and sends a frame over the 80 KB buffer cap.

```sh
docker compose run --rm -T dev sh <<'EOF'
cd server
touch /tmp/server.log
npx tsx src/main.ts > /tmp/server.log 2>&1 &
SERVER=$!
until grep -q server_listening /tmp/server.log; do sleep 0.2; done
npx tsx -e "
import { io } from 'socket.io-client';
import { EVENTS } from '@slm/shared';
const url = 'http://127.0.0.1:3000';
const open = (extra: object) => new Promise<any>((ok) => { const s = io(url, { reconnection: false, ...extra }); s.on('connect', () => ok(s)); s.on('connect_error', () => ok(null)); });
const out = (label: string, v: unknown) => console.log(label.padEnd(34), v);
(async () => {
  out('no Origin header', (await open({ transports: ['websocket'] })) ? 'connected' : 'refused');
  out('long-polling only', (await open({ transports: ['polling'], extraHeaders: { origin: 'http://localhost:4200' } })) ? 'connected' : 'refused');
  const s = await open({ transports: ['websocket'], extraHeaders: { origin: 'http://localhost:4200' } });
  const codes: string[] = [];
  for (let i = 0; i < 6; i++) { const a = await s.timeout(2000).emitWithAck(EVENTS.sessionCreate); codes.push(a.ok ? 'ok' : a.error); }
  out('6 session creates on one socket', codes.join(' '));
  out('create without ack', (s.emit(EVENTS.sessionCreate), 'sent'));
  const dropped = new Promise((ok) => s.once('disconnect', ok));
  s.emit(EVENTS.messagePublish, { v: 1, seq: 1, iv: 'A', ct: 'A'.repeat(100 * 1024) }, () => {});
  out('100 KB frame', 'socket ' + (await dropped));
  process.exit(0);
})();
"
kill $SERVER
echo '--- server log ---'
cat /tmp/server.log
EOF
```

**Expected (actual output):**
```
no Origin header                   refused
long-polling only                  refused
6 session creates on one socket    ok ok ok ok ok rate_limited
create without ack                 sent
100 KB frame                       socket transport close
--- server log ---
server_listening port=3000
event=connect count=1
event=session:create outcome=ok
event=session:create outcome=ok
event=session:create outcome=ok
event=session:create outcome=ok
event=session:create outcome=ok
event=session:create outcome=rate_limited
event=session:create outcome=no_ack
event=disconnect count=0
```

The refused connections never reach the relay, so they leave no `connect` line. The event without an ack is logged as `no_ack` and creates nothing. The 100 KB frame is dropped by the transport, which closes that socket.

## Not covered
- **The expiry sweep, the session cap and the publish rate limit** are not in the manual blocks: the TTL (30 min), the cap (1,000 sessions) and the sweep interval (60 s) are too large to hit by hand. `relay.test.ts` covers them with lowered values, an injected clock and fake interval timers, and checks that the sweep timer is gone after the server stops.
- **A receiver rejoin with its token** while its old socket is open is covered by `relay.test.ts` only.
- **The production same-origin default** (`NODE_ENV=production` without `ALLOWED_ORIGINS`) is covered by `origin-policy.test.ts` and `socket-options.test.ts`; nothing serves the built client on the server's origin until task 08.
- **No browser check and no screenshots:** this task has no page. The sender and receiver pages come with task 06 and the two-browser tests with task 07.
