# 페노피의 보드게임

판 위로 고개를 내민 낙서 **페노피**와 두는 보드게임 모음. 스케치북에 펜으로 그린 것 같은 화면에서, 페노피가 판 위를 알짱거리며
엔진이 실제로 계산한 형세를 보고 비꼬고, 가끔 잡학을 늘어놓는다.

- **LOA** (Lines of Action): 내 말을 전부 한 덩어리로 이으면 이긴다.
- **백개먼**: 주사위 굴려 먼저 다 빼면 이긴다. 더블링 큐브 포함.
- **브레이크스루**: 말은 앞으로만 간다. 하나라도 상대 끝 줄에 닿으면 이긴다.
- **국제 드래프트**: 10×10 체커. 잡기는 의무, 가장 많이 잡는 쪽으로. 킹은 멀리 날아다닌다.
- **체스**: 페노피의 원래 종목(튀르크는 체스 자동인형이었다). 지금은 로비 목록에서 잠시 빠져 있다.

페노피는 언제나 최강으로 둔다. 엔진은 각각 [LOA_turk](https://github.com/fishilyfishyfish/LOA_turk),
[backgammon-palamedes](https://github.com/fishilyfishyfish/backgammon-palamedes)의 것을 그대로 가져왔다.
브레이크스루, 국제 드래프트, 체스 엔진은 이 레포에서 새로 만들었다(`breakthrough/engine.js`, `draughts/engine.js`, `chess/engine.js`).

## 열기

GitHub Pages 주소로 연다. 한 번 열면 홈 화면에 앱처럼 추가할 수 있고, 그 뒤로는 인터넷이 없어도 열린다.

로컬에서는 WASM을 빌드한 뒤(`./tools/build-wasm.sh`) 아무 정적 서버로 연다(`python3 -m http.server`). 모듈 워커를 써서 파일을
직접 여는 `file://`로는 안 된다.

## 구조와 게임 추가

`CLAUDE.md` 참고. 게임 하나는 폴더 하나(`<id>/`)와 `games.js` 한 줄이다.

## 라이선스

- 손글씨 폰트 Gaegu: SIL Open Font License 1.1 (`shared/fonts/OFL.txt`).
