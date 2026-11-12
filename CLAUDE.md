# CLAUDE.md — 페노피 (Penopi)

보드게임 여러 개를 한 사이트에서 낙서 캐릭터 페노피와 두는 사이트. 모든 세션은 이 문서를 기준으로 작업한다.
설계를 바꾸면 이 문서도 같이 고친다.

## 원칙

- 디자인·캐릭터·대사 방식은 LOA 튀르크(fishilyfishyfish/LOA_turk)를 기준으로 한다. **페노피 = 튀르크, 이름만 다름.**
- 엔진은 각 게임의 원래 레포에서 가져온 것을 **고치지 않는다.** 이 레포에서는 워커로 감싸기만 한다.
  원래 레포(LOA_turk, amazons-hippolyta, backgammon-palamedes)는 건드리지 않는다.
  예외: 브레이크스루와 국제 드래프트는 원래 레포가 없어서 엔진을 이 레포(`breakthrough/engine.js`, `draughts/engine.js`)에서
  새로 만들었다(사용자 요청). 이 둘은 고쳐도 된다.
- 사이트는 빌드 도구 없이 바닐라 JS + ES 모듈. WASM만 빌드한다(CI가 함).
- 대국 화면에는 판, 선후공(또는 색) 고르기, 오른쪽 위 "규칙" 버튼만 둔다. 게임 진행에 꼭 필요한 버튼(아마존 취소, 백개먼
  굴리기·더블·턴 끝내기)은 판 아래 한 줄(`#tray`)에만 둔다. 다른 게임으로 가는 길은 규칙 시트 맨 아래 "다른 게임".
- 다시 보기는 넣지 않는다(사용자 결정). 다크 모드는 아직 없다(사용자 결정). 오프라인은 유지.
- 난이도는 게임마다 최강 하나(튀르크와 같음). 약한 상대(아마존 1–4단계, 백개먼 레이팅 봇)는 엔진에 남아 있지만 화면에는 없다.
- main에 바로 커밋·푸시한다(사용자 지시).

## 구조

```
index.html, lobby.js   로비: games.js의 카드 목록 + 페노피(사회자), 게임별 전적
games.js               게임 목록. 게임 하나 = 한 줄
sw.js                  오프라인(네트워크 우선, 받은 파일 보관, 배포본은 precache.json 전부 미리 받음)
manifest.webmanifest, icons/   홈 화면 앱 (아이콘은 LOA_turk 것 그대로)
shared/
  paper.css            종이·펜 디자인 전체(폰트, 색, 버튼 그림자, 말풍선, 페르치, 규칙 시트)
  fonts/               Gaegu 서브셋(라틴 + 한글 2,350자) + OFL.txt  ← LOA_turk에서 그대로
  character.js         페노피 SVG와 동작(걷기, 생각 점, 졸기, 찌르기, 숨기, 폴짝, 가라앉기)
  talk.js              대사 고르기(최근 4줄 회피, 자리표시자), 게임 대사 합치기
  lines.js             공통 대사(튀르크 대사에서 출발) + 로비 대사
  shell.js             대국 화면 골격과 "언제 무슨 말을 하나". 게임 인터페이스 설명은 이 파일 맨 위
  engine.js            워커 래퍼(id 요청/응답, 시간 초과 시 워커 종료·재시작)
  record.js            게임별 전적(localStorage `penopi.<id>.record`), 마지막 방문
  sketch.js            손그림 격자, 연필 궤적, 지우개, 말 뛰기
  offline.js           서비스 워커 등록
loa/ amazons/ backgammon/ breakthrough/ draughts/   게임마다: index.html(얇음), game.js, worker.js, lines.js, game.css, thumb.svg
  loa/engine.js              LOA_turk engine.js 그대로 (fb07518)
  amazons/engine/            amazons-hippolyta engine/ 그대로 (1e742b6, tests/book.rs만 뺌: web/book.json을 읽어서)
  backgammon/engine/         backgammon-palamedes engine/ 그대로 (06492c2), backgammon/rust-toolchain.toml도
  breakthrough/engine.js     이 레포에서 새로 만든 엔진(순수 JS, 알파베타). 아래 "브레이크스루 엔진"
  draughts/engine.js         이 레포에서 새로 만든 엔진(순수 JS, 알파베타). 아래 "국제 드래프트 엔진"
  */pkg/                     WASM 빌드 산출물(커밋 안 함)
tools/
  build-wasm.sh        두 엔진 WASM 빌드
  check-lines.py       화면에 나오는 한글이 전부 폰트 안에 있는지
  smoke.mjs            Chromium으로 로비 + 세 게임을 실제로 두어 봄(오류, 응답 시간)
  verify-engines.mjs   원래 레포 엔진과 같은 수·같은 평가가 나오는지
  test-breakthrough.mjs  브레이크스루 엔진 테스트(CI): 단순 구현과 수 생성 비교, 강제승 탐색 vs 단순 탐색기, 무작위·탐욕 상대 전승
  arena-breakthrough.mjs 브레이크스루 엔진끼리 자동 대국(평가 가중치 튜닝용)
  test-draughts.mjs    국제 드래프트 엔진 테스트(CI): 공개된 perft 값, 단순 구현과 수 생성 비교, 잡기 규칙 손 국면, 무작위 상대 전승
  arena-draughts.mjs   국제 드래프트 엔진끼리 자동 대국
  bubble-test.html     수에 대한 대사가 제때 지워지는지(스모크 테스트가 돌림)
  assemble.py          배포할 _site 만들기 + precache.json
.github/workflows/pages.yml   엔진 테스트 → 대사 글자 검사 → WASM 빌드 → 브레이크스루·드래프트 테스트 → 스모크 → _site 배포
```

