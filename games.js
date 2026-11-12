// The lobby's game list. To add a game: make its folder (index.html, game.js, thumb.svg; see shared/shell.js)
// and add one line here. pitch: what Penopi says when I point at the card.
export const GAMES = [
  { id: 'backgammon', name: '백개먼', blurb: '주사위 굴려 먼저 다 빼면 이긴다. 더블링 큐브도 있어.', pitch: '백개먼은 주사위가 있으니까 너도 가끔 이길 수 있어.' },
  { id: 'breakthrough', name: '브레이크스루', blurb: '앞으로만 간다. 하나라도 끝줄에 닿으면 이긴다.', pitch: '브레이크스루는 뒤로 못 가. 너한테 딱 맞는 게임이지.' },
  { id: 'draughts', name: '국제 드래프트', blurb: '10×10 체커. 잡을 수 있으면 꼭, 제일 많이 잡아야 한다.', pitch: '드래프트는 일부러 하나 주고 여러 개 쓸어 가는 맛이야. 내가.' },
  // 체스: 잠시 목록에서 뺐다(사용자 요청, 너무 약하다는 평). chess/ 폴더는 그대로라 되살릴 때는 아래 줄의 // 만 지우면 된다.
  // { id: 'chess', name: '체스', blurb: '킹을 몰아넣으면 이긴다. 페노피의 원래 종목.', pitch: '체스? 나 1770년부터 뒀어. 진짜야.' },
];
