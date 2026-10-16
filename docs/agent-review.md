# 에이전트가 리뷰에 답하는 법

[README](../README.md)의 "이 포크에서 달라진 것"의 리뷰 흐름에서 에이전트가 지적을 받고, fixup 커밋으로 답하고, 승인된 수정을 접는 절차다.

## 지적 카드의 상태

| 상태         | 뜻                                          | 리뷰어가 할 일            |
| ------------ | ------------------------------------------- | ------------------------- |
| 수정 중      | 에이전트가 아직 답하지 않았다               | 기다린다                  |
| 승인 대기    | 수정이 도착해 줄 아래에 겹쳐 보인다         | `승인` 또는 `거절`        |
| 승인됨       | 승인했지만 아직 원래 커밋에 합쳐지지 않았다 | 잘못 눌렀으면 `승인 취소` |
| 접힘         | 승인한 수정이 원래 커밋에 합쳐졌다          | 없음                      |
| 다시 수정 중 | 거절해서 에이전트가 다시 고치고 있다        | 기다린다                  |
| 되돌림       | 리뷰어가 직접 고친 수정을 되돌렸다          | 없음                      |

## 답할 차례를 알림으로 받기

`difit comment wait`는 에이전트가 움직일 차례인 지적이 있으면 그 지적을 한 줄에 하나씩 JSON으로 찍고 끝난다. 없으면 생길 때까지 기다린다. 백그라운드로 띄워 두면 끝나는 순간이 곧 알림이다.

```sh
difit comment wait --port <port>
```

```json
{
  "threadId": "7wtlf3qyb0ie1m8c",
  "filePath": "math.js",
  "position": { "side": "new", "line": 6 },
  "message": "빼기로 고쳐 주세요.",
  "state": "rejected",
  "label": "다시 수정 중",
  "rejectedFixupSha": "afdba2e…"
}
```

- 알리는 경우는 셋이다. 리뷰어가 마지막으로 말한 `[수정 중]`, 새 fixup도 그 뒤의 답도 없는 `[다시 수정 중]`, 되돌린 fixup이 아직 남은 `[되돌림]`. `rejectedFixupSha`는 버려야 할 fixup이다. 고정할 커밋이 없는 리뷰에서는 리뷰어가 마지막으로 말한 지적을 모두 알린다.
- 띄우자마자 지금 차례인 지적을 모두 찍으므로, 두 번 띄우는 사이에 생긴 지적도 놓치지 않는다. 답한 뒤 다시 띄운다. 답하지 않은 지적은 다시 띄우자마자 또 나온다.
- 리뷰가 끝나면 아무것도 찍지 않고 0으로 끝난다. 연결이 끊기면 10초 동안 다시 붙고, 그래도 안 되면 오류를 찍고 1로 끝난다.

Claude Code 세션이 띄운 difit(`--background` 포함)은 세션의 메시지 소켓(`CLAUDE_CODE_MESSAGING_SOCKET`)을 물려받아, 리뷰어가 화면에서 저장해 새로 에이전트 차례가 된 지적을 그 세션에 메시지로 바로 넣는다. 첫 줄은 `difit review: your turn on <threadId> [<상태>]; read with difit comment get --port <port> --format json`이고, 이어지는 줄은 wait와 같은 JSON이다. 에이전트가 단 코멘트, 리뷰어가 직접 고친 fixup, 승인과 승인 취소는 보내지 않는다. 소켓에 닿지 못하면 stderr에 한 줄 남기고 리뷰를 이어 간다. 이 메시지 형식은 Claude Code 문서에 없어 형식이 바뀌면 조용히 사라질 수 있으므로 wait도 함께 띄워 둔다. 직접 띄운 difit에는 소켓이 없으므로 wait만 쓴다. 이유는 [docs/adr/0005](adr/0005-tell-the-agent-when-it-is-its-turn.md)에 있다.

## 지적에 답하기

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

4. 리뷰어가 직접 고친 fixup을 `되돌리기`로 거절했을 때도 같은 방법으로 버린다. 리뷰어가 직접 고치면서 연 스레드는 텍스트 출력에 `[되돌림]`이 붙는데, 이때는 fixup만 곧바로 버리고 다시 고치지 않는다. 버리기 전까지는 wait가 그 지적을 계속 알린다. 원래 있던 지적에 리뷰어가 직접 고쳐 답했다가 되돌렸으면 `[다시 수정 중]`이 붙으니, 여느 거절처럼 버리고 새로 고친다.

## 승인된 수정 접기와 기록 올리기

브랜치를 마무리할 때 한 번에 접는다. `--autosquash`는 범위 안의 fixup을 모두 접으므로, 남은 fixup이 전부 승인되고 거절된 fixup을 모두 버린 뒤에 돌린다.

승인 여부는 `difit comment get --port <port>` 텍스트 출력에서 지적마다 붙는 `[승인됨]`으로 확인한다. JSON의 `decisions`는 판정을 지우지 않고 쌓기만 한다. 리뷰어가 승인을 취소하면 `"kind": "unapproved"`가 더해지므로, 같은 지적의 `approved`와 `unapproved` 가운데 시각이 늦은 쪽이 지금의 판정이다. 다만 승인한 fixup에 그보다 늦은 `rejected`가 있으면 거절이 우선한다. 리뷰어가 직접 고친 수정을 `되돌리기`로 거절하면 이렇게 남는다.

```sh
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <리뷰 범위의 시작 커밋>
```

리뷰 범위의 시작 커밋은 diff의 비교 기준이다. 커밋 하나만 주고 연 리뷰라면 그 커밋의 부모(`<SHA>^`)이다. 커밋 여러 개를 한꺼번에 본 리뷰에서는 리뷰어가 직접 고친 fixup이 범위 중간의 커밋을 향할 수 있으므로, 리뷰 대상 커밋이 아니라 범위의 시작점부터 돌려야 모두 접힌다.

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

## 접은 뒤의 커밋으로 지적 옮기기

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