## 게임 추가하기

1. 폴더 하나: `<id>/index.html`(loa/index.html을 복사해 제목만 바꿈), `game.js`, `worker.js`, `lines.js`, `game.css`, `thumb.svg`.
2. `games.js`에 한 줄: `{ id, name, blurb, pitch }`.

`game.js`는 `shared/shell.js` 맨 위에 적힌 객체를 export default 한다:
`id, name, sides[{id, html, first}], lines, chat, rules{html, note}, longGame, mount(api), start(side), reset()`.
게임은 자기 흐름을 돌리면서 `api.yourTurn / api.engineTurn / api.humanMoved / api.engineMoved / api.over`를 부르면 된다.
대사·전적·규칙 시트·찌르기·졸기·재촉은 shell이 한다. 워커는 `shared/engine.js`의 프로토콜
(`{id, ...}` → `{id, result}` | `{id, error}`)만 지키면 된다. 그 밖에 스모크 테스트에 게임을 추가한다(`tools/smoke.mjs`).

## 대사

- 공통 목록(`shared/lines.js`) + 게임 목록(`<id>/lines.js`)을 같은 이름끼리 합친다. 게임이 `$replace: [...]`에 적은 목록은 바꿔치기.
- 엔진 평가에 반응(shell `engineMoved`): 페노피 승률 p와 직전 값의 차이(swing)로 판정.
  - 강제승(남은 수 n) → `mate`/`mateCount`, 진 것이 증명 → `doomed`(+ 숨기).
  - 내 수로 p +15%p 이상이고 p > 60% → `blunder`(내 실수), −20%p 이하 → `selfBlunder`(페노피 실수), −10%p 이하 → `goodMove`.
  - 게임이 `verdict`를 주면 swing 대신 그것을 쓴다(백개먼: 주사위 운 때문에 승률 변화로는 실수를 못 가려서 엔진 2수 분석의 손실 ≥ 0.08로 판정).
  - 그다음 게임 사건(`facts`), p > 85% 처음 → `winning`, p < 20% 처음 → `losing`, 그 외 가끔 `normal`/`normalNodes`/잡담.
- 승률 p: LOA는 sigmoid(점수/300)(튀르크와 같음), 아마존은 MCTS 루트 값 (v+1)/2, 백개먼은 엔진이 고른 수의 결과 승률,
  브레이크스루·국제 드래프트는 sigmoid(점수/200)(말 하나 = 100).
