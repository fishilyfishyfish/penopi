// The lobby's game list. To add a game: make its folder (index.html, game.js, thumb.svg; see shared/shell.js)
// and add one line here. pitch: what Penopi says when I point at the card.
export const GAMES = [
  { id: 'backgammon', name: '백개먼', blurb: '주사위 굴려 먼저 다 빼면 이긴다. 더블링 큐브도 있어.', pitch: '백개먼은 주사위가 있으니까 너도 가끔 이길 수 있어.' },
  { id: 'breakthrough', name: '브레이크스루', blurb: '앞으로만 간다. 하나라도 끝줄에 닿으면 이긴다.', pitch: '브레이크스루는 뒤로 못 가. 너한테 딱 맞는 게임이지.' },
  { id: 'draughts', name: '국제 드래프트', blurb: '10×10 체커. 잡을 수 있으면 꼭, 제일 많이 잡아야 한다.', pitch: '드래프트는 일부러 하나 주고 여러 개 쓸어 가는 맛이야. 내가.' },
  { id: 'gomoku', name: '오목', blurb: '다섯 개 먼저 이으면 이긴다. 규칙은 골라서.', pitch: '오목? 판은 넓은데 너한테 남는 자리는 별로 없을걸.' },
  { id: 'morris', name: '나인 멘스 모리스', blurb: '셋을 한 줄로 세우면 하나 가져간다. 셋 남으면 날 수 있다.', pitch: '모리스는 로마 사람들도 뒀대. 나는 그때부터 이겼고.' },
  { id: 'oware', name: '오와레', blurb: '씨앗을 뿌려서 2, 3개가 되면 가져간다. 25개 먼저.', pitch: '오와레는 씨앗 세는 게임이야. 나는 세는 건 틀린 적이 없어.' },
  // 체스: 페노피가 아직 연습 중인 컨셉(사용자 요청). practice: 전적을 적지 않는다(chess/game.js에도 같은 표시).
  { id: 'chess', name: '체스', blurb: '킹을 몰아넣으면 이긴다. 페노피가 제일 못하는 게임.', pitch: '체스는 내가 제일 못해. 그래서 연습 중이야. 그래도 지면 놀릴 거야.', practice: true },
];
