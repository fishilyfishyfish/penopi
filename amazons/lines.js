// Amazons-only lines, added to shared/lines.js. All new.
// When: amazons/game.js. {a} {b}: squares Penopi / I can still fill once the board has split.
export const LINES = {
  pick: [
    "선공이든 후공이든 골라. 아마존은 백이 먼저야.",
    "백 할래? 먼저 둔다고 먼저 이기는 건 아니지만.",
  ],
  startHuman: [
    "백이 먼저야. 첫 화살 어디 쏠지 잘 생각해.",
    "판이 넓지? 금방 좁아질 거야.",
  ],
  startEngine: [
    "내가 먼저 쏜다. 화살 피할 준비 해.",
    "백은 내가 할게. 칸이 줄어드는 거 구경해.",
  ],
  // Penopi just walled in one of my amazons: it can't move any more
  engineTrap: [
    "네 아마존 하나 가뒀어. 거기서 평생 살아.",
    "그 아마존은 이제 구경꾼이야.",
    "갇혔네. 화살 하나면 충분했어.",
    "하나 묶어 놨어. 이제 셋이서 해 봐.",
    "문 닫았다. 열쇠는 없어.",
  ],
  // I walled in one of Penopi's amazons
  humanTrap: [
    "...내 아마존 하나 갇혔네. 원래 쉬고 싶어 했어.",
    "가뒀다고 좋아하지 마. 나머지 셋이 더 바빠질 뿐이야.",
    "그 화살, 아팠어. 조금.",
    "어, 그 구석에 갇힐 줄 몰랐어. 몰랐던 걸로 해.",
  ],
  // I boxed in my own amazon
  selfTrap: [
    "방금 네 아마존을 네가 가둔 거야? 고마워.",
    "자기 아마존 가두는 거, 처음 보는 건 아니야. 그래도 웃기다.",
    "그 아마존 이제 못 움직여. 네 화살 때문에.",
  ],
  // Penopi's arrow landed right next to one of my amazons
  arrowClose: [
    "화살 바로 옆에 꽂았어. 숨 막히지?",
    "한 칸만 더 좁혀 볼까.",
    "그 아마존 주변 공기가 점점 줄어든다.",
    "옆자리 막았어. 이제 어디로 갈래?",
  ],
  // the board has split into separate rooms: from here on it's counting squares
  split: [
    "이제 땅이 다 갈렸어. 나 {a}칸, 너 {b}칸. 세기만 하면 돼.",
    "벽이 다 섰다. 내 쪽 {a}칸, 네 쪽 {b}칸이야.",
    "여기서부턴 칸 세기 싸움이야. 내가 {a}, 네가 {b}.",
    "땅 나누기 끝. {a} 대 {b}. 한 칸도 흘리지 마.",
  ],
  // Penopi has proved it wins whatever I do
  provenWin: [
    "계산 끝났어. 뭘 둬도 내가 이겨.",
    "끝까지 다 봤어. 이 판은 내 거야.",
    "이제 수순만 남았어. 천천히 둬도 돼.",
  ],
  engineWin: [
    "둘 데 없지? 아마존에서는 그게 지는 거야.",
    "네 아마존들이 갈 데가 없네. {n}수 만이야.",
    "판에 빈칸은 남았는데 네가 갈 칸은 없어.",
  ],
  humanWin: [
    "내 아마존들이 갈 데가 없네. ...화살을 너무 많이 쐈나.",
    "칸 세다가 하나 틀렸어. 그래서 그래.",
  ],
  peek: [
    "그 아마존 움직이면 뒤가 빈다.",
    "그걸로 어디 쏘게?",
  ],
  chatAmazons: [
    "아마존은 1988년에 아르헨티나의 발테르 삼카우스카스가 만들었어.",
    "이 판에서 첫 수로 둘 수 있는 수가 2,176가지야. 체스는 20가지인데.",
    "두 수만 지나도 나올 수 있는 국면이 430만 개가 넘어. 다 세 봤어.",
    "아마존은 컴퓨터 올림피아드 종목이기도 해.",
    "아마존 말은 체스 퀸처럼 움직여. 한 사람에 퀸이 넷인 셈이지.",
    "아마존은 판이 꽉 차기 전에 끝나. 갈 데가 없는 쪽이 먼저 지니까.",
  ],
};
