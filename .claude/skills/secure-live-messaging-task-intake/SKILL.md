---
name: secure-live-messaging-task-intake
description: Use when someone describes a bug, missing feature, or change for Secure Live Messaging (the end-to-end encrypted live text sharing app). Runs a short structured intake (type, role, surface, goal, security impact, tests) and writes a dev-ready task file to docs/tasks/ in the standard template, then updates the task index. Invoke on "we need to add...", "X is broken...", "can we change...", "file a task for...", or "turn the plan into tasks".
---

# Secure Live Messaging Task Intake

You help file a task for Secure Live Messaging. Ask the right questions, then write a clean task file to `docs/tasks/` that a developer can pick up without further context.

## Product context

**Before the intake starts**, read:

- `project-context.md` (next to this skill): what the app is, its parts, vocabulary, and the security invariants every task must keep.
- `docs/architecture-decisions.md`: the decisions already made. This file is the source of truth; if it disagrees with `project-context.md`, it wins.
- `docs/implementation-plan.md`: the flow, the Socket.IO protocol and the planned task breakdown.
- `docs/tasks/README.md`, if it exists: the tasks already filed, so you don't file a duplicate.

If a request touches existing behaviour, check the code before asking. The message format and crypto live in `shared/`, session rules and the Socket.IO handlers in `server/`, and the Angular app in `client/`. Read only what you need, so you can ask sharper questions and avoid asking for something that already exists.

Unlike a stakeholder intake, the reader here is a developer, so technical terms are allowed (AES-GCM, sequence number, Socket.IO event). Still describe **behaviour and rules**, never code: no signatures, no file listings, no code blocks in the task body.

## How to run the intake

Ask one question at a time. After each answer, skip any later question the person has already answered.

**Order:**

1. **Type.** "Is this a bug, a missing feature, or a change to existing behaviour?"
2. **Role.** "Who is this for: the sender, the receiver, both, or the operator / developer (build, tests, docs)?"
3. **Surface(s).** "Where does it live: client, server, shared, tests, docs? Several are allowed."
4. **Goal.** "What outcome are you trying to enable?" Push for the outcome, not the implementation.
5. **Branch by type:**
   - **Bug:** steps to reproduce, expected, actual, frequency, browser / environment.
   - **Feature:** why now, and the smallest version that would still be useful.
   - **Change:** how it works today, how it should work, what is wrong with today.
6. **Security impact.** Always ask: "Does this touch the key, plaintext, ciphertext, the sender token, or what the server can see?" If yes, list which invariant from `project-context.md` is at stake and how the task keeps it.
7. **Tests.** Always ask: "Which cases must be covered by automated tests?" Propose the cases yourself (happy path, tampering, replay or ordering, async timing, failure states), then confirm. Name the level of each: unit (pure), integration (real server), or end-to-end (two browsers).
8. **Acceptance criteria.** Propose 3–7 observable items, then confirm: "Here is what done looks like. Does this match?"
9. **Out of scope.** Always ask: "Is there anything you specifically don't want included?"
10. **Estimate and dependencies.** "Roughly how long, and which tasks must be done first?" The first version is scoped to about 4 hours of work, so flag anything over 45 minutes as a candidate for a split.

## When to push back

- **Two tasks in one:** say so and offer to split.
- **Unclear goal:** don't invent one. Ask again, or write `TBD` under "Notes / open questions".
- **Weakens a security invariant** (for example, sending the key to the server, rendering text as HTML, or accepting messages without decrypting them first): stop, name the invariant, and ask whether this is really intended. If it is, record it as an explicit decision in the task.
- **No tests proposed for security-sensitive or async behaviour:** don't file without at least one test case for it.

## Seeding tasks from a plan

When asked to turn an existing plan into tasks (for example the task breakdown in `docs/implementation-plan.md`), take the answers from the plan instead of asking. Ask only about gaps or contradictions, and confirm the whole list once before writing the files.

## Before writing the file

Summarise the task in 2–3 sentences and ask "Did I get this right?"

## Output

Once confirmed:

1. Write the task in **English** to `docs/tasks/NN-short-slug.md`. `NN` is the next free two-digit number in `docs/tasks/` (start at `00`). The slug is lowercase-kebab, at most 5 words.
2. Add or update its row in `docs/tasks/README.md`, a table with the columns `#`, `Title`, `Type`, `Surface`, `Estimate`, `Depends on` and `Status`. New tasks start as `Todo`.
3. Reply with the file path and the title.

Use this template, **omitting any section that doesn't apply**:

```markdown
# [Bug | Feature | Change] One-line title

**Role:** Sender | Receiver | Operator (pick one or more)
**Surface:** Client | Server | Shared | Tests | Docs (pick one or more)
**Estimate:** {minutes}
**Depends on:** {task numbers, or omit}

## Goal
One sentence. The outcome we are enabling.

## User story
As a {role}, I want {capability}, so that {benefit}.

## Context
Why this matters, and which decision or requirement it comes from. 1–3 sentences.

## Current behaviour
What happens today. (For new features: "doesn't exist".)

## Desired behaviour
What should happen, including the rules and values that matter (limits, timeouts, error states).

## Repro steps  *(bugs only)*
1. ...
2. ...

**Expected:** ...
**Actual:** ...
**Frequency:** every time / sometimes / one-off
**Environment:** {browser / OS / node version}

## Security considerations
- Which invariant this touches and how it is kept.

## Tests
- [ ] Unit: ...
- [ ] Integration: ...
- [ ] End-to-end: ...

## Acceptance criteria
- [ ] ...
- [ ] ...
- [ ] ...

## Out of scope
- ...

## Notes / open questions
- ...

---

## PR expectations
- **Summary:** explain *why*, not just *what*.
- **Changed files:** the key files touched, one line each on why.
- **Test results:** `npm test` output, plus `npm run e2e` for client or flow changes.
```

## Style rules for the output

- **Plain, tool-agnostic markdown.** Headings, lists and checkboxes only.
- **No code** in the task body: no signatures, snippets or file trees. Name concepts, not identifiers.
- **Every acceptance criterion and test must be observable.** "Receiver shows the integrity warning and keeps the previous text when one ciphertext byte is flipped" beats "tampering is handled".
- **Skip empty sections.** Never write "None" or "N/A".
- **Specific titles.** "Receiver rejects replayed messages with an old sequence number" beats "Replay fix".
- **Keep tasks about the product.** Describe what to build and why for its users; never write about where the project came from or who it is for beyond its users.

## Style rules for the conversation

- Match the person's language during the intake. The task file is always in English.
- Be conversational: "Got it, and does the receiver need to see that?" beats "Question 6 of 10".
- If an answer is vague, ask one specific follow-up instead of repeating the question.
