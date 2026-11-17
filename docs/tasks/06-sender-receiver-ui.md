# [Feature] Home, sender and receiver pages with Material, plain-text rendering and clear error states

**Role:** Sender, Receiver
**Surface:** Client, Tests
**Estimate:** 40 min
**Depends on:** 05

## Goal
A sender can start a session, copy the receiver link to share it on another platform, and type into a text input; a receiver sees that text displayed and updated live, and sees clearly when something is wrong.

## User story
As a sender, I want to start a session, copy a link and see whether my receiver is connected, so that I know my text is reaching them. As a receiver, I want to see the latest text live and a clear warning when an update is rejected or the link is broken, so that I never mistake bad data for the real text.

## Context
The UI is the last layer over the client services and pure receiver state from task 05. Angular Material is a fixed requirement (D3). Plain-text rendering (invariant 6) and "keep the last good text on failure" (invariant 2) must be visible here, because this is where users see the results.

## Current behaviour
Doesn't exist. Task 05 provides the socket service, the sender publish pipeline and the pure receiver reducer, but no pages.

## Desired behaviour

**General**
- Three routes: home at the root, the sender page under the session path (no key in its URL; key, token and seq come from tab storage via task 05), and the receiver page under the receiver path with the key in the fragment. Unknown routes go to home.
- Pages are thin. They wire user input into the task 05 services and display the state those services and the receiver reducer produce. No session rules, sequence checks or crypto decisions in the components.
- All text the user typed or received is shown through normal Angular text binding, never as HTML. Line breaks and spacing are preserved by styling (pre-wrapped text), not by converting to markup.
- Every element the end-to-end task needs (new-session button, sender textarea, receiver link, copy button, peer status, last-sent indicator, receiver text, receiver status, integrity banner, key error) can be found by its role and accessible name (a button's name, a field's label, a status or alert region's label), not by Material's internal markup. No test-only attributes are added. The accessible names stay stable even if the surrounding wording is adjusted.

**Home**
- One "New session" button. Clicking it generates the key, creates the session through the task 05 service and navigates to the sender page.
- The button is disabled while the request is in flight. If creating fails (including server busy or rate limited) or the server is unreachable, a short error is shown and the button is enabled again.

**Sender page**
- One multi-line text input (a large textarea) for the text. It is the only editable field in the app. Typing feeds the debounced publish pipeline from task 05; the page does nothing else with the text.
- The receiver link (full origin, receiver path, session id and key fragment) in a read-only field with a copy button. Copying uses the clipboard and confirms with a short snackbar ("Link copied"). If the clipboard is unavailable, the field text is selected instead so it can be copied by hand.
- The sender passes the link to the receiver on another platform (chat, email). A short hint next to the link says so ("Send this link to your receiver"). The app itself never sends the link anywhere.
- A peer status chip: "Waiting for receiver" until a receiver joins, "Receiver connected" while one is present, "Receiver disconnected" after it leaves. While the sender's own connection is down the chip reads "Reconnecting…".
- A last-sent indicator: "Not sent yet" before the first acknowledged publish, "Sending…" while a publish is unacknowledged, then "Sent at" with the local time of the last acknowledged publish.
- The sender token never appears on the page or in the URL.
- If the tab has no stored key and token for this session (for example the sender URL was opened in another tab), the page shows a "This session can't be resumed here" error with a link back to home, instead of the text input.
- If the server answers the sender join with an unknown session or a bad token, the text input is disabled and a clear error is shown with a link back to home. A taken sender slot shows "This session is already open in another tab".

**Receiver page**
- The key is read from the fragment and imported **before** joining. If it is missing or invalid, the page shows a key error ("This link is incomplete or damaged. Ask the sender for a new link.") and does not join the session, so it never takes the receiver slot and never shows text.
- The reducer's current text is shown as plain displayed text that updates live as the sender types. It is not an input, textarea or any other form field: the receiver cannot type, edit or send anything. A status chip is driven by the reducer's status: "Waiting for the sender" (no text yet), "Live", "Disconnected – reconnecting…", and the integrity state.
- On an integrity rejection a red banner appears ("An update could not be verified and was ignored. Showing the last verified text."). The previously shown text stays exactly as it was. The banner stays until the next accepted update, which clears it.
- Join refusals each get their own message: unknown session shows "This session doesn't exist or has ended", a taken slot shows "Someone else is already viewing this session". Neither shows the text display.
- A decryption failure never breaks the page and never shows partial text.

## Security considerations
- Invariant 6: received and typed text is bound as text only. No HTML binding, no sanitiser bypass, no markdown or link auto-detection.
- Invariant 2 and 7: the page only displays the reducer's text, which changes only on an accepted update. The integrity banner is additive and never replaces or clears the last good text.
- Invariant 1: the key is only read from the fragment and used in the browser. It is never put in a query string, route parameter, log line, error message or snackbar. The copy button copies the receiver link, which is the one intended place for the key.
- Invariant 3: the sender token stays in the tab (task 05 storage) and is never rendered or copied.
- Importing the key before joining keeps a broken link from occupying the single receiver slot (invariant 4).

## Tests
- [x] Unit (component): the receiver page shows the integrity banner and keeps the previous text unchanged when the state moves from live with text to the integrity state.
- [x] Unit (component): a received text containing a script tag and an image tag with an error handler is shown literally as characters; no such elements exist in the rendered page.
- [x] Unit (component): a missing key and a malformed key both show the key error, show no text display, and the join is never called.
- [x] Unit (component): unknown session and slot taken each show their own message.
- [x] Unit (component): the receiver page contains no input, textarea or editable element, and its displayed text changes when the state's text changes, without a reload.
- [x] Unit (component): the sender page shows the receiver link with the key in the fragment, and the copy button writes exactly that link to the clipboard (clipboard stubbed).
- [x] Unit (component): the peer status chip and last-sent indicator follow the service state through waiting, connected, sending and sent.
- [ ] End-to-end: covered by task 07, which finds the elements by the roles and accessible names given here.

## Acceptance criteria
- [x] Clicking "New session" on home lands on the sender page with a receiver link that opens a working receiver page in another browser.
- [x] Text typed by the sender appears on the receiver page without a reload, with line breaks preserved.
- [x] The receiver page has no editable field; the sender page has exactly one, the text input.
- [x] Text like a script tag typed by the sender is shown literally on the receiver page and nothing executes.
- [x] When an update fails verification, the receiver shows the red integrity banner and the previous text stays on screen; the next valid update clears the banner.
- [ ] Opening the receiver link with a missing or altered key shows the key error, no text, and the sender still sees "Waiting for receiver".
- [x] The sender sees the peer chip change to "Receiver connected" and back when the receiver tab closes, and the last-sent time updates after each acknowledged publish.
- [x] Every element the end-to-end task needs can be found by its role and accessible name.

## Out of scope
- Workspace, Angular and Material setup, dev proxy (task 00).
- Key generation, import and encrypt / decrypt (task 01).
- Event names, payload types and validators (task 02).
- Session rules, slots, sequence and expiry on the server (tasks 03 and 04).
- Socket service, debounce and publish pipeline, reconnect resync, receiver reducer and token storage (task 05).
- Playwright two-browser tests (task 07).
- Security headers, CSP and README (task 08).
- Stripping the key from browser history after import; listed as a known limitation.
- Sending the link from inside the app (email, chat integration, share sheet, QR code). The sender copies it and shares it elsewhere.
- Theming and visual polish beyond default Material components; cut first if time runs short.

## Notes / open questions
- Decision: the sender page URL carries no key. A reload resumes from the sender tab's sessionStorage (task 05); the key only ever appears in the receiver link.
- Decision: all user-facing wording above is a first version chosen here; adjust freely as long as each state stays distinct.
- Decision: the receiver imports the key before joining, so an invalid key never consumes the receiver slot.
- Decision: the integrity banner persists until the next accepted update rather than auto-hiding, so a user who looks away still sees that something was rejected.
- Decision: a sender page without a token in the tab is treated as an error, not as a read-only view.
- Decision: stale or duplicate seq on the receiver is shown with the same integrity banner as a failed decryption; the user does not need to tell them apart.

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.

## Implementation notes

**Built**
- Lazy routes in `app.routes.ts`: `''` home, `s/:sessionId` sender, `r/:sessionId` receiver, and `**` back to home. `app.ts` holds a Material toolbar and the router outlet.
- `pages/home.page.ts`: the "New session" button. An `exhaustMap` over clicks creates one session at a time and opens its sender page. The button is disabled while busy, and errors appear in an alert.
- `pages/sender.page.ts`:
  - the read-only receiver link with "Copy link" (clipboard and a snackbar, or the field text selected when the clipboard is missing or refuses);
  - the peer chip and the last-sent indicator;
  - the one text input;
  - errors for a session that can't be resumed and for a refused join.
- `pages/receiver.page.ts`:
  - the key is imported from the fragment before joining;
  - the text is shown as plain text with `white-space: pre-wrap`;
  - a status chip, the integrity banner, and one alert for key and join errors.
- `pages/page-view.ts`: the pure peer phase, labels, last-sent view and error messages, tested directly.
- `CLIPBOARD` token in `session-env.ts`, so the specs stub the clipboard.

**Deviations**
- The task 05 sender service gained:
  - a `sending` signal, needed for "Sending…";
  - a `connection` signal, needed for "Reconnecting…". It starts as `connecting` and stays there until the first connect (pure `nextSenderConnection`), so a new sender page reads "Waiting for receiver", not "Reconnecting…";
  - a 5 s connect timeout on `createSession` that fails with a new `unreachable` error. Without it, home would wait forever when the server is down.
- The task 05 receiver reducer gained an `integrityWarning` flag. A rejected update sets it, and only an accepted update clears it. The banner follows this flag rather than the status, so it stays through a disconnect and rejoin.
- `@angular/router` 21.2.26 added; routes are impossible without it.
- `client/angular.json`: `prebundle.exclude: ["@slm/shared"]` for `ng serve`. Vite prebundling can't resolve the TypeScript-source workspace package. The dev server failed with `Could not resolve "./base64url"` as soon as a served page imported `@slm/shared`. The production build was not affected.
- The criterion "a missing or altered key shows the key error" is only partly met, so it stays unticked:
  - A missing fragment, or one that doesn't decode to 32 bytes, gives the key error without joining. This was checked in the spec and in the browser.
  - An AES-GCM key can't be checked without ciphertext. So a fragment that is altered but still decodes to a valid 32-byte key imports cleanly and joins, which takes the receiver slot. Every update then shows the integrity banner instead of the key error.
  - Detecting that case before joining needs a key-check value in the protocol, which this task can't change.
- The end-to-end test checkbox stays unticked. It belongs to task 07.
- The receiver page does not show whether the sender is connected; the task doesn't ask for it.

**Decisions**
- Accessible names for task 07:
  - Home: button "New session", alert "Session error".
  - Sender: textbox "Your text", read-only textbox "Receiver link", button "Copy link", status "Receiver status", status "Last sent", alerts "Session error" and "Text too long".
  - Receiver: region "Received text", status "Session status", alerts "Integrity warning" and "Session error" (key and join errors).
- The server answers a sender join with `peer: 'disconnected'` when no receiver has joined yet. "Waiting for receiver" and "Receiver disconnected" are therefore told apart from the previous phase: a pure `nextPeerPhase` held in a `linkedSignal`.
- Sender join errors `unknown_session`, `bad_token` and `slot_taken` are fatal: the input is disabled and a link leads home. Publish rejections such as `stale_seq` or `rate_limited` are shown but typing continues.
- A receiver join refused with `invalid_payload` (a malformed id in the path) shows the "doesn't exist or has ended" message.
- The connect timeout for creating a session is 5 s, the same as the ack timeout.
- The altered-but-valid key case is accepted as a known limitation for the README. A key-check value in the protocol would close it. Until then that link joins, and every update shows the integrity banner.

**Verified or corrected**
- The first connect timeout returned an error value that flowed on into the ack parser, where it was overwritten by `protocol_error`. A spec caught this. The timeout now throws a dedicated error that `catchError` maps to `unreachable`.
- The browser run found the dev-server prebundle failure described under Deviations. Unit tests and the production build had both passed.
- The browser run also found that the "Last sent" text carried surrounding whitespace from the `@switch` block. The template was compacted.
- Checked in the browser: with one character of the key fragment changed, the receiver joined, the sender showed "Receiver connected", no key error appeared, and the first update showed the integrity warning with no text (see Deviations).
- An acceptance-criteria review of the PR found two gaps, both fixed with tests:
  - The integrity banner disappeared on a disconnect and rejoin, because it was bound to the status, which the rejoin sets back to live. The criterion asks for it to stay until the next accepted update.
  - On first load, the sender chip read "Reconnecting…" until the socket connected, because the connection signal started as `disconnected`.
- Planted faults, each reverted afterwards:
  - `[innerHTML]` on the receiver text: the sink scan and the literal-markup spec both failed.
  - The copy fallback `select()` removed: both fallback specs failed.

**Test results**
- `npm test`: shared 262, server 113 and client 131, all passing. This includes 39 tests in `pages/` and 4 new sender service tests.
- `npm run typecheck`: passes in all workspaces.
- `npm run build -w @slm/client`: no budget warnings. The initial bundle is 272.47 kB raw, 74.80 kB transferred.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm run e2e`: passes with no tests (task 07 adds them).
- Headless Chromium walkthrough with two or more contexts: all 12 steps passed, 12 screenshots in `docs/guides/screenshots/06/`. See `docs/guides/06-test-guide.md`.
