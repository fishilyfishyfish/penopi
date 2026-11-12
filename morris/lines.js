// Nine Men's Morris lines, added to shared/lines.js. All new.
// When: morris/game.js.
export const LINES = {
  pick: ["백이 먼저 놓아. 말은 아홉 개씩.", "선공이든 후공이든 골라. 셋을 한 줄로 세우면 하나 가져가는 거야."],
  startHuman: ["먼저 놓아. 아홉 개 다 놓을 때까지는 아직 몸풀기야.", "백이니까 먼저. 아무 데나 놓아 봐. 어디든 내가 막을게."],
  startEngine: ["내가 먼저 놓는다. 한가운데 줄부터.", "백은 내가. 하나씩 놓다 보면 금방 줄이 생길 거야."],
  // Penopi made a mill and took one of mine
  engineMill: ["한 줄. 하나 가져간다.", "밀이야. 네 말 하나 빼고.", "세 개 섰다. 냠.", "줄 세웠어. 어느 걸 가져갈까... 이거."],
  // I made a mill and took one of Penopi's
  humanMill: ["...한 줄 세웠네. 가져가.", "그 줄을 못 봤어. 진짜로.", "하나 줬어. 다음 판에... 아니 다음 줄에 갚을게."],
  // Penopi blocked a line of mine that was one piece short
  engineBlock: ["그 줄은 막았어.", "두 개 세우고 기다렸지? 막았다.", "거기 비워 둘 줄 알았어?"],
  // down to three pieces: flying
  engineFlies: ["셋 남았네. 이제 날아다닌다.", "말이 셋이면 어디든 갈 수 있어. 조심해."],
  humanFlies: ["셋 남았다고 날아다니네. 마지막 발악이지?", "날 수는 있어도 오래는 못 날아."],
  engineWin: ["둘만 남았네. 끝.", "더 움직일 데가 없지? 내가 이겼어.", "{n}수 만에 끝났다."],
  humanWin: ["...둘 남았다. 졌어.", "움직일 데가 없네. 이번엔 네가 이겼어."],
  drawRepetition: ["같은 자리만 세 번째야. 비긴 걸로 하자.", "왔다 갔다만 하네. 무승부."],
  drawQuiet: ["오십 수 동안 아무도 못 잡았어. 비겼다.", "서로 막기만 하네. 무승부."],
  peek: ["그 말 빠지면 줄이 비어.", "그거 움직이면 내가 놓을 자리가 생기는데."],
  chatMorris: [
    "나인 멘스 모리스는 로마 시대부터 뒀대. 돌에 새긴 판이 여기저기서 나와.",
    "이 게임은 1990년대에 컴퓨터로 끝까지 풀렸어. 둘 다 완벽하게 두면 무승부야.",
    "셰익스피어 '한여름 밤의 꿈'에도 이 판 얘기가 나와.",
    "말이 셋 남으면 날 수 있다는 규칙은 지는 쪽한테 마지막 기회를 주려는 거래.",
    "한국 참고누도 비슷한 게임이야. 대각선 줄이 더 있지.",
  ],
};
