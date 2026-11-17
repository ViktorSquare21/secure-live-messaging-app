---
name: secure-live-messaging-task-implementation
description: Use to implement one Secure Live Messaging task from docs/tasks/ end to end. Reads the task file, creates the branch feat-<tasknumber>, plans in plan mode, implements, writes unit tests, runs a headless Playwright check with screenshots where the task has something to see, writes docs/guides/<tasknumber>-test-guide.md, records what happened, then commits, pushes and opens a PR with gh. Invoke on "implement task 03", "work on 05", "do the next task", or /secure-live-messaging-task-implementation <tasknumber>.
argument-hint: <tasknumber, for example 03>
model: claude-opus-5-5
effort: medium
---

# Secure Live Messaging Task Implementation

You implement exactly one task from `docs/tasks/`, from reading it to an open pull request. The task file is the contract: build what it says, nothing more.

The task number is the two-digit prefix of the task file (`03` for `docs/tasks/03-server-session-core.md`). With no number given, take the first task in `docs/tasks/README.md` whose status is `Todo` and whose dependencies are all `Done`, and say which one you picked.

## Rules that hold in every step

- `CLAUDE.md` at the repo root is binding: the security rules, performance rules, Angular and RxJS conventions and testing rules. If the task and `CLAUDE.md` disagree, stop and report the conflict instead of choosing.
- Stay inside the task's "Desired behaviour" and "Acceptance criteria". Anything under "Out of scope" stays out, even if it looks easy.
- Logic goes into pure functions; I/O, time and randomness stay in a thin shell and are passed in as values.
- No code comments, except a non-obvious why.
- Code, docs, commit messages and the PR describe the product only. Never write where the project came from, and never name a person.
- Never stage or commit `project.md`, `.env` files, or anything under `node_modules/`, `dist/`, `test-results/` or `playwright-report/`.
- Never put a key, token or session id of a real session into a log, a doc or a screenshot. Screenshots come only from throwaway sessions on localhost.

## Step 1. Preflight

Run these checks before touching anything. If one fails, stop and report it; don't repair it silently.

1. The folder is a git repository with a clean working tree, and `origin` points at a GitHub repository.
2. `gh auth status` succeeds.
3. The task file `docs/tasks/<NN>-*.md` exists, with exactly one match.
4. Every task listed in its **Depends on** line is `Done` in `docs/tasks/README.md` on the base branch, which means its pull request has been merged.
5. The branch `feat-<NN>` doesn't exist yet, locally or on `origin`. If it does, ask whether to continue on it or stop.
6. Node matches `.nvmrc` (Node 24), once task 00 has created it.

The base branch is the repository's default branch (`gh repo view --json defaultBranchRef`).

## Step 2. Read

Read, in this order:

1. The task file, completely.
2. `.claude/skills/secure-live-messaging-task-intake/project-context.md`: the vocabulary and the seven security invariants that the tasks cite by number.
3. `docs/architecture-decisions.md` for every decision the task cites.
4. The parts of `docs/implementation-plan.md` that cover the task (flow, protocol, crypto).
5. The task files of its dependencies: their "Desired behaviour" and "Notes" sections name what this task builds on.
6. The existing code in the workspaces the task's **Surface** line names.

When sources disagree on a detail, `CLAUDE.md` and the decisions file come first, then the task file, then the plan. The plan is an outline; the task files are more exact. A real conflict between `CLAUDE.md` and the task is a stop, as above.

## Step 3. Branch

Update the base branch (`git fetch origin`, fast-forward only), then create and switch to `feat-<NN>` from it.

## Step 4. Plan (plan mode)

Enter plan mode (`EnterPlanMode`). Explore read-only, then present a plan through `ExitPlanMode` and wait for approval. The plan contains:

- **Changes:** each file to create or change, with one line on what goes in it. Mark which parts are pure core and which are shell.
- **Acceptance criteria map:** every acceptance criterion of the task, each with the code that satisfies it and the test that proves it. A criterion without a test is a gap in the plan.
- **Security:** each invariant from the task's "Security considerations", and the negative test that covers it.
- **Tests:** the unit and integration tests to write, and whether an end-to-end check applies (see Step 7).
- **Open points:** anything the task leaves undecided, each with the choice you intend to make.

Don't write code before the plan is approved. If the approved plan turns out wrong during implementation, say so and adjust; don't quietly build something else.

## Step 5. Implement

- Work in small steps and keep the type check passing.
- Add a dependency only if the task names it or the work is impossible without it. Pin exact versions for `socket.io` and `socket.io-client`.
- Keep the change minimal: no refactoring of code the task doesn't touch.

## Step 6. Unit and integration tests

- Write the tests from the task's "Tests" section, plus one negative test for every security rule the task touches.
- Pure cores are tested directly: no mocks, no sockets. Integration tests start the real server on port 0 and close every client and the server afterwards.
- Never wait with a fixed sleep. Use fake timers for debounce and backoff, and await events with a timeout.
- Run `npm test` and `npm run typecheck`, plus the lint script if the repo has one. Everything must pass before you go on. A failing test is fixed in the code, or in the test if the test is wrong; it's never skipped or deleted to get green.

