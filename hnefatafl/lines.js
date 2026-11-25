// Hnefatafl-only lines, added to shared/lines.js. All new.
// When: hnefatafl/game.js.
export const LINES = {
  pick: [
    "공격은 왕을 잡으러 가고, 수비는 왕을 구석으로 보내. 골라.",
    "어느 쪽 할래? 공격이 먼저 둬.",
  ],
  startHuman: [
    "먼저 둬. 공격이면 구석부터 막는 게 좋아.",
    "선공이야. 왕이 도망가기 전에 포위해 봐.",
  ],
  startEngine: [
    "내가 먼저 간다. 구석을 노려 볼게.",
    "선공은 내가. 왕을 지켜 줘야 하면 말해.",
  ],
  // Penopi took one of mine
  engineCap: [
    "하나 잡았다. 사이에 끼였어.",
    "끼워서 잡았어. 이 게임은 그게 전부야.",
    "양쪽에서 막으면 못 도망가.",
    "그 말은 내가 가져간다.",
  ],
  // I took one of Penopi's
  humanCap: [
    "잡혔다. 끼이지 않게 조심했어야 하는데.",
    "와, 그걸 노렸어? 다음엔 안 속아.",
    "하나 줬다. 바꾸면 내가 이득이거든.",
    "아야. 근데 그 자리 비었지?",
  ],
  // Penopi's king can run to a corner next move
  engineThreat: [
    "길 열렸다. 구석까지 한 번이야.",
    "왕이 달린다. 막을 수 있으면 막아 봐.",
    "구석이 보여. 두 칸도 필요 없어.",
  ],
  // Penopi's king has two ways to a corner at once
  engineFork: [
    "구석이 둘이야. 하나는 못 막겠지?",
    "양쪽에서 다 열렸다. 이건 반칙 아니야.",
  ],
  // my king can run
  humanThreat: [
    "왕이 달려가려고? 길을 막아야겠네.",
    "구석이 열렸다. 급하다 급해.",
    "그 길 막지 않으면 끝이야.",
  ],
  humanFork: [
    "구석이 두 개... 이건 막을 수가 없네.",
  ],
  // the king has reached an edge for the first time
  humanKingEdge: [
    "왕이 가장자리까지 왔네. 구석은 이제 한 줄이야.",
    "벽에 닿았다. 구석으로 가는 길을 지켜.",
  ],
  engineKingEdge: [
    "벽에 닿았다. 구석이 가까워졌어.",
    "가장자리다. 이제 구석 두 군데를 노려.",
  ],
  // the king is boxed in tight
  kingBoxed: [
    "왕이 많이 막혔네. 숨이 막힐 거야.",
  ],
  engineWinKing: [
    "왕을 잡았다. {n}수 걸렸네.",
    "네 왕이 둘러싸였어. 끝이야.",
  ],
  engineWinCorner: [
    "왕이 구석에 도착했다. {n}수 걸렸네.",
    "구석에 닿았어. 우리 왕 집에 갔다.",
  ],
  engineWinStuck: [
    "움직일 말이 없네. 내가 이겼다.",
  ],
  humanWinKing: [
    "...왕이 잡혔네. 포위를 못 풀었어.",
    "졌다. 왕을 너무 일찍 내보냈나 봐.",
  ],
  humanWinCorner: [
    "...구석을 못 막았네. 왕이 도망갔다.",
    "졌다. 길 하나만 더 막았으면 됐는데.",
  ],
  humanWinStuck: [
    "움직일 말이 없어서 졌다. 그런 규칙이었지.",
  ],
  draw: [
    "같은 판이 세 번 나왔어. 무승부야.",
    "빙빙 돌기만 하다 끝났네. 비겼어.",
  ],
  peek: [
    "그 말 움직이면 왕 쪽 길이 열려.",
    "그 자리에서 끼일 수도 있어.",
  ],
  chatHnefatafl: [
    "하네프타플은 바이킹이 두던 게임이야. 체스보다 오래됐대.",
    "하네프타플은 한쪽 편이 수가 두 배쯤 많아. 그래도 수비가 안 불리해. 왕이 도망가기만 하면 돼서.",
    "왕을 잡으려면 사방을 다 막아야 해. 그래서 공격이 제일 어려워.",
    "구석이 네 개인데, 한 번에 두 군데 길이 열리면 못 막아. 그게 수비의 비책이야.",
    "하네프타플은 북유럽에서 천 년 넘게 두었대. 체스가 퍼지면서 사라졌어.",
    "브랜두브는 7×7 작은 판이고, 코펜하겐은 11×11 큰 판이야.",
  ],
};
