// Chess lines, added to shared/lines.js. Penopi is Turk under another name, and the Turk was a chess automaton,
// so here it boasts of 1770 again (the lines LOA 튀르크 had and the other games dropped). Penopi is also still
// "practising" chess (no record kept, game.practice), and says so.
// When: chess/game.js. {pc}: a piece's name.
export const LINES = {
  // Penopi is still "practising" chess (the user's concept): no record is kept, and it says so
  $replace: ['pick', 'startHuman', 'startEngine'],
  practiceHello: [
    "체스는 아직 연습 중이야. 그러니까 여기선 전적 안 적어. 너도 마음 편히 둬.",
    "연습 판이야. 이겨도 져도 기록엔 안 남아. 나한테 좋은 일이지.",
    "1770년부터 뒀는데 아직 연습 중이야. 체스가 원래 그래.",
  ],
  pick: [
    "백 할래, 흑 할래? 연습 판이니까 아무거나.",
    "골라. 지금은 연습이라 져도 안 적어. 나도, 너도.",
  ],
  startHuman: [
    "백이니까 먼저 둬. 나는 연습하는 중이니까 살살... 은 안 해.",
    "먼저 가. 오프닝 공부 좀 했거든. 확인해 봐.",
  ],
  startEngine: [
    "내가 먼저 둔다. 요즘 연습하는 오프닝이 있어.",
    "백은 내가. 연습한 거 보여 줄게.",
  ],
  humanWin: [
    "...연습 판이라 다행이다. 안 적는 거 맞지?",
    "이건 연습이었어. 진짜 판은 다음에.",
  ],
  engineCheck: [
    "체크.",
    "체크. 킹 어디로 피할래?",
    "킹 조심해. 체크야.",
    "체크. 이 소리 자주 듣게 될 거야.",
  ],
  humanCheck: [
    "체크? 어, 알아. 보고 있었어.",
    "체크라고 소리 안 질러도 다 들려.",
    "그 정도로는 안 잡혀.",
  ],
  // engineCap / humanCap: only when the capture wins material (not in an even exchange; chess/game.js)
  engineCap: [
    "{pc} 가져간다.",
    "냠. {pc} 하나.",
    "그 {pc}, 아무도 안 지키던데.",
    "공짜 {pc} 고마워.",
  ],
  // queens traded off (an even exchange: no gloating, no sulking)
  queenTrade: ["퀸끼리 바꿨네. 이제 조용해지겠다.", "퀸 교환. 연습하기엔 이 편이 나아.", "퀸 없는 체스도 좋아해."],
  engineTakesQueen: ["퀸 가져간다. 이제 좀 쉬워지겠네.", "퀸이 사라졌네. 어디 갔을까."],
  humanCap: [
    "{pc} 줬어. 일부러야. 아마도.",
    "잡아 가. 그다음 수가 더 무서울걸.",
    "{pc} 하나쯤이야.",
  ],
  humanTakesQueen: ["...내 퀸. 계산에 있던 거야. 있었어.", "퀸을 잡았다고 이긴 건 아니야."],
  engineCastle: ["캐슬링. 킹은 안전한 데로.", "성 안으로 들어간다."],
  humanCastle: ["캐슬링 했네. 성벽은 내가 부숴 줄게.", "킹 숨겼구나. 다 보여."],
  enginePromote: ["폰이 끝까지 왔다. 퀸 하나 더.", "승진. 폰도 열심히 하면 퀸 돼."],
  humanPromote: ["승진했네. 축하는 안 해.", "새 퀸? 오래 못 갈걸."],
  engineWinMate: [
    "체크메이트. {n}수 걸렸네.",
    "메이트. 킹 갈 데가 없지?",
    "체크메이트. 1770년에도 이렇게 이겼어.",
  ],
  humanWinMate: [
    "...체크메이트. 안에 사람 있는 거 아니야? 나 말고 너 말이야.",
    "메이트당했네. 나폴레옹한테도 안 진 내가.",
  ],
  drawStalemate: ["스테일메이트. 이긴 판을 비기다니. 아, 너 말고 나 얘기야.", "둘 데가 없는데 체크는 아니야. 비겼어."],
  drawRepetition: ["같은 자리 세 번째. 비긴 걸로 하자.", "왔다 갔다만 하네. 무승부."],
  drawFifty: ["50수 동안 아무 일도 없었어. 무승부.", "잡지도 않고 폰도 안 움직이고. 비겼어."],
  drawMaterial: ["둘 다 메이트할 말이 없네. 무승부.", "이걸로는 아무도 못 이겨. 비겼어."],
  peek: [
    "그거 움직이면 뒤가 빈다.",
    "그 말 지키는 애 있어?",
  ],
  chatChess: [
    "원조 튀르크는 1770년에 볼프강 폰 켐펠렌이 마리아 테레지아한테 보이려고 만들었어.",
    "튀르크 안에는 사실 사람이 숨어서 뒀어. 나는 진짜로 혼자야.",
    "튀르크는 1809년에 나폴레옹이랑 뒀다는 얘기가 있어. 나폴레옹이 졌지.",
    "체스 첫 수로 둘 수 있는 수는 20가지, 두 수씩 두면 400가지야.",
    "캐슬링은 한 수에 말 두 개가 움직이는 유일한 수야.",
    "앙파상은 15세기쯤 폰이 두 칸 갈 수 있게 되면서 같이 생긴 규칙이야.",
  ],
};
