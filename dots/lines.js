// Dots and Boxes lines, added to shared/lines.js. All new. Penopi knows the long chain trick and enjoys it.
// When: dots/game.js, once per turn (a turn can be several lines). {n}: boxes this turn, {a}/{b}: my / Penopi's boxes.
export const LINES = {
  pick: ["판 크기 고르고, 먼저 할지 골라. 상자는 내가 다 칠할 거지만.", "선공이든 후공이든. 점과 상자는 끝에 가서 뒤집히는 게임이야."],
  startHuman: ["먼저 그어. 처음엔 아무 데나 그어도 돼. 처음엔.", "네가 먼저. 세 변짜리 상자만 안 만들면 돼. 지금은."],
  startEngine: ["내가 먼저 긋는다. 한 줄.", "선공은 나. 안전한 선이 다 떨어질 때까지 천천히 가자."],
  // a turn that claimed boxes
  engineClaim: ["상자 {n}개 칠했다.", "이건 내 거. 빨간 펜으로."],
  engineChain: ["줄줄이 {n}개. 한 번 열리면 끝까지 가.", "{n}개 연달아. 펜이 바쁘다.", "하나, 둘, 셋... {n}개. 다 내 색이야."],
  humanClaim: ["{n}개 가져갔네.", "그 상자는 줄게.", "연필로 칠해 놨네. 지워지진 않겠지."],
  humanChain: ["{n}개나... 그 줄 열어 준 거 내 실수였다.", "줄줄이 가져가네. 기억해 둘게.", "{n}개. 오늘은 네가 펜 잡았네."],
  // Penopi stopped two short of a chain on purpose
  engineDoubleDeal: ["두 개는 줄게. 대신 다음 줄은 네가 열어야 해.", "마지막 둘은 남겨 둔다. 이게 작전이야.", "두 개 선물. 고맙다는 말은 안 해도 돼. 곧 알게 될 거야."],
  // I handed over a box while safe lines were still left
  humanGives: ["세 변 그었네? 상자 하나 준다는 뜻이지?", "안전한 선이 아직 있었는데. 고마워.", "선물인 줄 알게."],
  // Penopi had to give something (no safe line left)
  engineGives: ["둘 데가 없어서 하나 내준다. 작은 걸로.", "이건 어쩔 수 없이 주는 거야. 계산대로."],
  // the safe lines ran out
  noSafe: ["이제 안전한 선이 없어. 누가 먼저 내주나 보자.", "여기서부터 진짜야. 줄을 누가 먼저 여느냐.", "안전한 데는 다 썼어. 이제 세어 볼 시간."],
  engineWin: ["{b}:{a}. 빨간 상자가 더 많네.", "세어 봐. {b}개. 내가 이겼어.", "판이 거의 빨갛네. 내 색이야."],
  engineWinAll: ["상자 전부 빨간색. 하나도 못 칠했네.", "{b}:0. 연필은 깎아 놓기만 했구나."],
  humanWin: ["{a}:{b}... 네 연필이 더 바빴네.", "졌어. 마지막 줄을 잘못 열었어.", "세어 보니 네가 많다. 다시 세어도 그래."],
  drawBoxes: ["{a}:{b}. 사이좋게 반반.", "똑같이 나눴네. 상자도 공평해."],
  chatDots: [
    "점과 상자는 1889년에 프랑스 수학자 에두아르 뤼카가 소개했어.",
    "긴 줄을 먼저 내주는 사람이 대개 진다는 '긴 사슬 규칙'이 있어. 나는 그걸 셀 줄 알아.",
    "마지막 두 상자를 일부러 남겨 주는 수를 '더블 딜'이라고 해. 손해 같지만 판 전체를 가져와.",
    "엘윈 벌리캠프라는 수학자가 이 게임만 다룬 책을 썼어. 그만큼 깊어.",
    "공책 귀퉁이에 점 찍어 놓고 많이들 두지. 수업 시간에, 몰래.",
  ],
};
