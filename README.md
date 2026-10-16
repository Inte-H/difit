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

### 리뷰 흐름

1. **리뷰 열기**: `difit feature main`처럼 브랜치 이름으로 연다. 리뷰는 연 순간의 커밋에 머문다
2. **지적 남기기**: 사람이 줄마다 지적을 남긴다
3. **수정 받기**: 에이전트가 지적 하나에 fixup 커밋 하나로 고쳐 올리면, 그 수정이 지적 아래에 겹쳐 보인다
4. **승인하기**: 사람이 수정을 `승인`하거나 `거절`한다. 거절하면 에이전트가 다시 고친다
5. **합치기**: 브랜치를 마무리할 때 승인한 수정을 원래 커밋에 합친다. fixup 커밋은 기록에 남지 않는다

에이전트가 지적을 받아 고치고 합치는 절차는 [docs/agent-review.md](docs/agent-review.md)에 있다.

### 새 기능

- **수정 겹쳐 보기**: 에이전트가 올린 fixup을 지적이 달린 줄 아래에 카드로 보여 주고, 카드에서 `승인`, `거절`, `승인 취소`를 누른다. 위쪽 도구 막대의 `수정을 겹쳐 보기`로 켜고 끈다. `working`, `staged`, `.`, `--pr`, 표준 입력으로 연 리뷰에는 겹쳐 볼 것이 없어 원래 difit처럼 보인다
- **새 커밋 알림**: 리뷰 중인 브랜치에 fixup이 아닌 커밋이 새로 올라오면 도구 막대에 `다시 열기`가 뜬다
- **화면에서 직접 고치기**: 줄의 연필 버튼, 코드를 끌어 고르면 뜨는 막대의 `직접 고치기`(여러 줄), hunk 오른쪽 위의 `hunk 고치기`, 지적 카드의 `직접 고치기`로 코드를 고치고 `저장`하면 승인된 fixup 커밋이 바로 만들어진다. 잘못 고쳤으면 `되돌리기`를 누른다. 커밋에 머문 리뷰를 localhost에서 열었을 때만 켜지고, 커밋 훅은 돌지 않는다([이유](docs/adr/0003-reviewer-edits-become-fixups.md))
- **바뀌지 않은 코드 찾아보기**: 코드에서 이름을 누르고 `<이름> 찾기`를 누르면(Ctrl이나 Cmd를 누른 채 누르면 바로) 그 이름이 선언된 줄과 쓰인 줄, 그 파일 전체가 창으로 열린다. 창 안에서 다시 누르면 한 단계 더 들어가고 `←`로 돌아온다. 언어 서버 없이 찾으므로 이름이 같은 다른 선언도 나온다. `--pr`과 표준 입력으로 연 리뷰에서는 쓸 수 없다
- **주석이나 공백만 바뀐 곳 접기**: 코드는 그대로인 hunk를 `주석 N줄 바뀜 · 펼치기` 한 줄로 접고, 파일이나 fixup 전체가 그렇다면 `주석`이나 `공백` 배지를 붙인다. 도구 막대의 `주석 변경 접기`로 켜고 끈다. TS/TSX/JS, Python, Go, Rust, Java, CSS, Bash만 판정하고, `@ts-ignore`처럼 도구가 읽는 주석은 코드로 본다([판정 방법](docs/adr/0006-fold-changes-that-leave-code-alone.md))
- **에이전트 차례 알림**: `difit comment wait`는 에이전트가 고칠 지적이 생기면 끝나므로, 에이전트가 백그라운드로 띄워 두고 알림으로 쓴다. Claude Code 세션이 띄운 difit은 그 세션에 메시지로도 알린다
- **메시지 하나 복사**: 스레드의 메시지마다 그 메시지 하나를 복사하는 버튼이 있다
- **고른 코드에 지적 달기**: 코드 글자를 끌어 고르면(폰에서는 길게 눌러 고르면) `고른 부분에 지적 달기` 막대가 뜬다. 누르면 그 줄들에 지적 입력창이 열리고, 고른 글자가 인용으로 붙는다. 줄 번호를 끌면 그 줄 범위 전체에 지적을 단다

### 원래 difit과 다르게 동작하는 것

- Resolve를 눌러도 지적을 지우지 않고 `해결됨`으로 접어 둔다. 눌린 ✓를 다시 누르거나 답글을 달면 다시 열린다. 도구 막대의 `해결된 지적 보기`를 끄면 diff에서 감춘다([이유](docs/adr/0007-resolve-keeps-the-thread.md))
- 해결된 지적은 `Copy All`, 에이전트에게 넘기는 목록, 파일 목록의 댓글 수에서 빠진다
- 댓글 입력창에서 Enter를 누르면 보내고 Shift+Enter로 줄을 바꾼다. 한글을 조합하는 중에 누른 Enter로는 보내지 않는다
- 댓글 입력창에 `Add suggestion` 버튼이 없다
- 지적 카드의 복사 버튼은 `경로:L42` 같은 위치 줄 없이 지적 글만 복사한다. 제안 블록은 `ORIGINAL:`과 `SUGGESTED:`로 풀어 복사한다. 에이전트는 `difit comment get`으로 위치와 코드를 따로 받기 때문이다. `Copy All`은 원래 difit처럼 위치 줄을 붙인다
- 마우스가 있는 기기에서는 지적 버튼이 줄 번호 위에, 에디터에서 열기와 직접 고치기 버튼이 줄 오른쪽 끝에 있어 코드 첫머리를 가리지 않는다. 터치 기기에서는 줄 번호 위의 버튼 하나를 누르면 세 가지가 메뉴로 나온다
- 주석이나 공백만 바뀐 hunk는 처음부터 접혀 있다
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
