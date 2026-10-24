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

## 🍴 이 포크에서 달라진 것

이 포크는 에이전트가 짠 브랜치를 사람이 리뷰하고 에이전트가 그 지적을 고쳐 오는 일을 difit 한 화면에서 끝까지 하려고 원래 difit에 기능을 더했다. 원래 difit은 지적을 복사해 에이전트에게 붙여 넣는 데서 끝나지만, 이 포크에서는 에이전트가 고친 것이 지적이 달린 줄 아래에 바로 나타난다.

### 설치

main에 병합할 때마다 GitHub 릴리스가 새로 올라온다. 최신 빌드는 아래 한 줄로 깐다.

```bash
npm i -g https://github.com/Inte-H/difit/releases/latest/download/difit.tgz
```

특정 빌드를 깔려면 `https://github.com/Inte-H/difit/releases/download/v<버전>/difit-<버전>.tgz`를 쓴다. 버전은 `5.0.12-inteh.3`처럼 원래 difit 버전 뒤에 포크 표시가 붙는다.

### 리뷰 흐름

1. **리뷰 열기**: `difit feature main`처럼 브랜치 이름으로 연다. 리뷰는 연 순간의 커밋에 머문다
2. **지적 남기기**: 사람이 줄마다 지적을 남긴다
3. **수정 받기**: 에이전트가 지적 하나에 fixup 커밋 하나로 고쳐 올리면, 그 수정이 지적 아래에 겹쳐 보인다
4. **승인하기**: 사람이 수정을 `승인`하거나 `거절`한다. 거절하면 에이전트가 다시 고친다
5. **합치기**: 브랜치를 마무리할 때 승인한 수정을 원래 커밋에 합친다. fixup 커밋은 기록에 남지 않는다

에이전트가 지적을 받아 고치고 합치는 절차는 [docs/agent-review.md](docs/agent-review.md)에 있다.

### 새 기능

