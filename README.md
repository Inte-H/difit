<h1 align="center">
  <img src="public/logo.png" alt="difit" width="260">
</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/difit"><img src="https://img.shields.io/npm/v/difit.svg" alt="npm version"></a>
  <a href="https://github.com/yoshiko-pg/difit/actions/workflows/pr.yml"><img src="https://github.com/yoshiko-pg/difit/actions/workflows/pr.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  English | <a href="./README.ja.md">日本語</a> | <a href="./README.zh.md">简体中文</a> | <a href="./README.ko.md">한국어</a>
</p>

![difit screenshot](docs/images/screenshot.png)

**difit** is a CLI tool that lets you view and review local git diffs with a GitHub-style viewer. In addition to clean visuals, comments can be copied as prompts for AI. The local code review tool for the AI era!

## ⚡ Quick Start

Try it first

```bash
npx difit  # View the latest commit diff in WebUI
```

Install and use

```bash
npm install -g difit
difit  # View the latest commit diff in WebUI
```

Enable use from AI agents

```bash
npx skills add yoshiko-pg/difit # Add the Skills to your agent
```

Installed skills include:

- `difit`: ask the user for a review in the difit viewer when the user explicitly opts in to difit
- `difit-review`: review a specific diff or PR and show the findings inside the difit viewer, when the user explicitly asks for difit

## 🚀 Usage

### Basic Usage

```bash
difit <target>                    # View single commit diff
difit <target> [compare-with]     # Compare two commits/branches
```

### Single commit review

```bash
difit          # HEAD (latest) commit
difit 6f4a9b7  # Specific commit
difit feature  # Latest commit on feature branch
```

### Compare two commits

```bash
difit @ main         # Compare with main branch (@ is alias for HEAD)
difit feature main   # Compare branches
difit . origin/main  # Compare working directory with remote main
```

### Special Arguments

difit supports special keywords for common diff scenarios:

```bash
difit .        # All uncommitted changes (staging area + unstaged)
difit staged   # Staging area changes
difit working  # Unstaged changes only
```

### GitHub PR

```bash
difit --pr https://github.com/owner/repo/pull/123
```

`--pr` mode fetches patches by running `gh pr diff --patch` under the hood.
It also imports unresolved inline review threads from the PR so they appear as startup comments in difit.

Authentication is handled by GitHub CLI:

1. **Login once** (recommended): `gh auth login`
2. **Token-based auth** (CI/non-interactive): set `GH_TOKEN` or `GITHUB_TOKEN`

#### GitHub Enterprise Server

For Enterprise Server PRs, authenticate GitHub CLI against your Enterprise host:

1. `gh auth login --hostname YOUR-ENTERPRISE-SERVER`
2. Or set `GH_HOST=YOUR-ENTERPRISE-SERVER` with `GH_TOKEN`/`GITHUB_TOKEN`

### Initial Comments

You can inject initial review comments when launching difit:

```bash
difit --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":10},"body":"The background for this change is..."}'
```

`--comment` is repeatable and accepts either a single JSON object or a JSON array. Supported types:

- `thread`: create a new thread at the specified diff position
- `reply`: add a reply to the latest existing thread at the same diff position

If the same comment already exists, difit skips importing it.

### Stdin

By using a pipe to pass unified diffs via stdin, you can view diffs from any tool with difit.

```bash
# View diffs from other tools
diff -u file1.txt file2.txt | difit

# Review saved patches
cat changes.patch | difit

# Compare against merge base
git diff --merge-base main feature | difit

# Review an entire existing file as newly added
git diff -- /dev/null path/to/file | difit

# Explicit stdin mode
git diff --cached | difit -
```

Stdin mode is selected with intent-first rules:

- `-` explicitly enables stdin mode
- If positional arguments (`<target>` / `[compare-with]`) or `--pr` are provided, difit treats the command as Git/PR mode and does not auto-read stdin
- Auto stdin detection applies only when no explicit mode is selected and stdin is a pipe/file/socket

