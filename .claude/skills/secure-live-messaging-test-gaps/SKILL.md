---
name: secure-live-messaging-test-gaps
description: Use before a commit to find pure functions in the current Secure Live Messaging diff that lack minimum unit-test coverage, including the negative test every security rule needs, and to propose the missing Vitest tests in chat for review. Writes tests only after approval. Invoke on "check test gaps", "what's untested in this diff", "do my pure functions have tests", or /secure-live-messaging-test-gaps [base|staged].
argument-hint: <optional scope: base (default branch...HEAD) or staged>
---

# Secure Live Messaging Test Gaps

Find the pure functions added or changed in the current diff that don't meet minimum coverage, and propose the missing tests for the developer to review. **Never write a test before the developer approves it. Proposals go in chat first.**

## When to use

- Before staging a commit, to see which new or changed pure functions still lack coverage.
- After a refactor, to check whether the existing tests still cover the new branch structure.
- As a check inside `secure-live-messaging-task-implementation` before Step 10, when the developer asks for one.

The developer stays in the loop on purpose: reading the proposals is how the minimum-coverage rule becomes second nature.

## Load these first

1. `CLAUDE.md` at the repo root: the testing rules and every security rule. Each security rule needs at least one negative test, and that requirement is part of minimum coverage here.
2. `.claude/skills/secure-live-messaging-task-intake/project-context.md`: the seven security invariants that tasks cite by number.
3. The task file in `docs/tasks/` for the current branch (`feat-<NN>` maps to `docs/tasks/<NN>-*.md`), if there is one. Its "Tests" section lists cases the task expects.
4. One existing `*.test.ts` file in the same workspace as the code under review, as the style reference. Prefer a test of a pure core: the crypto envelope or validators in `shared/`, the session core in `server/`, the receiver state reducer in `client/`. If the workspace has no tests yet, use the style in Step 4.

## Workflow

Follow these steps in order.

### Step 1. Get the diff

- `base` (the default): `git diff <default branch>...HEAD`, where the default branch comes from `gh repo view --json defaultBranchRef` or, offline, `git symbolic-ref refs/remotes/origin/HEAD`.
- `staged`: `git diff --staged`, then `git diff` for unstaged changes.

If the scope is ambiguous (for example, on the default branch with both committed and uncommitted work), ask which one with `AskUserQuestion`. Consider only `.ts` files under `shared/`, `server/` and `client/`, excluding `*.test.ts`, `*.spec.ts` and generated files.

### Step 2. Find candidate functions

List every function that was **added or modified**: exported functions, plus non-exported ones called elsewhere in their own file. Include arrow functions assigned to `const`, pure methods of a reducer, and the function passed to an Angular `computed()` when it is extracted and named. Ignore deletions.

Classify each one as **pure** or **impure**. A function is pure only when all of these hold:

- No reads from outside its arguments: no `Date.now()`, `new Date()` without arguments, `performance.now()`, `Math.random()`, `process.env`, module-level mutable state, or mutable `this` fields.
- No randomness: no `crypto.getRandomValues`, `crypto.randomBytes`, `crypto.randomUUID`. A function that creates an IV, a key, a session id or a token is impure; one that takes them as arguments may be pure.
- No side effects: no sockets (`emit`, `on`, `io.to`), no timers, no logger or `console.*`, no `sessionStorage`, `location`, DOM or clipboard access, no signal writes, no HTTP, no fs, no mutation of its arguments.
- Every function it calls is also pure.

Project-specific calls:

- **Deterministic platform crypto counts as pure for this skill**: `crypto.subtle.importKey`, `encrypt` with an IV passed in, `decrypt`, `createHash`, `timingSafeEqual`. These are tested directly with real WebCrypto, never mocked. The functions are async, so the tests `await` them.
- Angular components, services with injected dependencies, and anything holding a socket are impure. Their logic should already sit in a pure function next to them; if it doesn't, note it as a refactor candidate and skip it.
- Validators, base64url codecs, the AAD builder, the session core commands, the receiver state reducer, and mappers or formatters are usually pure.

**Skip impure functions.** If everything in the diff is impure, say so and stop. Name the logic that could move into a pure function, and point out that impure shells are covered by integration tests (real server on port 0) or Playwright, not by this skill.