- **수정 겹쳐 보기**: 에이전트가 올린 fixup을 지적이 달린 줄 아래에 카드로 보여 주고, 카드에서 `승인`, `거절`, `승인 취소`를 누른다. 카드에는 지적이 달린 파일의 변경만 보이고, fixup이 함께 고친 다른 파일은 카드 아래 `이 fixup에서 수정한 다른 파일:`에 이름으로 적혀 누르면 그 변경으로 간다. 리뷰 범위에 있는 파일은 fixup이 바꾼 줄 바로 아래에 노란 상자로 보이고, 원래 커밋이 건드리지 않아 접혀 있던 줄이면 그 앞뒤 3줄을 펼쳐 넣는다. 상자의 머리줄에서 어느 지적을 고치며 바꾼 것인지 보고 그 지적 카드로 갈 수 있고, 파일 목록의 그 파일 옆에는 `fixup 수정`이 붙는다. 리뷰 범위에 없는 파일은 파일 목록 아래 `fixup <짧은 해시>에서만 수정한 파일 (N)` 묶음과 본문 맨 아래에 따로 보이고, 생성 파일은 접혀 있다. 이 파일에도 지적을 달 수 있고, 그 지적은 fixup이 합쳐질 원래 커밋에 묶인다. 다른 파일의 변경은 `전체` 화면에서만 보여서, 커밋 하나나 몇 개만 고른 화면의 카드에서 파일 이름을 누르면 `전체` 화면으로 바꿔 그 변경을 보인다. `승인`과 `거절`은 지적 카드에서만 누른다. 위쪽 도구 막대의 `수정을 겹쳐 보기`로 켜고 끈다. `working`, `staged`, `.`, `--pr`, 표준 입력으로 연 리뷰에는 겹쳐 볼 것이 없어 원래 difit처럼 보인다
- **새 커밋 알림**: 리뷰 중인 브랜치에 fixup이 아닌 커밋이 새로 올라오면 도구 막대에 `다시 열기`가 뜬다
- **화면에서 직접 고치기**: 줄의 연필 버튼, 코드를 끌어 고르면 뜨는 막대의 `직접 고치기`(여러 줄), hunk 오른쪽 위의 `hunk 고치기`, 지적 카드의 `직접 고치기`로 코드를 고치고 `저장`하면 승인된 fixup 커밋이 바로 만들어진다. 잘못 고쳤으면 `되돌리기`를 누른다. 커밋에 머문 리뷰를 localhost에서 열었을 때만 켜지고, 커밋 훅은 돌지 않는다([이유](docs/adr/0003-reviewer-edits-become-fixups.md))
- **바뀌지 않은 코드 찾아보기**: 코드에서 이름을 누르고 `<이름> 찾기`를 누르면(Ctrl이나 Cmd를 누른 채 누르면 바로) 그 이름이 선언된 줄과 쓰인 줄, 그 파일 전체가 창으로 열린다. 창 안에서 다시 누르면 한 단계 더 들어가고 `←`로 돌아온다. 언어 서버 없이 찾으므로 이름이 같은 다른 선언도 나온다. `--pr`과 표준 입력으로 연 리뷰에서는 쓸 수 없다
- **주석이나 공백만 바뀐 곳 접기**: 코드는 그대로인 hunk를 숨은 줄 바와 같은 모양의 `주석 N줄 바뀜` 한 줄로 접고, 펼친 뒤에는 그 위에 작은 `▾ 주석 N줄 바뀜 · 접기` 글자가 남아 그 자리에서 다시 접는다. 파일이나 fixup 전체가 그렇다면 `주석`이나 `공백` 배지를 붙인다. 도구 막대의 `주석 변경 접기`로 켜고 끈다. TS/TSX/JS, Python, Go, Rust, Java, CSS, Bash만 판정하고, `@ts-ignore`처럼 도구가 읽는 주석은 코드로 본다([판정 방법](docs/adr/0006-fold-changes-that-leave-code-alone.md))
- **에이전트 차례 알림**: `difit comment wait`는 에이전트가 고칠 지적이 생기면 끝나므로, 에이전트가 백그라운드로 띄워 두고 알림으로 쓴다. Claude Code 세션이 띄운 difit은 그 세션에 메시지로도 알린다
- **메시지 하나 복사**: 스레드의 메시지마다 그 메시지 하나를 복사하는 버튼이 있다
- **고른 코드에 지적 달기**: 코드 글자를 끌어 고르면(폰에서는 길게 눌러 고르면) `고른 부분에 지적 달기` 막대가 뜬다. 누르면 그 줄들에 지적 입력창이 열리고, 고른 글자가 인용으로 붙는다. 줄 번호를 끌면 그 줄 범위 전체에 지적을 단다
- **지금 보는 파일 표시**: diff를 스크롤하면 화면 위쪽에 걸린 파일에 파일 목록과 폰 파일 칩에서 세로 막대가 붙는다. 키보드 커서가 있는 파일의 배경색과는 따로 붙고, 커서는 스크롤해도 제자리에 있다. 보던 곳에서 이어 가려면 `.`를 누른다
- **커밋 하나씩, 또는 범위로 보기**: 리뷰 범위에 커밋이 둘 이상이면 파일 목록 아래에 커밋 목록이 뜬다. 커밋 목록은 처음에 사이드바 높이의 40%까지만 차지하고, 목록 머리 위 경계를 끌어 높이를 바꾸면 새로 고침 뒤에도 그 높이를 쓴다. 커밋이 다 보이면 그보다 높이 끌어 올려지지 않는다. 커밋을 누르면 그 커밋 하나의 diff를, `전체`를 누르거나 보고 있는 커밋을 다시 누르면 범위 전체를 보고, 브라우저 뒤로 가기로 앞 화면에 돌아간다. 커밋 하나를 누른 뒤 다른 커밋을 Shift+클릭하거나, 한 커밋에서 다른 커밋까지 드래그하면 그 사이 커밋들을 합친 diff를 본다. 폰에서는 머리글의 커밋 단추로 커밋 목록 서랍을 연다. 커밋을 짧게 누르면 그 커밋 하나를 보고, 길게 누른 뒤 손을 떼지 않고 다른 커밋까지 끌거나 손을 뗀 뒤 다른 커밋을 누르면 그 사이를 본다. 고르는 중에는 목록 위의 `취소`를 눌러 그만둔다. `<`·`>` 키로 이전·다음 커밋으로 옮겨 가고, `전체`를 보는 중이면 마지막·첫 커밋으로 간다. 어느 화면을 보든 지적은 리뷰 하나에 쌓이고 `difit comment get`·`wait`도 리뷰 전체를 읽는다. 커밋 화면에서 단 지적은 그 커밋에 묶여, 카드에 그 커밋의 짧은 해시가 보이고 에이전트가 그 커밋으로 fixup을 걸어 마무리 때 그 커밋에 접힌다. 커밋 줄 오른쪽에는 그 커밋으로 고쳐 넣을 지적 가운데 아직 고치지 않은 지적(수정 중·다시 수정 중)의 수가 파일 목록처럼 말풍선과 숫자로 뜬다. 커밋 화면에는 그 커밋으로 고쳐 넣을 지적만 보이고, 다른 화면에서 자리를 못 찾은 지적에는 `이 지적을 단 화면으로` 단추가 뜬다. 범위 화면에서도 지적을 달 수 있고, 고쳐 넣을 커밋이 그 범위에 드는 지적만 보인다. 범위나 `전체` 화면에서 단 지적은 그 화면의 커밋 가운데 그 줄을 마지막으로 바꾼 커밋에 묶인다. 지운 줄이나 그 화면의 커밋이 바꾸지 않은 줄이면 그 화면의 마지막 커밋에 묶인다. 직접 고치기는 커밋·범위 화면에서도 되고, 고친 줄은 그 화면의 커밋 가운데 하나에 fixup으로 들어간다([이유](docs/adr/0008-bind-comments-to-the-commit-they-were-made-on.md))
- **코멘트 패널**: 머리글의 `코멘트` 단추나 `Shift+L`로 diff 오른쪽에 지적 목록 패널을 연다. 지적마다 파일:줄, 첫 글의 앞 두 줄, `열림`(에이전트가 고칠 차례)·`답함`(에이전트가 답해 리뷰어가 볼 차례)·`해결` 표시가 한 줄로 나오고, 처음에는 `남은 것`(열림과 답함)만, `전체`를 누르면 해결된 지적도 보인다. 지적을 누르거나 `Enter`를 누르면 그 줄로 가고 패널은 열려 있으며, 고른 지적은 패널의 줄, diff의 카드, 파일 목록의 파일에 파란 테두리로 표시된다. 본 것으로 접힌 파일이나 감춘 해결된 지적도 고르면 펼쳐서 보인다. 패널 왼쪽 경계를 드래그해 폭을 바꾸고, 열림 상태와 폭은 파일 목록처럼 기억한다. 폰에서는 머리글의 말풍선 단추로 오른쪽 서랍을 열고, 지적을 누르면 서랍이 닫힌다
- **파일 목록 키보드**: `Shift+B` 하나로 왼쪽 파일 목록과 diff를 오간다. 코멘트 패널의 `Shift+L`과 같은 규칙으로, 파일 목록이 닫혀 있으면 열고 `j`/`k`가 파일 목록을 움직이며, 열려 있는데 diff를 보고 있으면 파일 목록으로 돌아가고, 파일 목록에 있으면 닫는다. 파일 목록에 들어가면 diff 커서가 있는 파일에서 시작하고, 커서가 없으면 화면 맨 위에 보이는 파일에서 시작한다. 파일 목록에서 `j`/`k`는 파일과 폴더 사이를 움직이고, 파일에서 `Enter`를 누르면 diff가 그 파일로 가고 키는 파일 목록에 남으며, 폴더에서 `Enter`를 누르면 접히거나 펼쳐진다. `Esc`나 diff 클릭은 `j`/`k`를 diff로 돌려보내고 파일 목록은 열어 둔다. 머리글 단추로 열면 `j`/`k`는 diff에 남는다. 지금 `j`/`k`가 움직이는 파일 목록에는 파란 테두리가 붙는다. 폰에서는 `Shift+B`가 파일 서랍을 열고 `Esc`가 닫는다
- **커밋 그래프**: 커밋 목록의 줄 왼쪽에 커밋마다 세로선 위의 점을 찍는다. 범위에 병합 커밋이 있으면 그 병합으로 들어온 브랜치의 커밋을 병합 커밋 바로 위에 옆 갈래로 그리고, 브랜치마다 다른 색을 쓴다(세 가지 색을 병합 순서대로 돌려 쓴다). 브랜치 커밋의 점은 브랜치 선 위에 놓이고, 선은 갈라지는 곳과 병합 커밋에서만 둥글게 휜다. 갈라지는 곳은 보통 브랜치 바로 위 커밋 줄이지만, 그 커밋이 병합 커밋이면 브랜치의 첫 줄이다. 범위의 첫 커밋이 병합 커밋이면 그 브랜치는 목록 위에서 곧게 내려온다. 고른 커밋은 목록 줄의 강조로 보인다. 브랜치 커밋은 고를 수 없고, 병합 커밋의 diff에 이미 들어 있어 병합 커밋을 고르면 그 줄들도 함께 강조된다. 브랜치가 길면 최근 20개만 그리고 나머지는 개수로 적는다