- 내 수 뒤(`humanMoved`): 게임 사건 → 1.5초 안에 두면 `fast`(30%) → 긴 판 `longGame`.
- **수에 대한 대사는 다음다음 차례가 시작되면 지운다**(사용자 요청). 내 수에 대한 말은 내 다음 차례가 시작될 때, 페노피 수에 대한 말은
  페노피의 다음 차례가 시작될 때 말풍선을 비운다. 그 사이에 새 말을 안 했으면 지난 수 얘기("못 들어오네")가 새 차례 얘기처럼 읽히기 때문.
  `humanMoved`/`engineMoved`에서 하는 말과 게임이 `api.say`로 하는 말이 여기 해당하고, 잡담·재촉·찌르기·시작 인사는 다른 말이
  나올 때까지 그대로 둔다. 차례 경계는 `api.yourTurn`/`api.engineTurn`(같은 쪽이 연달아 부르면 한 번으로 침). 그래서 게임은 차례가
  실제로 바뀔 때만 이 둘을 부른다(백개먼에서 내가 더블할 때 페노피가 받을지 고민하는 건 `engineTurn`이 아니라 `api.thinking`).
  `tools/bubble-test.html`(스모크 테스트가 돌림)로 확인.
- 내 차례 15초 → 잡담(60%), 40초 → `slow` + 판 위 왕복. 1분 아무 일 없으면 졸기.
- 끝: 이기면 `engineWin`(게임이 `key`로 더 구체적인 줄을 먼저 시도: 개먼, 포기 등) + 폴짝, 3.5초 뒤 `engineWin2`/`streakBroken`.
  지면 `humanWin`(첫 패배면 `humanWinFirst`) + 가라앉기, 3.5초 뒤 `humanWin2`.
- 게임 전용 대사 수: LOA 42줄(튀르크에서 옮긴 잡기·두 덩어리·무승부·패스 등 + 새 줄), 아마존 36줄, 백개먼 65줄, 브레이크스루 33줄, 국제 드래프트 38줄(잡담 제외).
  공통 잡담 14주제 + 게임 잡담(chatLoa, chatAmazons, chatBackgammon, chatBreakthrough, chatDraughts).
- 대사·규칙에 쓰는 한글은 Gaegu 서브셋(KS X 1001 2,350자) 안에서만. `python3 tools/check-lines.py`로 확인(CI도 함).
- 튀르크 대사 중 LOA 얘기(잇기, 덩어리, 커넥트메이트, LOA 잡학)는 `loa/lines.js`로 옮겼고, "1770년"(기계 튀르크)처럼 이름이 바뀌어
  어색해진 줄과 "5초"(생각 시간이 바뀜)는 고쳤다. 다시 보기 대사는 뺐다.

## 엔진 이식

| 게임 | 원래 | 워커 | 생각 시간 상한 |
|---|---|---|---|
| LOA | LOA_turk `engine.js`(순수 JS, 알파베타) | classic worker, `importScripts('engine.js')`. 페이지에도 엔진을 하나 더 올려 규칙(합법수, 종국) 판단 | 2.5초(튀르크는 5초), 반복 심화라 끊겨도 수가 나옴. 내 차례엔 0.7초씩 미리 생각(튀르크와 같음). 6.5초 넘으면 워커를 죽이고 페이지에서 0.6초 |
| 아마존 | amazons-hippolyta Rust → WASM, MCTS | module worker, 요청마다 수순 전체를 보내는 무상태 방식. 워커 여러 개(남는 코어, 최대 4)로 루트 병렬 탐색 후 통계 합침(원래 페이지 `combineInfos` 그대로) | 2초(원래 5단계와 같음). 탐색 루프가 JS에서 시간 확인 |
| 브레이크스루 | 이 레포에서 새로 만듦(`breakthrough/engine.js`, 순수 JS) | LOA와 같은 방식: classic worker + 페이지에도 엔진 하나(규칙 판단) | 2.5초, 반복 심화. 6.5초 넘으면 워커를 죽이고 페이지에서 0.6초. 미리 생각(ponder)은 안 함 |
| 국제 드래프트 | 이 레포에서 새로 만듦(`draughts/engine.js`, 순수 JS) | 브레이크스루와 같은 방식 | 2.5초, 반복 심화. ponder 없음 |
| 백개먼 | backgammon-palamedes Rust → WASM(신경망 포함) | module worker, 원래 `engine-worker.js`처럼 함수 이름 + 인자 RPC | 팔라메데스 봇(3수 탐색, WASM 평균 0.4초). 4초 넘으면 워커를 죽이고 2수(`rank_moves_json` 1위)로 |