## Step 7. End-to-end check with screenshots

This step applies when the task changes something visible in a browser: a page, a route, or what the server sends to a browser (headers, the served build). It doesn't apply to tasks that only touch `shared/` or the server's pure core. If it doesn't apply, say so in the guide and skip to Step 8.

When it applies:

1. If the task itself adds Playwright tests, run them with `npm run e2e`.
2. Drive the app with Playwright in headless Chromium (the root dev dependency from task 00), with two browser contexts when both roles are involved: one sender, one receiver. Start the stack on local ports and stop it afterwards.
3. Walk through the task's acceptance criteria as a user would, including at least one failure case when the task has one (a corrupted key, a rejected update, a refused second receiver).
4. Take a screenshot at each step that shows a result. Save them as `docs/guides/screenshots/<NN>/<step>-<short-name>.png`, numbered in the order of the guide (`01-new-session.png`). Use a fixed viewport of 1280×800 and wait for the asserted state before each shot, never a fixed delay.
5. Keep the script that took the screenshots out of the repo, in the scratchpad, unless the task asks for an end-to-end test file.
6. Look at every screenshot before using it. A screenshot that doesn't show what its step claims is retaken or dropped.

If the browser check finds a defect, fix it, rerun Step 6, and retake the affected screenshots.

## Step 8. Test guide

Write `docs/guides/<NN>-test-guide.md`. It lets a person who hasn't seen the code verify the task by hand. Every step in it has been carried out by you first; write down what happened, not what should happen.

```markdown
# Test guide: <NN> <task title>

## What this covers
One or two sentences, and the acceptance criteria it verifies.

## Before you start
Node version, `npm ci`, and the command that starts the app.

## Automated tests
The commands to run and the result you got (number of tests, all passing).

## Manual steps
1. What to do.
   **Expected:** what you see.
   ![short description](screenshots/<NN>/01-name.png)

## Failure cases
The same format, for the cases that must be rejected.

## Not covered
What this guide doesn't verify, and why.
```

For a task with no browser check, "Manual steps" holds the commands to run and their real output, and there are no screenshots.

## Step 9. Record what happened

1. Append a section `## Implementation notes` to the task file, with these parts:
   - **Built:** what now exists, in three to six bullets.
   - **Deviations:** every place the result differs from the task or the approved plan, with the reason. Write "None" if there are none.
   - **Decisions:** the open points you settled and how.
   - **Verified or corrected:** anything you first got wrong, or a claim you checked and found false, and how it was caught. This feeds the README's AI usage section; write "Nothing notable" rather than inventing something.
   - **Test results:** the commands run and their outcome.
2. Tick the acceptance criteria in the task file that are met. Leave an unmet one unticked and explain it under "Deviations".
3. Set the task's status to `Done` in `docs/tasks/README.md`.

## Step 10. Commit, push and open the PR

1. Before staging, run the checks one last time: `npm test`, `npm run typecheck`, the lint script if there is one, and `npm run e2e` if Step 7 applied. Then read the full diff and confirm it contains only this task.
2. Stage files by name, never `git add -A`. Commit with a message in this form:
   ```
   feat(<surface>): <what the product can now do>

   <two or three lines on what changed and why>

   Task: docs/tasks/<NN>-<slug>.md
   ```
   End the message with the attribution line the session gives you.
3. Push with `git push -u origin feat-<NN>`.
4. Create the PR with `gh pr create` against the base branch. Write the body to a file in the scratchpad and pass it with `--body-file`. The body has:
   - **Summary:** what the task adds and why, in two to four bullets.
   - **Task:** a link to the task file.
   - **Changed files:** the key files touched, one line each on why.
   - **Acceptance criteria:** the task's list, ticked as met.
   - **Tests:** the commands run and their results.
   - **Screenshots:** each screenshot from Step 7 with a one-line caption. `gh` can't upload images, so reference the committed files by the pushed commit's SHA: `https://github.com/<owner>/<repo>/blob/<sha>/docs/guides/screenshots/<NN>/<file>.png?raw=true`. Leave the section out when there are none.
   - **Test guide:** a link to `docs/guides/<NN>-test-guide.md`.
   - **Deviations:** copied from the implementation notes.
5. Don't merge. Report the PR URL.

## Stop and report instead of pushing on

- A preflight check fails.
- The task conflicts with `CLAUDE.md` or `docs/architecture-decisions.md`.
- Meeting an acceptance criterion would break a security invariant.
- The work needs a change in a workspace the task's **Surface** line doesn't name.
- Tests can't be made to pass without weakening them.

## Final report

End with a short report: the PR URL, the branch, what was built, test results, the number of screenshots, any deviations, and anything that needs a decision.