### 원래 difit과 다르게 동작하는 것

- Resolve를 눌러도 지적을 지우지 않고 `해결됨`으로 접어 둔다. 눌린 ✓를 다시 누르거나 답글을 달면 다시 열린다. 도구 막대의 `해결된 지적 보기`를 끄면 diff에서 감춘다([이유](docs/adr/0007-resolve-keeps-the-thread.md))
- 해결된 지적은 `Copy All`, 에이전트에게 넘기는 목록, 파일 목록의 댓글 수에서 빠진다
- 댓글 입력창에서 Enter를 누르면 보내고 Shift+Enter로 줄을 바꾼다. 한글을 조합하는 중에 누른 Enter로는 보내지 않는다
- 댓글 입력창에 `Add suggestion` 버튼이 없다
- 지적 카드의 복사 버튼은 `경로:L42` 같은 위치 줄 없이 지적 글만 복사한다. 에이전트는 `difit comment get`으로 위치와 코드를 따로 받기 때문이다. 제안 블록을 풀어 복사하는 것과 `Copy All`이 위치 줄을 붙이는 것은 원래 difit과 같다
- 마우스가 있는 기기에서는 지적 버튼이 줄 번호 위에, 에디터에서 열기와 직접 고치기 버튼이 줄 오른쪽 끝에 있어 코드 첫머리를 가리지 않는다. 터치 기기에서는 줄 번호 위의 버튼 하나를 누르면 세 가지가 메뉴로 나온다
- 주석이나 공백만 바뀐 hunk는 처음부터 접혀 있다
- All Comments 창 대신 코멘트 패널을 쓰고, 노란 단추 메뉴의 `View All Comments`도 패널을 연다. `Shift+L` 하나로 패널과 diff를 오간다. 패널이 닫혀 있으면 열고 `j`/`k`·`Enter`·`d`가 패널 목록을 움직이며, 열려 있는데 diff를 보고 있으면 패널로 돌아가고, 패널에 있으면 닫는다. `Esc`나 diff 클릭은 `j`/`k`를 diff로 돌려보내고 패널은 열어 둔다(폰에서는 `Esc`가 서랍을 닫는다). 머리글 단추로 열면 `j`/`k`는 diff에 남는다. 지금 `j`/`k`가 움직이는 패널에는 파란 테두리가 붙는다
- `difit`이나 `difit feature main`처럼 이름으로 연 리뷰도 연 순간의 커밋에 머물러, 브랜치에 커밋이 올라와도 diff가 바뀌지 않는다

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
