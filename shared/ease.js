// 봐주기: the game page's "봐줘…" button. A kid-sister Penopi sighs at being asked to go easy, then plays with less effort.
// Not handicaps (no stones or pieces given): the same engine just looks less. Three levels, picked before the game starts:
//   '0' 안 봐줘 (full strength)   '1' 봐줘…   '2' 많이 봐줘…
// A game on 1 or 2 keeps no record (shared/shell.js), and Penopi talks differently (the 'ease:' lines below replace
// the line of the same name; a game may add its own 'ease:<name>' lines).
//
// How the engine looks less (per game, PLANS): a time and depth cap, and now and then a "lapse" - a move from a
// one-ply look, the way a distracted player grabs the first decent-looking move. The caps are first guesses
// (the arenas of breakthrough, reversi and chess take the players "ease1:2500" / "ease2:2500", and EASE_PLAN='{...}'
// overrides the table, to measure them against the full engine); tune them by playing.

export const EASE_OPTION = {
  key: 'ease', label: '봐주기', default: '0',
  choices: [{ id: '0', html: '안 봐줘' }, { id: '1', html: '봐줘…' }, { id: '2', html: '많이 봐줘…' }],
};

let level = '0';
export const setEase = (l) => { level = String(l || '0'); };
export const easeLevel = () => level;

// [level 1, level 2]: ms = time cap, depth = search depth cap, lapse = chance of a careless move searched only ld plies (default 1).
// Alpha-beta games cap the depth; the Monte Carlo ones (go, yukgak) only get less time.
export const PLANS = {
  breakthrough: [{ ms: 400, depth: 4, lapse: 0.1, ld: 2 }, { ms: 100, depth: 2, lapse: 0.3 }],
  draughts: [{ ms: 400, depth: 4, lapse: 0.1, ld: 2 }, { ms: 100, depth: 2, lapse: 0.3 }],
  chess: [{ ms: 400, depth: 3, lapse: 0.1, ld: 2 }, { ms: 100, depth: 2, lapse: 0.3 }],
  gomoku: [{ ms: 400, depth: 2, lapse: 0.1, ld: 1 }, { ms: 100, depth: 1, lapse: 0.3 }],
  morris: [{ ms: 400, depth: 3, lapse: 0.1, ld: 2 }, { ms: 100, depth: 2, lapse: 0.3 }],
  oware: [{ ms: 400, depth: 5, lapse: 0.1, ld: 2 }, { ms: 100, depth: 2, lapse: 0.3 }],
  reversi: [{ ms: 400, depth: 3, lapse: 0.1, ld: 2 }, { ms: 100, depth: 2, lapse: 0.3 }],
  dots: [{ ms: 400, depth: 3, lapse: 0.1, ld: 2 }, { ms: 100, depth: 2, lapse: 0.3 }],
  janggi: [{ ms: 400, depth: 3, lapse: 0.1, ld: 2 }, { ms: 100, depth: 2, lapse: 0.3 }],
  shogi: [{ ms: 400, depth: 3, lapse: 0.1, ld: 2 }, { ms: 100, depth: 2, lapse: 0.3 }],
  go: [{ ms: 350, lapse: 0 }, { ms: 60, lapse: 0 }],
  yukgak: [{ ms: 350, lapse: 0 }, { ms: 60, lapse: 0 }],
};

// What a game's think(time) asks the worker for: { time, depth? }. At full strength, exactly what it asked before.
export function easePlan(game, ms) {
  const p = level === '0' ? null : (PLANS[game] || PLANS.breakthrough)[Number(level) - 1];
  if (!p) return { time: ms };
  if (p.depth && Math.random() < p.lapse) return { time: Math.min(ms, 80), depth: p.ld || 1 };
  return p.depth ? { time: Math.min(ms, p.ms), depth: p.depth } : { time: Math.min(ms, p.ms) };
}

