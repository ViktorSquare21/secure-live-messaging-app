# Test guide: 01 Shared AES-GCM-256 envelope with key-in-fragment encoding and non-throwing decrypt

## What this covers
The crypto envelope in `shared/`: generating a session key, exporting it to a link fragment and importing it back, encrypting a text update into an envelope, and decrypting it only when it is authentic for this session id and seq. It verifies every acceptance criterion of `docs/tasks/01-crypto-envelope.md`.

## Before you start
- Node 24 LTS on the host (`nvm use`), or only Docker. All steps below ran through Docker, because the host had another Node major.
- Install once: `docker compose run --rm dev npm ci` (or `npm ci` on a Node 24 host).
- No app needs to run: this task adds a library with no page and no server change.

## Automated tests
Run in the `dev` service, or the same commands on a Node 24 host without the `docker compose run --rm dev` prefix:

| Command | Result |
|---|---|
| `docker compose run --rm dev npm test` | shared 115 tests in 4 files, server 14, client 4; all passing |
| `docker compose run --rm dev npm run typecheck` | all three workspaces compile with no errors |
| `docker compose run --rm dev npm audit --omit=dev` | `found 0 vulnerabilities` |

What the shared tests prove:
- `shared/src/crypto-envelope.test.ts`: round-trips (directly, through the exported fragment, with a leading `#`, with accents, emoji, line breaks, HTML and empty text). integrity_error for a flipped ciphertext, tag or IV bit, a seq changed 5→6 and 5→4, a different key, and a different session id. 1000 encryptions give 1000 distinct IVs. The envelope shape. Encrypt refuses seq 0, negative, fractional, NaN and beyond the safe range. The fragment is 43 base64url characters. The imported key is non-extractable and export fails. Every malformed fragment and envelope case resolves to malformed without throwing. No failure result carries the plaintext. A full flow makes no `fetch` or `console` call.
- `shared/src/envelope.test.ts`: the exact AAD bytes `slm:v1|<sessionId>|<seq>`, the seq rule's boundaries, and every shape the envelope parser rejects.
- `shared/src/base64url.test.ts`: the codec round-trips all byte values and rejects padding, `+`, `/`, whitespace, other characters, a length remainder of one, and non-zero trailing bits.

Both typecheck runs matter: `shared` compiles with the browser (DOM) typings and `server` compiles the same source with the Node typings, so the module uses nothing that only one side has.

## Manual steps
1. Run a sender-to-receiver round trip in Node 24 from the `shared/` folder:
   ```sh
   docker compose run --rm dev sh -c 'cd shared && npx tsx -e "
   import { generateKey, exportKeyToFragment, importKeyFromFragment, encrypt, decrypt } from \"./src/index.ts\";
   (async () => {
     const key = await generateKey();
     const fragment = await exportKeyToFragment(key);
     console.log(\"fragment length:\", fragment.length);
     const imported = await importKeyFromFragment(\"#\" + fragment);
     if (imported.status !== \"ok\") throw new Error(\"import failed\");
     const env = await encrypt(key, \"demo-session\", 1, \"Hello <b>world</b> 👋\");
     console.log(\"envelope keys:\", Object.keys(env).join(\",\"), \"| iv length:\", env.iv.length);
     console.log(\"ok:\", JSON.stringify(await decrypt(imported.key, \"demo-session\", env)));
     console.log(\"other session:\", JSON.stringify(await decrypt(imported.key, \"other-session\", env)));
     console.log(\"changed seq:\", JSON.stringify(await decrypt(imported.key, \"demo-session\", { ...env, seq: 2 })));
     console.log(\"garbage:\", JSON.stringify(await decrypt(imported.key, \"demo-session\", \"garbage\")));
     console.log(\"bad fragment:\", JSON.stringify(await importKeyFromFragment(fragment.slice(1))));
     console.log(\"receiver key extractable:\", imported.key.extractable);
   })();
   "'
   ```
   **Expected and observed:**
   ```
   fragment length: 43
   envelope keys: v,seq,iv,ct | iv length: 16
   ok: {"status":"ok","text":"Hello <b>world</b> 👋","seq":1}
   other session: {"status":"integrity_error"}
   changed seq: {"status":"integrity_error"}
   garbage: {"status":"malformed"}
   bad fragment: {"status":"malformed"}
   receiver key extractable: false
   ```

## Failure cases
Covered by step 1: a different session id and a changed seq give `integrity_error`, a non-object envelope and a 42-character fragment give `malformed`, and nothing throws. The full list of rejected inputs is in the automated tests above.

## Not covered
- Running the module inside a real browser. The source uses only `globalThis.crypto` and type-checks against the browser typings, and the Playwright runs in tasks 06 and 07 exercise it in Chromium.
- The size cap and the network-level envelope validator (task 02), the server's increasing-seq rule (task 03), and the receiver's "seq must be newer" rule (task 05).
- No screenshots: this task changes nothing visible in a browser.