- 백개먼은 머니 게임 + 더블링 큐브(매치 없음). 페노피의 큐브 판단은 원래 사이트의 팔라메데스 봇(`ai_cube_json`). 개먼 2배, 백개먼 3배, × 큐브.
  나는 항상 엔진 진영 0(아래, 홈은 오른쪽). 색은 보이는 모양뿐(원래 사이트와 같은 방식). 입력은 원래 사이트의 "바로 이동".
- 아마존: 한 수 = 이동 + 화살. 상태 줄과 판 아래 ①이동 ②화살 표시, 화살 단계에서는 옮긴 아마존을 도착 칸에 미리 그리고 떠난 칸은 점선.
  옮긴 아마존을 다시 누르거나 "이동 다시"로 1단계, "취소"/Esc로 선택 해제. 화살 단계에서 엉뚱한 칸을 눌러도 선택이 풀리지 않는다
  (다른 내 아마존을 누르면 그 아마존으로 다시 시작).
- 검증(`tools/verify-engines.mjs`, 2026-11-12): 원래 레포를 그 레포 방식대로 빌드한 WASM은 이 레포 빌드와 **바이트 단위로 같다.**
  무작위 대국 국면에서 LOA 깊이 5 탐색 6국면, 아마존 시드 고정 MCTS 1500회 6국면(후보 수·방문 수·값), 백개먼 6국면
  (팔라메데스 수, 2수 상위 3개 에퀴티, 큐브 판단)이 모두 같았다.

## 브레이크스루 엔진 (2026-11-12, 사용자 요청으로 새로 만듦)

- 규칙: 8×8, 각자 16개를 자기 쪽 두 줄에, 백 선. 앞으로 한 칸(빈칸) 또는 앞 대각선(빈칸이나 상대 말, 상대 말이면 잡음).
  상대 끝 줄에 닿거나 상대 말을 다 잡으면 승. 둘 수가 없으면 패(거의 없음). 무승부 없음.
- 표현: `Int8Array(64)`, 칸 = 행×8+열, 행 0 = 1랭크(백의 집). 수 = from | to<<6 | 잡기 4096 (LOA와 같은 꼴).
- 탐색: 네가맥스 알파베타(PVS), 반복 심화, 치환표(32비트 조브리스트 키 둘), 킬러·히스토리 정렬, 늦은 수 감축(LMR),
  잡는 수만 보는 정지 탐색. 모든 노드에서 이 게임의 강제 사실 두 개를 먼저 본다:
  (1) 둘 차례 쪽 말이 끝 줄 한 칸 앞에 있으면 다음 수에 반드시 이긴다(그 말은 언제나 끝 줄로 갈 수가 있다: 정면이 막혀도
  대각선은 비었거나 잡을 수 있는 상대 말).
  (2) 상대 말이 그 자리에 있으면 이번 수에 그 말을 잡아야 하고(잡는 수만 남김), 둘 이상이면 진다.
- 평가(둘 차례 기준): 말 100 + 전진 보너스(집에서 0, 1, 2, … 칸: 0, 2, 5, 10, 18, 32, 55) + 집 줄 수비수(b·c·f·g 12, 나머지 4)
  + 빈 세로줄 −3 + 상대 차례가 아닌 쪽의 공격받는 말 감점 + 차례 8.
- 튜닝(`tools/arena-breakthrough.mjs`, 5만 노드, 무작위 2수 개막 10–12쌍): 처음 넣은 "뒤에서 받치는 말" 보너스(4)는
  끄고 두면 19/20으로 이겨서 0으로 둠(+512). 공격받는 말 감점을 끄면 6/24(−191)라 남김. 집 줄 수비 24는 +58(유의하지 않음),
  감점 40은 차이 없음. 20만 노드 vs 2만 노드 17/20(+301).