### Step 3. Check existing coverage

For each pure function:

1. Find its tests: first the co-located `foo.test.ts`, then any `*.test.ts` in the same workspace that imports it.
2. Find the `describe('<functionName>', …)` block, or the tests that call the function.
3. Check them against the minimum-coverage rule:
   - **Branch:** one test per branch the function takes (each `if`, `switch` case, ternary, early return, result variant such as `ok | integrity_error | malformed`, and each error code it can return, such as `stale_seq` or `not_sender`).
   - **Boundary:** one test per boundary the function explicitly handles (empty string, seq equal to the last accepted seq, a payload at the 64 KB cap and one byte over, a TTL exactly at the cutoff). Only boundaries with special handling in the body.
   - **Failure:** one test per documented failure mode (each `throw`, each failure result, each rejection).
   - **Security negative:** for every rule in `CLAUDE.md` the function enforces, one test that tries to break it and is refused. Examples: a flipped ciphertext bit gives `integrity_error`, a changed session id or seq in the AAD fails decryption, a replayed or lower seq is rejected, a receiver socket cannot publish, a second receiver is refused, an unknown field is rejected, padded or non-round-tripping base64url is rejected, and a rejected update leaves the last good text untouched.
   - **Mutation check:** if the body were replaced with `return undefined as never`, at least one existing test would fail.

A function meets minimum coverage when all five hold. Otherwise it has a gap.

### Step 4. Propose tests for the gaps

Draft the missing tests **in chat, not in a file**. Match the reference test from "Load these first"; without one, use:

- `import { describe, expect, test } from 'vitest'`
- one `describe` block per function, one `test('describes the behaviour in a sentence', …)` per case
- real types from the `shared` workspace, never `any`; network-shaped inputs built as `unknown` where the function takes `unknown`
- no mocks, no sockets, no fixed sleeps; time and randomness passed in as values, as the function under test expects
- fixed test keys and IVs built in the test (never a key from a real session); real WebCrypto for crypto cases
- no comments except a non-obvious why

Annotate each proposed test with **the slot it fills**: "branch: unknown session", "boundary: seq equal to last accepted", "failure: malformed envelope", "security: flipped ciphertext bit is rejected (invariant 2)". Cite the invariant number from `project-context.md` where one applies.

### Step 5. Wait for approval, then write

1. Ask which tests to keep, edit or drop, with `AskUserQuestion` (options such as "Write all", "Write only the security tests", "Let me edit first").
2. Only after explicit approval, add the tests to the right `*.test.ts` file, creating it next to the source file if none exists.
3. Run them with `npm test -w <workspace> -- <path to test file>`, then `npm run typecheck`.
4. If a test fails on its first run, **stop and report** the failure and what it suggests. Don't change the test or the code to make it pass without the developer's decision: the function may be wrong, or the assertion may be.

## Output format

```
## Diff summary
<scope used, files touched, number of pure vs impure functions>

## Functions analysed
### <functionName> · <pure | impure, skipped: reason>
- Location: <path:line>
- Branches: <count and short list>
- Security rules enforced: <list with invariant numbers, or "none">
- Existing tests: <"none" | "<N> tests in <path>">
- Coverage: <"meets minimum" | "missing: <slots>">

## Proposed tests
<code blocks grouped by function, each test annotated with its slot>

## Next step
<the approval question>
```

## Hard rules

- **Never write to a test file before the developer approves.** This is the point of the skill.
- **Never test impure functions with this skill.** Skip them and say so.
- **Never lower the bar to make a test pass.** Report a failing proposal and let the developer decide.
- **Never invent edge cases the function doesn't handle.** If the body doesn't special-case an empty string, don't assert behaviour for one.
- **Never mock WebCrypto or the validators.** Pure cores are tested with real inputs.
- **Never put a real session's key, token or session id in a test.** Test values are made up in the test.

## Related

- `CLAUDE.md`: testing and security rules
- `.claude/skills/secure-live-messaging-task-implementation/SKILL.md`: the full task workflow this check fits into
- `.claude/skills/secure-live-messaging-task-intake/project-context.md`: the numbered security invariants
