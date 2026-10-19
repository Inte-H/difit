---
name: difit
description: Ask the user for a code review by opening the changes in difit, a local diff viewer. Explicit opt-in only — use when the user names difit, asks to open or show the diff in the viewer, or has a standing instruction to request reviews through difit after changes. Do not use it for ordinary requests to review code, diffs, commits, branches, or pull requests.
---

# Difit

## When to Use This Skill

difit opens an external browser UI and starts a long-running local server, so launching it must be explicit opt-in:

- Use this skill only when the user explicitly names difit, asks to open or show the diff in a viewer, or has a standing instruction (for example in project docs or agent configuration) to request reviews through difit after code changes.
- Do NOT use it for ordinary review requests such as "review these changes", "use the reviewer agent", "find problems in this diff", or "review this PR/commit/branch". Answer those through your normal response channel.
- When a request is ambiguous, prefer the non-difit path.

## Overview

This skill requests a code review from the user using difit.
Before running commands, choose `<difit-command>` using the following rule:

- If `command -v difit` succeeds, use `difit`.
- Otherwise, use `npx difit`.
- If falling back to `npx difit` would require network access in a sandboxed environment without network permission, request escalated permissions and user approval before running it.
- The fixup review flow below exists only in the Inte-H/difit fork. `npx difit` downloads the upstream package, so that flow needs the fork installed as `difit` on PATH.

If the user leaves review comments, they are printed to stdout when the chosen difit command exits.
When review comments are returned, continue work and address them.
If the server is shut down without comments, treat it as "no review comments were provided." Restarting it is unnecessary.
Manual verification of whether the page launched correctly is also unnecessary.

## Commands

- Review uncommitted changes before commit: `<difit-command> .`
- Review the HEAD commit: `<difit-command>`
- Review staging area changes: `<difit-command> staged`
- Review unstaged changes only: `<difit-command> working`

Basic Usage:

```bash
<difit-command> <target>                    # View single commit diff. ex: difit 6f4a9b7
<difit-command> <target> [compare-with]     # Compare two commits/branches. ex: difit feature main
```

## Optional Startup Comments

If there is something you want to tell the user when difit opens, attach it as startup comments with `--comment`.
This is useful for review findings, explanations, and any context the user should see directly on the diff.

```bash
<difit-command> <target> [compare-with] \
  --comment '{"type":"thread","filePath":"src/foobar.ts","position":{"side":"old","line":102},"body":"line 1\nline 2"}' \
  --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":{"start":36,"end":39}},"body":"Range comment for L36-L39"}'
```

- Use `type: "thread"` for each comment.
- Write comment bodies in the language the user is using.
- Use `position.side: "new"` for lines that exist on the target side of the diff.
- Use `position.side: "old"` for lines that exist only on the deleted side.
- Use range comments for issues that span multiple lines.
- Never copy secrets, tokens, passwords, API keys, private keys, or other credential-like material from the diff into `--comment` bodies or any command-line arguments.

## Including Untracked Files

For uncommitted changes, if files not yet added to git should also appear in the diff, add `--include-untracked`.

```bash
<difit-command> . --include-untracked
```

## Reusing a Running Server

Keep at most one live difit server per Git root and review target. When you edit again after starting a review, reuse the running server instead of launching another one — repeated launches create duplicate ports and browser tabs.

- Before starting difit, check whether a difit server you started earlier is still running for the same Git root (for example, the background process you launched is still alive).
- If one is running for the same target, do not start another and do not reopen its URL. For working-tree targets (`.`, `working`, `staged`, and the HEAD default) difit watches the repository, and the open page prompts the user to reload when the diff changes.
- If review rounds are expected to repeat, start the server with `--keep-alive` (the server survives browser disconnects) or `--background` (a detached keep-alive server; prints JSON like `{"port":4966,"url":"http://localhost:4966","pid":123}` and does not auto-open a browser, so share the URL with the user once).
- While the server stays alive, exchange feedback without restarting it:
  - `<difit-command> comment get --port <port>` — read the user's review comments (`--format json` for structured output).
  - `<difit-command> comment add --port <port> '<json>'` — add new comments to the running server (same JSON shape as `--comment`).
  - `<difit-command> comment resolve <threadId...> --port <port>` — resolve threads you have addressed.
- If the review target changes (for example, a different commit range), stop the existing server and start a new one rather than leaving two servers for the same repository.

## Answering Review Comments With Fixup Commits

difit pins a review opened on a commit or branch to its SHA at startup. Fixup commits stacked on top afterwards are drawn under the comment they answer, and the user approves or rejects each one. Reviews of `.`, `working`, `staged`, `--pr`, or stdin have no commit to pin and show no overlay.

Each comment thread carries a state in the text output of `comment get`:

| Label            | Meaning                                                         | Agent action                       |
| ---------------- | --------------------------------------------------------------- | ---------------------------------- |
| `[수정 중]`      | No fix yet                                                      | Fix it                             |
| `[승인 대기]`    | A fixup is waiting for the user's decision                      | Wait                               |
| `[승인됨]`       | Approved, not folded yet                                        | Fold when the branch is wrapped up |
| `[접힘]`         | Folded into the target commit                                   | None                               |
| `[다시 수정 중]` | The user rejected the fixup                                     | Drop the fixup and fix again       |
| `[되돌림]`       | The user reverted a fix they made in the viewer on a new thread | Drop the fixup only                |

