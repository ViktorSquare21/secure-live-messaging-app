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
The UI is the last layer over the client services and pure receiver state from task 05. Angular Material is a fixed requirement (D3). Plain-text rendering (D7 and invariant 6) and "keep the last good text on failure" (invariant 2) must be visible here, because this is where users see the results.

## Current behaviour
Doesn't exist. Task 05 provides the socket service, the sender publish pipeline and the pure receiver reducer, but no pages.

## Desired behaviour

**General**
- Three routes: home at the root, the sender page under the session path (no key in its URL; key, token and seq come from tab storage via task 05), and the receiver page under the receiver path with the key in the fragment. Unknown routes go to home.
- Pages are thin. They wire user input into the task 05 services and display the state those services and the receiver reducer produce. No session rules, sequence checks or crypto decisions in the components.
- All text the user typed or received is shown through normal Angular text binding, never as HTML. Line breaks and spacing are preserved by styling (pre-wrapped text), not by converting to markup.
- Every element the end-to-end task needs (new-session button, sender textarea, receiver link, copy button, peer status, last-sent indicator, receiver text, receiver status, integrity banner, key error) gets a stable, dedicated test hook that doesn't depend on wording or Material's internal markup.

**Home**
- One "New session" button. Clicking it generates the key, creates the session through the task 05 service and navigates to the sender page.
- The button is disabled while the request is in flight. If creating fails or the server is unreachable, a short error is shown and the button is enabled again.

**Sender page**
- One multi-line text input (a large textarea) for the text. It is the only editable field in the app. Typing feeds the debounced publish pipeline from task 05; the page does nothing else with the text.
- The receiver link (full origin, receiver path, session id and key fragment) in a read-only field with a copy button. Copying uses the clipboard and confirms with a short snackbar ("Link copied"). If the clipboard is unavailable, the field text is selected instead so it can be copied by hand.
- The sender passes the link to the receiver on another platform (chat, email). A short hint next to the link says so ("Send this link to your receiver"). The app itself never sends the link anywhere.
- A peer status chip: "Waiting for receiver" until a receiver joins, "Receiver connected" while one is present, "Receiver disconnected" after it leaves. While the sender's own connection is down the chip reads "Reconnecting…".
- A last-sent indicator: "Not sent yet" before the first acknowledged publish, "Sending…" while a publish is unacknowledged, then "Sent at" with the local time of the last acknowledged publish.
- The sender token never appears on the page or in the URL.
- If the page is opened without a sender token for this session in the tab (for example the sender link pasted into another tab), or the server answers with an unknown session or a bad token, the textarea is disabled and a clear error is shown with a link back to home. A taken sender slot shows "This session is already open in another tab".
- If the tab has no stored key and token for this session (for example the sender URL was opened in another tab), the page shows a "This session can't be resumed here" error instead of the editor.

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
- [ ] Unit (component): the receiver page shows the integrity banner and keeps the previous text unchanged when the state moves from live with text to the integrity state.
- [ ] Unit (component): a received text containing a script tag and an image tag with an error handler is shown literally as characters; no such elements exist in the rendered page.
- [ ] Unit (component): a missing key and a malformed key both show the key error, show no text display, and the join is never called.
- [ ] Unit (component): unknown session and slot taken each show their own message.
- [ ] Unit (component): the receiver page contains no input, textarea or editable element, and its displayed text changes when the state's text changes, without a reload.
- [ ] Unit (component): the sender page shows the receiver link with the key in the fragment, and the copy button writes exactly that link to the clipboard (clipboard stubbed).
- [ ] Unit (component): the peer status chip and last-sent indicator follow the service state through waiting, connected, sending and sent.
- [ ] End-to-end: covered by task 07 using the test hooks added here.

## Acceptance criteria
- [ ] Clicking "New session" on home lands on the sender page with a receiver link that opens a working receiver page in another browser.
- [ ] Text typed by the sender appears on the receiver page without a reload, with line breaks preserved.
- [ ] The receiver page has no editable field; the sender page has exactly one, the text input.
- [ ] Text like a script tag typed by the sender is shown literally on the receiver page and nothing executes.
- [ ] When an update fails verification, the receiver shows the red integrity banner and the previous text stays on screen; the next valid update clears the banner.
- [ ] Opening the receiver link with a missing or altered key shows the key error, no text, and the sender still sees "Waiting for receiver".
- [ ] The sender sees the peer chip change to "Receiver connected" and back when the receiver tab closes, and the last-sent time updates after each acknowledged publish.
- [ ] Every element listed under test hooks can be found by a stable test hook.

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