// 'ease:<name>' lines replace <name> while a game is on 1 or 2 (shared/shell.js). Same placeholders as shared/lines.js.
export const EASE_LINES = {
  'ease:pick': ["봐주는 판이야? 일단 고르기나 해. 에휴.", "또 봐달라고 왔어? 골라."],
  'ease:easePick0': ["그래, 처음부터 그냥 하면 되잖아.", "안 봐줘도 된다고? 용기는 인정.", "오, 그냥 한대. 후회하지 마."],
  'ease:easePick1': ["봐달라고? 에휴.", "시작도 안 했는데 봐달래. 알았어, 알았다고.", "봐줄게. 대신 이겨도 전적엔 안 쳐줘."],
  'ease:easePick2': ["많이? 에휴... 한심하다, 진짜.", "눈 반쯤 감고 둘게. 이제 됐지?", "졸면서 둬도 되겠네. 알았어."],
  'ease:startHuman': ["먼저 둬. 나는 대충 볼 거야.", "봐주는 거니까 첫 수는 네가 둬. 대충 따라갈게."],
  'ease:startEngine': ["내가 먼저. 대충 둘 거니까 기대는 하지 마.", "봐주는 판이라도 선공은 나야. 힘은 뺄게."],
  'ease:startColor': ["골라. 어느 쪽이든 힘은 안 줄 거야. 아니, 줄 거야.", "색은 네 맘대로 해. 나는 어차피 대충 둬."],
  'ease:normal': ["대충 두는 중이야. 봐달랬잖아.", "이쯤이면 충분히 봐준 거 맞지?", "하품 나온다. 내 차례네.", "생각? 안 해. 봐주는 중이니까.", "이거 맞나? 몰라, 봐주는 중이야."],
  'ease:normalNodes': ["국면 {nodes}개 봤어. 대충. 봐주는 중이니까.", "{nodes}개 훑었어. 열심히는 안 했어."],
  'ease:blunder': ["봐줘도 그런 수를 두네. 에휴.", "봐주는데도 실수야? 내가 더 민망하다.", "그건 봐줘도 못 봐주는 수야."],
  'ease:blunderSwing': ["방금 내 승률이 {d}%p 올랐어. 봐주는 중인데도."],
  'ease:goodMove': ["어? 그건 괜찮네. 봐주는 중인데 좋은 수 두면 어떡해.", "봐줬더니 좀 하네. 인정은 안 해.", "그 수는 우연이지?"],
  'ease:winning': ["봐주는데도 이기고 있네. 에휴.", "내가 이기는 중인데... 이거 봐주는 거 맞아?", "이대로면 봐준 의미가 없는데."],
  'ease:losing': ["...지고 있네. 봐줘서 그래. 알지?", "이거 봐주는 거 맞아? 점점 진짜로 지는 것 같은데.", "일부러 그러는 거야. 일부러."],
  'ease:selfBlunder': ["일부러야. 봐주는 거라고.", "...방금 건 실수 아니야. 연출이야.", "봐줬어. 이 정도는 일부러 두는 거야."],
  'ease:mate': ["{n}수 안에 끝나. 봐주는 것도 여기까지야.", "{n}수. 봐주려고 했는데 눈에 보이네."],
  'ease:mateCount': ["{n}수. 봐주기 끝.", "이제 {n}수. 미안, 보이는 걸 어떡해."],
  'ease:doomed': ["...졌다. 봐줘서 그런 거야. 알지?", "이건 못 막겠네. 봐줘서 그래. 진짜로."],
  'ease:slow': ["고민해도 봐주는 건 똑같아.", "천천히 해. 나는 대충 하는 중이라 급할 게 없어."],
  'ease:engineWin': ["봐줬는데도 이기네. 에휴. 전적엔 안 쳐.", "이겼다. 봐줬으니까 자랑은 안 할게.", "봐주는 판에서 이겨도 별로 안 기뻐. 진짜야."],
  'ease:engineWin2': ["다음엔 그냥 해 볼래? 아니, 못 하겠지.", "봐준 판은 전적에 안 적어. 내가 정했어."],
  'ease:humanWin': ["...이겼네. 봐줬으니까 당연하지. 전적엔 안 쳐줘.", "봐줘서 이긴 건 자랑하지 마. 안 쳐줘.", "졌다. 일부러야. 아무튼 전적엔 안 적을 거야."],
  'ease:humanWin2': ["이제 그냥 해 보든가. 안 봐줄 거야.", "봐줘서 이긴 거 알지? 다음엔 그냥 하자."],
  'ease:draw': ["봐줬는데 비겨? 에휴.", "비겼네. 봐줬으면 이겨야 하는 거 아니야?"],
};
