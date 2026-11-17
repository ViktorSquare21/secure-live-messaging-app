# [Feature] Two-browser end-to-end tests for live updates and a corrupted key link

**Role:** Operator
**Surface:** Tests
**Estimate:** 20 min
**Depends on:** 04, 06

## Goal
Prove in real browsers that the receiver sees the sender's text live and never shows plaintext when the key in the link is corrupted.

## User story
As a developer, I want one command that drives a sender and a receiver browser through the real app, so that a change anywhere in the client, server or crypto that breaks live sharing or leaks plaintext is caught before it ships.

## Context
Decision D7 calls for Playwright with two browser contexts and real WebCrypto. The unit and integration tests in tasks 01–05 cover each layer alone; only this task checks the whole flow through the Angular UI, the dev proxy and the Socket.IO relay together. The plan marks this task as one that must never be cut.

## Current behaviour
Doesn't exist. The root `e2e` script from task 00 has no tests behind it.

## Desired behaviour
- `npm run e2e` starts the relay server and the Angular client, runs the end-to-end suite in Chromium, and shuts both down afterwards.
- Each test uses two separate browser contexts, one for the sender and one for the receiver, so they share no storage and the sender token from the sender tab is not available to the receiver.
- **Live flow:** the sender opens the home page, starts a new session, and reads the receiver link from the link shown on the sender page (not rebuilt by the test). The receiver opens that link; the test handing the link from one browser context to the other stands in for the sender sharing it on another platform. The sender types a first text into the text input; the receiver shows it. The sender then changes the text to a second, different value; the receiver shows the second text in place of the first, with no reload of the receiver page. The receiver's status reads live and no integrity warning is shown. The receiver page offers no editable field.
- **Corrupted key:** the sender creates a session and publishes a known text. A receiver then opens the same link with the key part after `#` corrupted, in two variants:
  - malformed key (for example, truncated so it can't be imported): the receiver shows the missing-or-invalid-key error;
  - well-formed key of the right length but with different bytes: the receiver joins, receives the latest envelope, fails to decrypt it, and shows the integrity warning.
  In both variants the sender's text appears nowhere on the receiver page, and the page stays usable (no blank screen, no uncaught error in the console).
- Waiting for the debounced sender input (about 300 ms) relies on Playwright's auto-retrying assertions on the receiver's text, never on fixed sleeps.
- Locators use roles and accessible names from the task 06 UI. No test-only attributes.

## Security considerations
- Invariant 1 (key and plaintext never reach the server): during the live flow, the test records every HTTP request URL and every outgoing WebSocket frame from both browser contexts, and asserts that neither the key from the link nor either plaintext appears in any of them.
- Invariant 2 and 7 (show text only when decryption succeeds; failures never crash the UI or show partial plaintext): covered by the two corrupted-key variants.
- Invariant 6 (plain text only) is not separately tested here; the plaintext assertions use text content, so they hold whether or not markup is present.

## Tests
- [ ] End-to-end: sender creates a session, receiver opens the link, and two consecutive updates appear on the receiver in order without a reload. The receiver page has no editable field.
- [ ] End-to-end: no HTTP request URL or outgoing WebSocket frame from either browser contains the key or either plaintext during the live flow.
- [ ] End-to-end: a truncated key in the link shows the invalid-key error and none of the sender's text.
- [ ] End-to-end: a well-formed but wrong key shows the integrity warning and none of the sender's text.

## Acceptance criteria
- [ ] `npm run e2e` starts server and client on its own and passes from a clean checkout after `npm ci` and installing the Playwright Chromium browser.
- [ ] The receiver shows the first text and then the second text typed by the sender, without a reload, and the second replaces the first.
- [ ] Opening the receiver link with a truncated key shows the invalid-key error, and the sender's text is not present anywhere on the receiver page.
- [ ] Opening the receiver link with a wrong but well-formed key shows the integrity warning, and the sender's text is not present anywhere on the receiver page.
- [ ] Neither the key nor the plaintext appears in any request URL or outgoing WebSocket frame captured during the live flow.
- [ ] The suite contains no fixed-duration waits and passes three runs in a row.

## Out of scope
- Workspace scaffold, root `e2e` script and dev proxy (task 00).
- Crypto envelope behaviour and its unit tests (task 01).
- Payload validation (task 02) and server session rules (task 03).
- Server-level integration tests: late receiver, forged publish, tampered relay, sender reconnect (task 04).
- Receiver reducer, debounce and reconnect unit tests (task 05).
- Building or changing the UI (task 06).
- Security headers, CSP and README (task 08).
- Firefox and WebKit runs, and a CI pipeline.
- End-to-end checks for a second receiver being refused, sender reconnect, or tampered ciphertext in transit.

## Notes / open questions
- Decision: Playwright's built-in web server support starts the relay server and the Angular dev server (with the task 00 proxy for Socket.IO); a running instance is reused locally but not in CI mode.
- Decision: Chromium only, to fit the estimate; other browsers can be added later.
- Decision: the debounce is handled by auto-retrying assertions with the default timeout, not by fake timers or sleeps.
- Decision: the "corrupted key" requirement is covered by two variants (malformed and wrong-but-valid), because they reach two different receiver error states.
- Decision: the key-and-plaintext leak check is included because it is cheap and is the only browser-level check of invariant 1.
- Decision: the test reads the link from the sender page, which also checks that the displayed link is correct.
- If an element the tests need has no accessible name in the task 06 UI, add one in task 06 rather than test-only attributes here.

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.
