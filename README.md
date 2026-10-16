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
@src/components/Button.tsx#L42   # This line is automatically added
Make this variable name more descriptive
```

For range selections:

```sh
@src/components/Button.tsx#L42-48   # This line is automatically added
This section is unnecessary
```

The location line is a Claude Code file mention, so pasting the prompt into Claude Code attaches those lines. A mention attaches the file as it is on disk now, so it is written only while the file still matches the code under review. When the file has changed since, or an older commit is under review, the line names the commit instead, in the `commit:path` form that `git show abc1234:src/components/Button.tsx` reads. Deleted lines name the base commit.

```sh
abc1234:src/components/Button.tsx:L42-L48     # the file changed after the review, or an older commit is reviewed
9f8e7d6:src/components/Button.tsx:L42 (old)   # a deleted line
```

When there is no commit to name (a staged review with unstaged edits on top, a `difit .` or `difit working` review whose commented lines have since changed, deleted lines in `difit working`, a diff from stdin or `--pr`), the line keeps the plain form `src/components/Button.tsx:L42`. Paths containing spaces or `#` are never written as mentions.

## 🍴 이 포크가 더한 기능 (포크)

에이전트에게 지적을 남기고, 에이전트가 지적마다 고친 것을 받아 보는 리뷰에 맞춰 원래 difit에 다음을 더했다.

- 수정 겹쳐 보기: 에이전트가 지적마다 올린 수정을 그 줄 아래에 겹쳐 보고, 하나씩 승인하거나 거절한다.
- 화면에서 직접 고치기: 지적을 남기고 기다리는 대신 리뷰어가 코드를 바로 고친다.
- 바뀌지 않은 코드 찾아보기: 이름을 눌러 diff에 없는 선언과 쓰인 곳을 본다.
- 주석이나 공백만 바뀐 곳 접기: 코드는 그대로인 hunk를 한 줄로 접는다.
- 해결한 지적 남겨 두기: Resolve해도 지적이 지워지지 않고 접힌 채 남는다.
- Enter로 보내기: 댓글 입력창에서 Enter로 보내고 Shift+Enter로 줄을 바꾼다.

에이전트가 이 리뷰에 답하는 절차는 [docs/agent-review.md](docs/agent-review.md)에 있다.

### 수정 겹쳐 보기

에이전트가 지적에 답해 올린 fixup 커밋을 지적이 달린 줄 아래에 카드로 겹쳐 보여 준다. 카드에서 `승인`을 누른 수정은 브랜치를 마무리할 때 원래 커밋에 합쳐지고, `거절`을 누르면 에이전트가 다시 고친다. 위쪽 도구 막대의 `수정을 겹쳐 보기`로 켜고 끈다.

`difit`이나 `difit feature main`처럼 이름으로 열어도 리뷰는 연 순간의 커밋에 머물러, fixup이 올라와도 diff가 바뀌지 않는다. 그 브랜치에 fixup이 아닌 커밋이 새로 올라오면 도구 막대에 `다시 열기`가 뜬다. `working`, `staged`, `.`, `--pr`, 표준 입력으로 연 리뷰에는 겹쳐 볼 것이 없어 원래 difit처럼 보인다.

### 화면에서 직접 고치기

줄 번호 옆 연필 버튼(Shift를 누른 채 누르면 여러 줄), hunk 오른쪽 위의 `hunk 고치기`, 지적 카드의 `직접 고치기` 가운데 하나로 바뀐 쪽 코드를 고치고 `저장`을 누른다. 그러면 리뷰 대상 커밋에 합쳐질 fixup 커밋이 바로 만들어지고 승인한 것으로 남는다. 대상 커밋이 HEAD가 아니어도 되며, 잘못 고쳤으면 카드의 `되돌리기`를 누른다.

커밋에 고정된 리뷰를 localhost에서 열었을 때만 켜진다. 커밋 훅은 돌지 않으므로 포맷과 테스트는 브랜치를 마무리할 때 돌린다. 그 파일에 커밋하지 않은 변경이 있는 등 커밋할 수 없으면 까닭을 입력 칸 아래에 보여 준다. 이렇게 만든 까닭은 [docs/adr/0003](docs/adr/0003-reviewer-edits-become-fixups.md)에 있다.

### 바뀌지 않은 코드 찾아보기

코드에서 이름을 누르고 옆에 뜬 `<이름> 찾기`를 누르면(Ctrl이나 Cmd를 누른 채 누르면 바로) 그 이름이 선언된 줄과 쓰인 줄, 고른 줄이 든 파일 전체가 창으로 열린다. 창 안에서 다시 이름을 누르면 한 단계 더 들어가고, `←`로 돌아온다. 폰에서도 된다.

언어 서버 없이 이름이 나오는 줄을 찾으므로 이름이 같은 다른 선언도 후보로 나온다. `--pr`과 표준 입력으로 연 리뷰에서는 쓸 수 없다.

### 주석이나 공백만 바뀐 곳 접기

코드는 그대로 두고 주석이나 공백만 바꾼 hunk를 `주석 N줄 바뀜 · 펼치기` 한 줄로 접는다. 위쪽 도구 막대의 `주석 변경 접기`로 켜고 끄며, 처음에는 켜져 있다. 파일 전체나 지적에 답한 fixup이 주석이나 공백만 바꿨으면 `주석`이나 `공백` 배지가 붙는다.

TS/TSX/JS, Python, Go, Rust, Java, CSS, Bash 파일만 판정하고, 판정하지 못한 파일은 펼쳐 둔다. `@ts-ignore`처럼 도구가 읽는 주석은 코드로 본다. 판정 방법은 [docs/adr/0006](docs/adr/0006-fold-changes-that-leave-code-alone.md)에 있다.

### 해결한 지적 남겨 두기

원래 difit은 Resolve를 누르면 지적을 지우지만, 이 포크는 지우지 않고 `해결됨`으로 접어 둔다. 눌린 ✓를 다시 누르거나 답글을 달면 다시 열린다. 해결된 지적은 `Copy All`과 에이전트에게 넘기는 목록에서 빠지고, 도구 막대의 `해결된 지적 보기`를 끄면 diff에서도 감춘다.

메시지마다 그 메시지 하나를 위치와 함께 복사하는 버튼이 있다. 까닭은 [docs/adr/0007](docs/adr/0007-resolve-keeps-the-thread.md)에 있다.

### Enter로 보내기

새 댓글, 답글, 댓글 고치기 입력창에서 Enter를 누르면 보내고, Shift+Enter로 줄을 바꾼다. 한글을 조합하는 중에 누른 Enter로는 보내지 않는다.

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