### Learning when it is your turn

A background command wakes you only when it exits, so while a review server you started is running, keep one `difit comment wait --port <port>` running as a background command. It exits as soon as a thread is your turn, printing each such thread as one JSON line: `threadId`, `filePath`, `position`, `message` (the latest message), and on pinned reviews `state` (`awaiting-fix`, `rejected` or `withdrawn`), `label` and, when a rejected fixup is still in the range, `rejectedFixupSha`, plus `fixupTarget` for a comment the user made while viewing one commit. Answer every thread it brings as below, then start `difit comment wait` again the same way. It also prints threads that became your turn before it started, so nothing is lost between runs; a thread you have not answered comes back at once.

- A thread is your turn when it is `[수정 중]` and the user spoke last, `[다시 수정 중]` with no new fixup and no reply from you after the rejection, or `[되돌림]` while its fixup is still in the range. On reviews without a pinned commit, any thread where the user spoke last is your turn. To answer in words instead of a fix (a question, or disagreeing with a rejection), add a reply with `comment add` (`"type": "reply"` with the thread's `filePath` and `position`); that also ends your turn.
- Exit code 0 with nothing on standard output means the review ended: start no more `difit comment wait` for it. A non-zero exit means it could not reach the server: show its standard error to the user, unless you stopped or restarted the server yourself; after a restart, start `difit comment wait` on the new port.

In Claude Code, a server started from your session (including `--background`) also sends each thread that newly became your turn into your session as a message from another session. Its first line is `difit review: your turn on <threadId> [<label>], ...; read with difit comment get --port <port> --format json`, and each following line is the same JSON `difit comment wait` prints. Answer it as below and keep `difit comment wait` running all the same: the message shape is undocumented and may stop arriving silently. When the same `threadId` with the same `state` comes both ways, answer it once.

The user can also edit code in the viewer. difit then commits a `fixup! <target SHA>` commit with a `Review-Thread` trailer on top of HEAD and records it as approved. Its author is `reviewer-edit`.

### Answering a comment

1. Read threads with their ids. The text output has no ids.

   ```bash
   difit comment get --port <port> --format json
   ```

   A comment the user made while viewing one commit has two more fields: `view` (the `baseCommitish` and `targetCommitish` of the diff it was made on) and `fixupTarget` (the SHA of the commit to fix into). The text output adds `고쳐 넣을 커밋: <short SHA> <subject>` right under that comment's location line. A comment without them was made on the whole review.

   - Line numbers belong to the `view` tree: read new-side lines with `git show <view.targetCommitish>:<file>` and old-side lines with `git show <view.baseCommitish>:<file>`. Without `view`, they belong to the review target.
   - Fix the code in HEAD. Later commits may have moved or changed those lines, so find the place by `codeSnapshot.content` rather than by line number. Make one fixup even when a later commit changed those lines; resolve the fold as in "Folding into a commit in the middle of the range".

2. Fix the code, then commit only that comment's changes as a fixup of the comment's `fixupTarget`, or of the review target when it has none, with the thread id as a trailer.

   ```bash
   git add <files changed for this comment>
   git commit --fixup=<fixupTarget, else review target SHA> --trailer "Review-Thread: <threadId>"
   ```

   On a git without `--trailer`, use `-m "Review-Thread: <threadId>"` instead; it lands below the `fixup!` subject after a blank line and reads the same.

   `--fixup` writes `fixup! <target subject>`, and autosquash folds it into the oldest commit in the range with that subject. If an earlier commit shares the target's subject, the fix lands there. Check first:

   ```bash
   git log --format=%s <review base>..<fixupTarget>^ | grep -Fx "$(git log -1 --format=%s <fixupTarget>)"
   ```

   If it prints anything, name the target by SHA instead, the shape fixups from the viewer use:

   ```bash
   git commit -m "fixup! <full fixupTarget SHA>" --trailer "Review-Thread: <threadId>"
   ```

- Keep exactly one fixup commit per comment. With two, the viewer cannot tell which one to decide on and hides both buttons.
- Re-read `comment get` right before committing and confirm the comment is still `[수정 중]` or `[다시 수정 중]`. The user may have edited that line in the viewer meanwhile.
- When fixing the same comment again before a decision, fold the change into the existing fixup instead of adding a commit: `git commit --amend --no-edit` when it is HEAD, otherwise `edit` it in `git rebase -i`.
- A rejected fixup shows up in the JSON `decisions` as `"kind": "rejected"` with its SHA. Drop it (`drop` in `git rebase -i`) before any other rebase, since rewriting the lines right next to it can clear the rejection mark, then fix again.
- For `[되돌림]`, drop the fixup as soon as you see it and do not fix again; until it is dropped, `difit comment wait` keeps bringing the thread back. A reverted reviewer edit that answered an existing comment shows `[다시 수정 중]` and is handled like any rejection.

### Folding approved fixups

Fold once, when the branch is wrapped up: every remaining fixup is `[승인됨]` and every rejected fixup is dropped. `--autosquash` folds all fixups in range.

The JSON `decisions` only accumulate. When the user unapproves, `"kind": "unapproved"` is added; the later of `approved` and `unapproved` for a thread wins, and a `rejected` later than the approval wins over both. Read the current state from the text output labels.

```bash
git rev-parse HEAD   # note this SHA as <pre-fold SHA>
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <review base>
```

`<review base>` is the compare-with side of the diff, or `<SHA>^` for a single-commit review. Start from the review base, not the target commit: a fixup for a comment made on one commit, or one the user made in the viewer, can point at an earlier commit in the range. Folding only regroups changes, so afterwards `git diff --exit-code <pre-fold SHA> HEAD` must print nothing. Note the SHA itself rather than a shell variable: a variable does not survive into the next command when each command runs on its own.

- If a fixup deletes everything its target added, the rebase stops at `Could not apply ... fixup!`. Keep an empty commit with `git commit --amend --allow-empty --no-edit`, or drop it with `git reset --soft HEAD^`, then `git rebase --continue`.
- Fixups from the viewer name their target by SHA. Rebasing onto a newer base or rewording the target before folding gives it a new SHA and leaves the fixup unfolded, so do those after folding. The rebase still reports success; confirm nothing is left:

  ```bash
  git log --format='%h %s' <review base>..HEAD | grep -E '^[0-9a-f]+ (fixup|squash|amend)! '
  ```

  For a leftover fixup, its target is the comment's `fixupTarget` when it has one; otherwise find it with `git show <fixup SHA>` and `git blame <fixup SHA>^ -- <file>` (a commit older than the range means the review target), move it under that commit in `git rebase -i`, and mark it `fixup`.

Folding removes the fixup commits, so record where each fix went on the running server, pairing the old fixup SHA with the commit it folded into. With no merge commits in the range, folding drops only the fixups and keeps the order, so the folded commit sits on the same line of `git rev-list --reverse <review base>..HEAD` as its target does in `git rev-list --reverse <review base>..<review target SHA>`:

```bash
curl -X POST "http://localhost:<port>/api/decisions" \
  -H 'Content-Type: application/json' \
  -d '[{"threadId":"<threadId>","kind":"folded","fixupSha":"<old fixup SHA>","targetSha":"<folded commit SHA>","at":"<ISO 8601 time>"}]'
```

`{"success":true,"changed":true,...}` means it was stored. Resending the same record does not duplicate it; a non-array body or a record with a missing field stores nothing and returns 400.

### Folding into a commit in the middle of the range

When a fixup targets a commit in the middle of the range and a later commit changed the same lines, the fixup was written against HEAD and the rebase stops twice. difit does not resolve this; resolve it by hand and keep the commented commit as the target, since that is the commit the user chose and approved.

1. It first stops at `Could not apply <fixup SHA>... fixup! <target subject>`. The `HEAD` side of the conflict is the target commit's lines. Keep those lines plus the fix only, without what later commits changed.
2. `git add <file>`, then `GIT_EDITOR=true git rebase --continue`. git opens an editor for the combined message; `GIT_EDITOR=true` keeps the target's message and drops the fixup's subject and trailer.
3. It then stops at the later commit, `Could not apply <SHA>... <its subject>`. The `HEAD` side is now the fixed lines and the other side is that commit's original lines. Put that commit's own change back on top of the fixed lines, then `git add` and `GIT_EDITOR=true git rebase --continue` again. Each further commit that changed those lines can stop the same way.
4. When the rebase finishes, run `git diff --exit-code <pre-fold SHA> HEAD`. If it prints anything, the resolution changed the result: `git reset --hard <pre-fold SHA>` (or `git rebase --abort` while the rebase is still running) and ask the user in a `comment add` reply on that thread.

### Moving comments to the folded commit

Folding changes the target SHA, and a review reopened on the new SHA starts without the comments. Copy them from the old server, keeping thread ids and `codeSnapshot` so trailers and decisions still point at the same comments, along with `view` and `fixupTarget`:

```bash
difit comment get --port <old port> --format json > old.json

difit comment add --port <new port> "$(jq '[.threads[] | . as $t
  | ($t.messages[0] | {type: "thread", id: $t.id, filePath: $t.filePath, position: $t.position,
                       body, author, createdAt, codeSnapshot: $t.codeSnapshot,
                       view: $t.view, fixupTarget: $t.fixupTarget}),
    ($t.messages[1:][] | {type: "reply", filePath: $t.filePath, position: $t.position,
                          body, author, createdAt})
  | with_entries(select(.value != null))]' old.json)"

jq '.decisions' old.json | curl -X POST "http://localhost:<new port>/api/decisions" \
  -H 'Content-Type: application/json' -d @-
```

The copied `view` and `fixupTarget` still name pre-fold SHAs, so in the new review such a comment shows only on the whole view, and its commit line shows the short SHA alone. For one you have not answered yet, fix up the commit on the same `git rev-list` line as above.

## Constraints

Can only be used inside a Git-managed directory.