- 테스트(`tools/test-breakthrough.mjs`, CI): perft(1..3) = 22, 484, 11,132(단순 구현과 일치), 무작위 30판 2,074국면의
  수 집합·승패 판정 일치, 무작위 종반 150개에서 단순 탐색기(5수)가 찾은 강제승·강제패를 엔진(깊이 7)도 모두 찾음,
  무작위·탐욕 상대 12전 전승. 시작 국면 1초에 깊이 9–10, 약 95만 노드(네이티브 node).

## 국제 드래프트 엔진 (2026-11-12, 사용자 요청으로 새로 만듦)

- 규칙(FMJD): 10×10의 어두운 칸 50개, 각자 말 20개, 백 선. 말은 대각선 앞 한 칸, 잡기는 앞뒤 모두. 킹은 대각선으로 멀리 날고,
  멀리 있는 말도 넘어 그 너머 아무 빈칸에 내린다. 잡기는 의무이고 가장 많이 잡는 수만 합법(말·킹 같은 1개).
  잡힌 말은 수가 끝난 뒤 치운다(그동안 길을 막고, 두 번 넘을 수 없음). 끝 줄에서 수를 마쳐야 킹(지나가기만 하면 안 됨).
  둘 수 없으면 패. 무승부: 같은 국면·같은 차례 3회, 잡기 없이 킹만 25수씩, 킹 하나 남은 쪽을 상대가 3개(킹 포함)로 16수,
  2개 이하로 5수 안에 못 이기면.
- 표현: 10×10 전체 칸 `Int8Array(100)`(r*10+c, 0행 = 흑 쪽 위), 화면 표기는 표준 번호 1–50. 수는 객체
  `{from, to, path(내리는 칸들), caps(잡은 칸, 정렬), promote}`. 같은 from·to·잡은 말 집합은 한 수로 친다.
- 탐색: 네가맥스 알파베타(PVS), 반복 심화, 치환표, 킬러·히스토리, LMR. 잡기가 걸린 국면에서는 깊이가 다 돼도 멈추지 않고(잡기
  교환 끝까지), 둘 수가 하나뿐이면 깊이를 깎지 않는다. 정지 탐색은 잡기만. 수순 안의 반복은 무승부로 본다.
- 평가: 말 100, 킹 320, 전진 한 줄당 3, 가운데(3–6행 × 2–7열) 4, 맨 뒷줄 수비 6, 차례 6. 킹 하나 남은 쪽 vs 3개 이하는 0(무승부 규칙).
  튜닝(`tools/arena-draughts.mjs`, 2만 노드, 8쌍): 킹 250/400, 가운데 0, 전진 6 모두 ±24% 안이라 그대로. 10만 노드 vs 2만 노드 13/16(+255).
- 테스트(`tools/test-draughts.mjs`, CI): perft(1..6) = 9, 81, 658, 4265, 27117, 167140(공개 값과 일치), 무작위 40판 3,702국면
  수 집합 일치(단순 구현은 잡힌 말을 판에 남긴 채 따로 짬), 손으로 만든 국면(다수 잡기, 킹 원거리 잡기, 끝 줄 지나가기만 하면 킹 안 됨,
  말의 뒤로 잡기, 2킹 vs 1킹 무승부), 무작위 상대 4전 전승. 시작 국면 1초에 깊이 8, 약 19만 노드(네이티브 node).
- 화면: 말을 누르고 끝 칸(빨간 점)을 누른다. 잡아야 하면 상태 줄에 "잡아야 해", 잡을 수 있는 말에 빨간 점선. 말을 고르면 잡힐 말에
  점선 동그라미. 다른 길로 같은 칸에 가는 잡기가 여럿이면 그 칸을 눌렀을 때 "거쳐 갈 칸을 눌러"라고 하고 다음 내릴 칸(작은 원)을 보여 준다.
  사람이 흑이면 판을 180° 돌린다.

## 디자인 결정