## ⚙️ CLI Options

| Flag                  | Default         | Description                                                                                             |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `<target>`            | HEAD            | Commit hash, tag, HEAD~n, branch, or special arguments                                                  |
| `[compare-with]`      | -               | Optional second commit to compare with (shows diff between the two)                                     |
| `--merge-base`        | false           | Resolve the base revision with `git merge-base` before diffing (Git revision mode only)                 |
| `--pr <url>`          | -               | GitHub PR URL to review (e.g., https://github.com/owner/repo/pull/123)                                  |
| `--comment <json>`    | -               | Inject initial comments (repeatable; accepts a JSON object or array)                                    |
| `--port`              | 4966            | Preferred port; falls back to +1 if occupied                                                            |
| `--host`              | 127.0.0.1       | Host address to bind server to (use 0.0.0.0 for external access)                                        |
| `--no-open`           | false           | Don't automatically open browser                                                                        |
| `--clean`             | false           | Clear all existing comments and viewed files on startup                                                 |
| `--include-untracked` | false           | Automatically include untracked files in diff (only with `.` or `working`)                              |
| `--keep-alive`        | false           | Keep server running after browser disconnects (stop manually with Ctrl+C)                               |
| `--background`        | false           | Keep the server running in the background and output JSON connection info                               |
| `--context <lines>`   | git default (3) | Limit surrounding context lines per change (`0` shows changes only; not available with `--pr` or stdin) |

## 💬 Comment System

difit includes a review comment system that makes it easy to provide feedback to AI coding agents:

1. **Add Comments**: Click the comment button on any diff line or drag to select a range
2. **Edit Comments**: Edit existing comments with the edit button
3. **Generate Prompts**: Comments include a "Copy Prompt" button that formats the context for AI coding agents
4. **Copy All**: Use "Copy All Prompt" to copy all comments in a structured format
5. **Persistent Storage**: Comments are saved in browser localStorage per commit

### Comment Prompt Format

```sh
src/components/Button.tsx:L42   # This line is automatically added
Make this variable name more descriptive
```

For range selections:

```sh
src/components/Button.tsx:L42-L48   # This line is automatically added
This section is unnecessary
```

## 🔁 지적에 대한 수정을 겹쳐 보는 리뷰 (포크)

에이전트가 지적마다 고친 내용을 지적 달린 줄 아래에 겹쳐 그리고, 리뷰어는 지적 하나씩 승인하거나 거절한다.

### 리뷰 열기

리뷰할 커밋을 SHA로 고정해서 연다.

```sh
difit "$(git rev-parse HEAD)"
```

`HEAD`나 브랜치 이름으로 열면 에이전트가 고친 커밋이 쌓일 때마다 리뷰 대상도 따라 움직인다. 그러면 고친 내용이 이미 diff 안에 들어가 있어서 겹쳐 그릴 것이 없다. SHA로 고정하면 그 커밋 뒤에 쌓인 수정만 따로 모아 겹쳐 보여 준다. 그래서 SHA로 연 리뷰에만 지적마다 상태와 승인·거절 단추가 붙고, `HEAD`나 브랜치 이름으로 연 리뷰는 원래 difit처럼 보인다.

SHA로 고정한 리뷰는 파일 변경을 감시하지 않는다. 에이전트가 새로 올린 fixup 커밋은 리뷰 탭으로 돌아올 때 다시 읽어 온다. 화면을 켜 둔 채 기다리기만 하면 새로 읽지 않으니, 그럴 때는 새로고침한다.

위쪽 도구 막대의 `수정을 겹쳐 보기`로 겹침 카드를 켜고 끈다.

### 지적 카드의 상태

| 상태         | 뜻                                          | 리뷰어가 할 일            |
| ------------ | ------------------------------------------- | ------------------------- |
| 수정 중      | 에이전트가 아직 답하지 않았다               | 기다린다                  |
| 승인 대기    | 수정이 도착해 줄 아래에 겹쳐 보인다         | `승인` 또는 `거절`        |
| 승인됨       | 승인했지만 아직 원래 커밋에 합쳐지지 않았다 | 잘못 눌렀으면 `승인 취소` |
| 접힘         | 승인한 수정이 원래 커밋에 합쳐졌다          | 없음                      |
| 다시 수정 중 | 거절해서 에이전트가 다시 고치고 있다        | 기다린다                  |
| 되돌림       | 리뷰어가 직접 고친 수정을 되돌렸다          | 없음                      |

### 리뷰어가 직접 고치기

지적을 남기는 대신 리뷰어가 화면에서 코드를 바로 고칠 수도 있다. 쓸데없는 주석 한 줄을 지우자고 지적을 달고 에이전트를 기다릴 필요가 없다. 고친 내용은 리뷰 대상 커밋을 향한 fixup 커밋으로 남으므로, 대상 커밋이 HEAD가 아니어도 `rebase -i` 없이 고칠 수 있다.

고칠 줄은 세 가지로 고른다. 바뀐 쪽(오른쪽) 줄만 고칠 수 있다.

- 줄 번호 옆 연필 버튼: 그 줄 하나. Shift를 누른 채 누르면 앞서 누른 줄부터 그 줄까지.
- hunk 오른쪽 위의 `hunk 고치기`: hunk 전체.
- 지적 카드의 `직접 고치기`: 그 지적이 달린 줄. 아직 수정이 오지 않았거나 거절된 지적에만 뜬다.

입력 칸에서 고친 뒤 `fixup 커밋`을 누르면 서버가 이렇게 한다.

1. 리뷰 대상 커밋의 파일에서 고친 내용을 HEAD의 파일에 3-way로 합친다.
2. 합친 파일로 HEAD 바로 위에 `fixup! <대상 커밋 SHA>` 커밋을 만들고, 본문에 대상 커밋의 제목과 `Review-Thread` 트레일러를 적는다. 작업 트리와 인덱스를 거치지 않고 git 내부 명령으로 만들므로 다른 파일의 변경은 섞이지 않는다.
3. 커밋이 올라간 뒤 작업 트리의 그 파일이 이전 HEAD 내용 그대로면 새 내용으로 바꿔 쓴다. 그사이 누가 그 파일을 고쳤으면 손대지 않는다.
4. 고친 줄에 수정을 기다리는 지적이 하나 있으면 그 지적의 답으로 묶고, 없으면 스레드를 새로 연다. 서버가 남기는 메시지의 author는 `reviewer-edit`이다.
5. 리뷰어가 직접 고친 것이므로 곧바로 승인으로 기록한다.

fixup이 접힐 커밋은 이렇게 정한다.

- 대상 커밋은 제목이 아니라 SHA로 적는다. 제목으로 적으면 autosquash가 제목이 같은 더 오래된 커밋에 합치고, 제목이 빈 커밋은 찾지 못한다.
- 커밋 여러 개를 한꺼번에 보는 리뷰라면 `git blame`으로 고친 줄을 넣은 커밋을 찾는다. 범위 안에서 한 번도 바뀌지 않은 줄을 고쳤으면 리뷰 대상 커밋으로 한다.
- 그 커밋에 접으면 뒤 커밋을 다시 적용하다가 충돌할 수 있다. 서버는 autosquash가 그 파일에 할 일을 미리 해 보고, 충돌 없이 접히는 범위 안의 가장 이른 커밋을 고른다.

잘못 고쳤으면 카드의 `되돌리기`를 누른다. fixup 커밋은 그대로 두고 거절로만 기록하며, 브랜치를 마무리할 때 에이전트가 버린다. 직접 고치면서 새로 연 스레드는 `되돌림`으로 닫히고, 원래 있던 지적에 답한 것이었다면 그 지적은 `다시 수정 중`으로 돌아가 에이전트가 이어 고친다.

커밋 훅은 돌지 않는다. 훅이 파일을 고치거나 스테이지를 바꾸면 리뷰어가 고치지 않은 내용이 fixup에 섞이고, 훅이 메시지를 바꾸면 접히지 않는다. 접을 때 쓰는 `rebase --autosquash`도 훅을 돌리지 않으므로 포맷과 테스트는 브랜치를 마무리할 때 한 번 돌린다. fixup 커밋은 서명하지 않으며, `commit.gpgSign`을 켠 저장소라면 접을 때 rebase가 새로 만드는 커밋에 서명한다. git이 커밋을 만들지 못하면 git 출력을 입력 칸 아래에 보여 준다.

커밋을 만드는 사이 에이전트가 커밋을 올려 HEAD가 바뀌면, 새 HEAD에 다시 합쳐 그 위에 올린다. 에이전트가 올린 변경은 그대로 남는다.

다음 경우에는 커밋하지 않고 까닭을 보여 준다.

- 리뷰 대상 커밋이 지금 체크아웃한 브랜치에 없거나, HEAD가 브랜치에 있지 않다(detached HEAD).
- 고칠 파일이 일반 파일이 아니다(심볼릭 링크, 서브모듈). 바이너리 파일과 UTF-8이 아닌 파일도 고치지 않는다.
- 고친 파일에 커밋하지 않은 변경(staged, unstaged)이 있다. 다른 파일의 변경은 상관없고 건드리지도 않는다.
- rebase, merge, cherry-pick이 도중에 멈춰 있다.
- 뒤의 커밋이 같은 줄이나 바로 옆 줄을 바꿔 두어 합치면 충돌한다.
- 뒤의 커밋이 이미 똑같이 고쳐 두어 바뀌는 것이 없다. 앞서 직접 고쳤다가 되돌린 fixup이 아직 HEAD에 남아 있어도 이렇게 된다.
- 범위 안의 어느 커밋에 접어도 충돌한다.
- 고른 줄들이 범위 안의 서로 다른 커밋에서 왔다.
- 그 지적에 판정을 기다리는 fixup이 이미 있다.
- 다시 합쳐 올리는 동안에도 HEAD가 계속 바뀌었다.

직접 고치기는 SHA로 연 리뷰에서만 켜지고, `--host`로 localhost가 아닌 주소에 열면 꺼진다.

### 에이전트용: 지적에 답하기

1. 지적과 스레드 id를 읽는다. 텍스트 출력에는 id가 없으므로 JSON으로 읽는다.

   ```sh
   difit comment get --port <port> --format json
   ```

2. 코드를 고친 뒤, 리뷰 대상 커밋을 향한 fixup 커밋을 만들고 스레드 id를 트레일러로 붙인다.

   ```sh
   git commit -a --fixup=<리뷰 대상 SHA> --trailer "Review-Thread: <threadId>"
   ```

   git이 오래돼 `--trailer`를 모르면 트레일러 줄을 메시지로 직접 넣는다. `fixup!` 제목 아래에 빈 줄을 두고 붙으므로 화면이 똑같이 읽는다.

   ```sh
   git commit -a --fixup=<리뷰 대상 SHA> -m "Review-Thread: <threadId>"
   ```

   - 지적 하나에 fixup 커밋 하나만 둔다. 같은 지적에 fixup이 둘이면 화면이 어느 쪽을 판정할지 정하지 못한다.
   - fixup을 만들기 직전에 `comment get`을 다시 읽어 그 지적이 아직 `[수정 중]`이나 `[다시 수정 중]`인지 확인한다. 그사이 리뷰어가 화면에서 직접 고쳤다면 지적 하나에 fixup이 둘이 되어 카드의 승인·거절 단추가 모두 사라진다.
   - 판정 전에 같은 지적을 또 고쳤다면 새 커밋을 만들지 말고 앞의 fixup 커밋에 합친다. 그 커밋이 맨 위면 `git commit -a --amend --no-edit`, 아니면 `git rebase -i`에서 그 커밋을 `edit`한다.
   - 지적 여러 개를 고쳤으면 지적마다 fixup 커밋을 따로 만든다.

3. 리뷰어가 거절하면 `comment get --format json`의 `decisions`에 `"kind": "rejected"`와 그 fixup의 SHA가 남는다. 거절된 fixup 커밋은 버리고(`git rebase -i`에서 `drop`) 새로 고쳐 다시 만든다. 버리기 전에 rebase로 그 fixup 바로 옆 줄이 바뀌면 거절 표시가 풀릴 수 있으니, 거절된 fixup부터 버린다.

4. 리뷰어가 직접 고친 fixup을 `되돌리기`로 거절했을 때도 같은 방법으로 버린다. 리뷰어가 직접 고치면서 연 스레드는 텍스트 출력에 `[되돌림]`이 붙는데, 이때는 fixup만 버리고 다시 고치지 않는다. 원래 있던 지적에 리뷰어가 직접 고쳐 답했다가 되돌렸으면 `[다시 수정 중]`이 붙으니, 여느 거절처럼 버리고 새로 고친다.

### 에이전트용: 승인된 수정 접기와 기록 올리기

브랜치를 마무리할 때 한 번에 접는다. `--autosquash`는 범위 안의 fixup을 모두 접으므로, 남은 fixup이 전부 승인되고 거절된 fixup을 모두 버린 뒤에 돌린다.

승인 여부는 `difit comment get --port <port>` 텍스트 출력에서 지적마다 붙는 `[승인됨]`으로 확인한다. JSON의 `decisions`는 판정을 지우지 않고 쌓기만 한다. 리뷰어가 승인을 취소하면 `"kind": "unapproved"`가 더해지므로, 같은 지적의 `approved`와 `unapproved` 가운데 시각이 늦은 쪽이 지금의 판정이다. 다만 승인한 fixup에 그보다 늦은 `rejected`가 있으면 거절이 우선한다. 리뷰어가 직접 고친 수정을 `되돌리기`로 거절하면 이렇게 남는다.

```sh
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <리뷰 범위의 시작 커밋>
```

리뷰 범위의 시작 커밋은 diff의 비교 기준이다. `difit <SHA>`로 연 리뷰라면 `<SHA>^`이다. 커밋 여러 개를 한꺼번에 본 리뷰에서는 리뷰어가 직접 고친 fixup이 범위 중간의 커밋을 향할 수 있으므로, 리뷰 대상 커밋이 아니라 범위의 시작점부터 돌려야 모두 접힌다.

fixup이 대상 커밋이 넣은 내용을 전부 지우면 그 커밋이 비게 되어 rebase가 `Could not apply ... fixup!`에서 멈춘다. 빈 커밋으로 남기려면 `git commit --amend --allow-empty --no-edit`, 커밋째 없애려면 `git reset --soft HEAD^`를 한 뒤 `git rebase --continue`로 잇는다.

리뷰어가 직접 고친 fixup은 SHA로 대상을 가리킨다(`fixup! <SHA>`). 접기 전에 대상 커밋이 rebase로 새 SHA를 받으면 짝을 찾지 못해 접히지 않고 남으므로, 기준 브랜치를 따라잡는 rebase나 대상 커밋의 메시지 수정은 접은 뒤에 한다. rebase는 짝을 못 찾아도 성공으로 끝나므로, 접은 뒤에 아래 명령이 아무것도 출력하지 않는지 확인한다.

```sh
git log --format='%h %s' <리뷰 범위의 시작 커밋>..HEAD | grep -E '^[0-9a-f]+ (fixup|squash|amend)! '
```

남은 fixup이 있으면 짝 커밋을 골라 `git rebase -i`에서 fixup을 그 커밋 바로 아래로 옮기고 `fixup`으로 바꾼다. fixup 본문 첫 줄에는 fixup을 만들 때의 대상 커밋 제목이 적혀 있다. 그 사이 제목이 바뀌었거나 같은 제목의 커밋이 여럿이면, `git show <fixup SHA>`로 무엇을 고쳤는지 보고 `git blame <fixup SHA>^ -- <파일>`로 그 자리의 줄을 넣은 커밋을 확인한다. 리뷰 범위보다 앞의 커밋이 나오면 짝은 리뷰 대상 커밋이다.

접으면 fixup 커밋이 사라지므로, 어떤 수정이 어느 커밋으로 들어갔는지를 실행 중인 서버에 기록한다. 지적마다 옛 fixup SHA와 접힌 뒤의 새 커밋 SHA를 짝지어 올린다.

```sh
curl -X POST "http://localhost:<port>/api/decisions" \
  -H 'Content-Type: application/json' \
  -d '[{"threadId":"<threadId>","kind":"folded","fixupSha":"<옛 fixup SHA>","targetSha":"<접힌 뒤 커밋 SHA>","at":"2026-09-23T10:00:00Z"}]'
```

응답이 `{"success":true,"changed":true,...}`면 받은 것이다. 같은 기록을 다시 보내도 중복으로 쌓이지 않는다. 본문이 배열이 아니거나 필드가 빠진 기록이 하나라도 있으면 아무것도 기록하지 않고 400으로 답한다.

### 에이전트용: 접은 뒤의 커밋으로 지적 옮기기

접으면 리뷰 대상 커밋의 SHA가 바뀐다. 새 SHA로 리뷰를 다시 열면 지적은 옛 SHA의 리뷰에 남아 있으므로, 옛 서버에서 꺼내 새 서버에 넣는다. `comment get`은 지적마다 메시지를 배열로 주고 `comment add`는 첫 메시지를 `thread`, 나머지를 `reply`로 받으므로 모양을 바꿔 넣는다. 지적 id와 `codeSnapshot`(줄 내용과 지적을 단 커밋)을 그대로 실어야 fixup 트레일러와 결정 기록이 같은 지적을 가리키고, 화면이 지적의 자리를 다시 찾을 수 있다.

```sh
difit comment get --port <옛 port> --format json > old.json

difit comment add --port <새 port> "$(jq '[.threads[] | . as $t
  | ($t.messages[0] | {type: "thread", id: $t.id, filePath: $t.filePath, position: $t.position,
                       body, author, createdAt, codeSnapshot: $t.codeSnapshot}),
    ($t.messages[1:][] | {type: "reply", filePath: $t.filePath, position: $t.position,
                          body, author, createdAt})
  | with_entries(select(.value != null))]' old.json)"

jq '.decisions' old.json | curl -X POST "http://localhost:<새 port>/api/decisions" \
  -H 'Content-Type: application/json' -d @-
```

새 커밋의 화면은 옮겨 온 지적을 이렇게 놓는다.

- 저장한 줄 내용과 똑같은 줄이 보이는 줄 가운데 한 곳뿐이면, 줄 번호가 밀렸어도 그 줄로 옮긴다.
- 그 내용이 사라졌거나 `}`처럼 여러 곳에 있으면 `낡음`으로 두고 수정을 겹쳐 그리지 않는다. 비슷한 자리에 끼워 맞추지 않는다.
- 낡은 지적에는 `이 지적을 달던 시점으로` 단추가 뜨고, 누르면 지적을 단 커밋으로 리뷰를 다시 연다.

이 단추에는 한계가 있다. 옛 리뷰의 지적은 브라우저 저장소에 남아 있으므로, 옛 리뷰를 본 브라우저에서 같은 저장소 폴더를 같은 주소(포트)로 열었을 때만 지적이 함께 보인다. 돌아가도 fixup은 이미 접혀 없으므로 어떻게 고쳤는지는 보이지 않는다.

## 🤖 Calling from Agents

You can install the following Skills to work with difit from AI agents.

```sh
npx skills add yoshiko-pg/difit
```

Installed skills include:

- `difit`: ask the user for a review in the difit viewer when the user explicitly opts in to difit
- `difit-review`: review a specific diff or PR and show the findings inside the difit viewer, when the user explicitly asks for difit

After code edits or automated review, the agent can start the difit server with the appropriate skill.

## 🎨 Syntax Highlighting Languages

- **JavaScript/TypeScript**: `.js`, `.jsx`, `.ts`, `.tsx`, `.svelte`
- **Web Technologies**: HTML, CSS, JSON, XML, Markdown
- **Shell Scripts**: `.sh`, `.bash`, `.zsh`, `.fish`
- **Backend Languages**: PHP, SQL, Ruby, Java, Groovy, Scala, Perl, Elixir, Haskell, Clojure
- **Systems Languages**: C, C++, C#, Rust, Go
- **Mobile Languages**: Swift, Kotlin, Dart
- **Infrastructure as Code**: Terraform (HCL), Nix
- **Others**: Python, Protobuf, YAML, Solidity, Vim script, GDScript

## 🔍 Auto-collapsed Files

difit automatically identifies and collapses certain files to keep your view clean:

- **Deleted files**: Removed files are auto-collapsed since they don't require close review
- **Generated files**: Auto-generated code is collapsed by default. This includes:
  - Lock files (`package-lock.json`, `go.sum`, `Cargo.lock`, `Gemfile.lock`, etc.)
  - Minified files (`*.min.js`, `*.min.css`)
  - Source maps (`*.map`)
  - Generated code:
    - Orval (`*.msw.ts`, `*.zod.ts`, `*.api.ts`)
    - Dart (`*.g.dart`, `*.freezed.dart`)
    - C# (`*.g.cs`, `*.designer.cs`)
    - Protobuf (`*.pb.go`, `*.pb.cc`, `*.pb.h`)
  - Frameworks:
    - Ruby on Rails (`db/schema.rb`)
    - Laravel (`_ide_helper.php`)
    - Gradle (`gradle.lockfile`)
    - Python (`uv.lock`, `pdm.lock`)
  - Generic generated files (`*.generated.cs`, `*.generated.ts`, `*.generated.js`)
  - Content-based detection:
    - Files containing `@generated` marker
    - Files containing `DO NOT EDIT` header
    - Language-specific generated headers (Go, Python, etc.)

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Start development server (with hot reload)
# This runs both Vite dev server and CLI with NODE_ENV=development
pnpm run dev

# Build and start production server
pnpm run start <target>

# Build for production
pnpm run build

# Run tests
pnpm test

# Run typecheck, lint, and format
pnpm run check
pnpm run format
```

### Development Workflow

- **`pnpm run dev`**: Starts both Vite dev server (with hot reload) and CLI server simultaneously
- **`pnpm run start <target>`**: Builds everything and starts production server (for testing final build)
- **Development mode**: Uses Vite's dev server for hot reload and fast development
- **Production mode**: Serves built static files (used by npx and production builds)

## 🏗️ Architecture

- **CLI**: Commander.js for argument parsing with comprehensive validation
- **Backend**: Express server with simple-git for diff processing
- **GitHub Integration**: GitHub CLI (`gh pr diff --patch`) for PR patch retrieval
- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS v4 with GitHub-like dark theme
- **Syntax Highlighting**: Prism.js with dynamic language loading
- **Testing**: Vitest for unit tests with co-located test files
- **Quality**: oxlint, oxfmt, lefthook pre-commit hooks

## 📋 Requirements

- Node.js ≥ 21.0.0
- Git repository with commits to review
- GitHub CLI (`gh`) for `--pr` mode

## 📄 License

MIT
