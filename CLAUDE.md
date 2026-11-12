# CLAUDE.md — 페노피 (Penopi)

보드게임 여러 개를 한 사이트에서 낙서 캐릭터 페노피와 두는 사이트. 모든 세션은 이 문서를 기준으로 작업한다.
설계를 바꾸면 이 문서도 같이 고친다.

## 원칙

- 디자인·캐릭터·대사 방식은 LOA 튀르크(fishilyfishyfish/LOA_turk)를 기준으로 한다. **페노피 = 튀르크, 이름만 다름.**
- 엔진은 각 게임의 원래 레포에서 가져온 것을 **고치지 않는다.** 이 레포에서는 워커로 감싸기만 한다.
  원래 레포(LOA_turk, amazons-hippolyta, backgammon-palamedes)는 건드리지 않는다.
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
loa/ amazons/ backgammon/   게임마다: index.html(얇음), game.js, worker.js, lines.js, game.css, thumb.svg
  loa/engine.js              LOA_turk engine.js 그대로 (fb07518)
  amazons/engine/            amazons-hippolyta engine/ 그대로 (1e742b6, tests/book.rs만 뺌: web/book.json을 읽어서)
  backgammon/engine/         backgammon-palamedes engine/ 그대로 (06492c2), backgammon/rust-toolchain.toml도
  */pkg/                     WASM 빌드 산출물(커밋 안 함)
tools/
  build-wasm.sh        두 엔진 WASM 빌드
  check-lines.py       화면에 나오는 한글이 전부 폰트 안에 있는지
  smoke.mjs            Chromium으로 로비 + 세 게임을 실제로 두어 봄(오류, 응답 시간)
  verify-engines.mjs   원래 레포 엔진과 같은 수·같은 평가가 나오는지
  assemble.py          배포할 _site 만들기 + precache.json
.github/workflows/pages.yml   엔진 테스트 → 대사 글자 검사 → WASM 빌드 → 스모크 → _site 배포
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
- 승률 p: LOA는 sigmoid(점수/300)(튀르크와 같음), 아마존은 MCTS 루트 값 (v+1)/2, 백개먼은 엔진이 고른 수의 결과 승률.
- 내 수 뒤(`humanMoved`): 게임 사건 → 1.5초 안에 두면 `fast`(30%) → 긴 판 `longGame`.
- 내 차례 15초 → 잡담(60%), 40초 → `slow` + 판 위 왕복. 1분 아무 일 없으면 졸기.
- 끝: 이기면 `engineWin`(게임이 `key`로 더 구체적인 줄을 먼저 시도: 개먼, 포기 등) + 폴짝, 3.5초 뒤 `engineWin2`/`streakBroken`.
  지면 `humanWin`(첫 패배면 `humanWinFirst`) + 가라앉기, 3.5초 뒤 `humanWin2`.
- 게임 전용 대사 수: LOA 42줄(튀르크에서 옮긴 잡기·두 덩어리·무승부·패스 등 + 새 줄), 아마존 36줄, 백개먼 65줄(잡담 제외).
  공통 잡담 14주제 + 게임 잡담(chatLoa, chatAmazons, chatBackgammon).
- 대사·규칙에 쓰는 한글은 Gaegu 서브셋(KS X 1001 2,350자) 안에서만. `python3 tools/check-lines.py`로 확인(CI도 함).
- 튀르크 대사 중 LOA 얘기(잇기, 덩어리, 커넥트메이트, LOA 잡학)는 `loa/lines.js`로 옮겼고, "1770년"(기계 튀르크)처럼 이름이 바뀌어
  어색해진 줄과 "5초"(생각 시간이 바뀜)는 고쳤다. 다시 보기 대사는 뺐다.

## 엔진 이식

| 게임 | 원래 | 워커 | 생각 시간 상한 |
|---|---|---|---|
| LOA | LOA_turk `engine.js`(순수 JS, 알파베타) | classic worker, `importScripts('engine.js')`. 페이지에도 엔진을 하나 더 올려 규칙(합법수, 종국) 판단 | 2.5초(튀르크는 5초), 반복 심화라 끊겨도 수가 나옴. 내 차례엔 0.7초씩 미리 생각(튀르크와 같음). 6.5초 넘으면 워커를 죽이고 페이지에서 0.6초 |
| 아마존 | amazons-hippolyta Rust → WASM, MCTS | module worker, 요청마다 수순 전체를 보내는 무상태 방식. 워커 여러 개(남는 코어, 최대 4)로 루트 병렬 탐색 후 통계 합침(원래 페이지 `combineInfos` 그대로) | 2초(원래 5단계와 같음). 탐색 루프가 JS에서 시간 확인 |
| 백개먼 | backgammon-palamedes Rust → WASM(신경망 포함) | module worker, 원래 `engine-worker.js`처럼 함수 이름 + 인자 RPC | 팔라메데스 봇(3수 탐색, WASM 평균 0.4초). 4초 넘으면 워커를 죽이고 2수(`rank_moves_json` 1위)로 |

- 백개먼은 머니 게임 + 더블링 큐브(매치 없음). 페노피의 큐브 판단은 원래 사이트의 팔라메데스 봇(`ai_cube_json`). 개먼 2배, 백개먼 3배, × 큐브.
  나는 항상 엔진 진영 0(아래, 홈은 오른쪽). 색은 보이는 모양뿐(원래 사이트와 같은 방식). 입력은 원래 사이트의 "바로 이동".
- 아마존: 한 수 = 이동 + 화살. 상태 줄과 판 아래 ①이동 ②화살 표시, 화살 단계에서는 옮긴 아마존을 도착 칸에 미리 그리고 떠난 칸은 점선.
  옮긴 아마존을 다시 누르거나 "이동 다시"로 1단계, "취소"/Esc로 선택 해제. 화살 단계에서 엉뚱한 칸을 눌러도 선택이 풀리지 않는다
  (다른 내 아마존을 누르면 그 아마존으로 다시 시작).
- 검증(`tools/verify-engines.mjs`, 2026-11-12): 원래 레포를 그 레포 방식대로 빌드한 WASM은 이 레포 빌드와 **바이트 단위로 같다.**
  무작위 대국 국면에서 LOA 깊이 5 탐색 6국면, 아마존 시드 고정 MCTS 1500회 6국면(후보 수·방문 수·값), 백개먼 6국면
  (팔라메데스 수, 2수 상위 3개 에퀴티, 큐브 판단)이 모두 같았다.

## 디자인 결정

- 페르치(`.perch`)·말풍선·버튼·규칙 시트 CSS는 LOA_turk index.html 그대로 `shared/paper.css`로 옮겼다. 판 CSS는 게임별 `game.css`.
- LOA 판 연출(연필 궤적, 지우개로 지우고 다시 그리기, 잡힌 말 낙서, 이긴 덩어리 빨간 고리)은 LOA_turk 그대로. 공용 부분은 `shared/sketch.js`.
- 아마존: 같은 손그림 격자 10×10, 아마존은 작은 왕관, 화살 칸은 촘촘한 교차 빗금 덩어리. 이동 가능 칸은 빨간 점, 화살 칸은 빨간 ×.
  사람이 흑이면 판을 뒤집어 내 쪽이 아래(원래 사이트와 같음).
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