- 페르치(`.perch`)·말풍선·버튼·규칙 시트 CSS는 LOA_turk index.html 그대로 `shared/paper.css`로 옮겼다. 판 CSS는 게임별 `game.css`.
- LOA 판 연출(연필 궤적, 지우개로 지우고 다시 그리기, 잡힌 말 낙서, 이긴 덩어리 빨간 고리)은 LOA_turk 그대로. 공용 부분은 `shared/sketch.js`.
- 아마존: 같은 손그림 격자 10×10, 아마존은 작은 왕관, 화살 칸은 촘촘한 교차 빗금 덩어리. 이동 가능 칸은 빨간 점, 화살 칸은 빨간 ×.
  사람이 흑이면 판을 뒤집어 내 쪽이 아래(원래 사이트와 같음).
- 브레이크스루: LOA와 같은 손그림 8×8. 말은 가는 방향으로 뾰족한 물방울(내 말은 위, 페노피 말은 아래로). 사람이 흑이면 판을 뒤집어 내 쪽이 아래.
- 말을 기울이거나 뒤집을 때는 SVG 안(`transform` 속성)에서 한다. 말 요소에 CSS `rotate`를 주면 뛰는 애니메이션의 `transform`이 그 회전 안에서
  적용돼 방향이 틀어진다(페노피 말을 180° 돌렸더니 판 밖으로 뛰었음).
- 백개먼: SVG 한 장(원래 `board-view.js`의 좌표 그대로). 포인트는 펜 삼각형, 하나 걸러 빗금. 체커는 LOA 말처럼 칠한 원.
  매번 다시 그려도 떨리지 않게 손떨림은 칸 번호로 정한 고정값.
- 로비 전적: 게임별 전적을 카드에 표시. LOA는 같은 사이트(fishilyfishyfish.github.io)의 LOA 튀르크 전적(`turk-record`)이 있으면 한 번 가져온다.
- `window.__penopi.debug()`는 스모크 테스트용 읽기 전용 핸들.

## 자주 쓰는 명령

```sh
./tools/build-wasm.sh                          # rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version 0.2.129 --locked
python3 -m http.server                         # 로컬 확인 (module worker라 file:// 불가)
(cd amazons/engine && cargo test)              # 엔진 테스트
(cd backgammon/engine && cargo test --release)
python3 tools/check-lines.py                   # pip install fonttools brotli
node tools/smoke.mjs 20 /tmp/shots             # playwright 필요
node tools/verify-engines.mjs ../LOA_turk <amazons 원본 pkg> <backgammon 원본 pkg>
python3 tools/assemble.py _site                # 배포본 미리 보기
```

## 배포

- main 푸시 → `.github/workflows/pages.yml` → GitHub Pages. 레포 설정 Pages 소스가 "GitHub Actions"여야 한다(처음 한 번 수동).

## 라이선스

- 폰트: Gaegu, SIL Open Font License 1.1 (`shared/fonts/OFL.txt`). LOA_turk에서 쓰던 서브셋 그대로.
- 아이콘·썸네일·캐릭터: 직접 그린 SVG(LOA_turk 아이콘 포함). 아이콘 폰트나 외부 그림은 쓰지 않는다.
- 규칙 설명은 전부 직접 쓴 문장. 아마존 규칙 시트에 상표 문구: "El Juego de las Amazonas는 Ediciones de Mente의 상표입니다."
- 엔진: 원래 레포와 같은 조건(amazons-engine·palamedes Cargo.toml은 MIT).

## 성능 기록 (2026-11-12, 이 컨테이너, Chromium headless, `tools/smoke.mjs`)

| 게임 | 페노피 응답 최장 | 비고 |
|---|---|---|
| LOA | 2.8초 | 2.5초 생각 + 연출 |
| 아마존 | 2.1초 | 2초 × 워커 3개 병렬 |
| 백개먼 | 따로 재지 않음 | 3수 탐색은 원래 레포 기록으로 WASM 평균 0.4초·최대 1.4초, 여기에 말 옮기는 연출 |

WASM 크기: 아마존 233 KB, 백개먼 542 KB. 배포본 전체 약 1.8 MB(폰트 0.77 MB 포함).
