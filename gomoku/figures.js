// The little diagrams in the gomoku rules sheet (gomoku/game.js): five in a row, and the double three black may not make.
import { diagram, figs } from '../shared/diagram.js';

const stone = (black, r, c) => ({
  t: 'piece', r, c, k: 2.3,
  g: black ? '<ellipse cx="20" cy="20" rx="15" ry="14" style="fill:var(--ink)"/>' : '<ellipse cx="20" cy="20" rx="14" ry="13" style="fill:var(--sheet);stroke:var(--ink);stroke-width:2.4"/>',
});
const board = (items, caption) => diagram({ rows: 7, cols: 7, pts: true, items, caption, label: caption, max: 146 });

export const FIVE_FIG = figs(
  board([1, 2, 3, 4, 5].map((c) => stone(true, 3, c)), '가로로 다섯 개를 이으면 이겨(세로·대각선도)'),
  board([0, 1, 2, 3, 4].map((i) => stone(true, i + 1, i + 1)), '대각선도 다섯 개면 이겨'),
);
// The double-three figures. Each case is a position (in the 7×7 window the figure shows) and the point black is thinking of;
// tools/test-gomoku.mjs puts the same cases to the engine (the window sits in the middle of its 15×15 board: +4, +4), so the
// pictures can't say anything the rules don't.
export const OFFSET = 4;
const CORE = [[3, 1], [3, 2], [1, 3], [2, 3]]; // two open twos that cross at (3, 3)
export const CASES = {
  real: { blacks: CORE, whites: [], spot: [3, 3], forbidden: true },
  // one of the threes has a white stone at its end: it can only make a closed four, so it is not an open three
  blocked: { blacks: CORE, whites: [[0, 3]], spot: [3, 3], forbidden: false },
  // the same double three, but the point also makes exactly five: a five is never forbidden
  five: { blacks: [[3, 0], [3, 1], [3, 2], [3, 4], [1, 3], [2, 3], [1, 1], [2, 2]], whites: [], spot: [3, 3], forbidden: false },
  // the five case without the stone that makes the five: it is a real double three (so the five is what saves it)
  // from a real renju game (the user's, 2026-11-21): black h10 makes a three along row 10 and, with f8 and i11, a split three along the diagonal.
  // But the point that would make that diagonal a four (g9) is forbidden for black (it would make two fours with row 9), so the diagonal is no
  // three and h10 is allowed under renju; a rule that only counts threes (ban33) forbids it. Window: columns f..l, rows 12..6.
  chained: { blacks: [[4, 0], [3, 3], [3, 4], [3, 5], [2, 3], [2, 4], [1, 3]], whites: [[3, 6]], spot: [2, 2], forbidden: { ban33: true, renju: false }, key: [3, 1] },
  fiveMissing: { blacks: [[3, 0], [3, 1], [3, 2], [1, 3], [2, 3], [1, 1], [2, 2]], whites: [], spot: [3, 3], forbidden: true },
};
const wants = (k, rule) => (typeof CASES[k].forbidden === 'object' ? CASES[k].forbidden[rule] : CASES[k].forbidden);
const items = (k, extra = []) => [
  ...CASES[k].blacks.map(([r, c]) => stone(true, r, c)), ...CASES[k].whites.map(([r, c]) => stone(false, r, c)),
  ...extra,
  wants(k, 'renju') ? { t: 'x', r: CASES[k].spot[0], c: CASES[k].spot[1] } : { t: 'dot', r: CASES[k].spot[0], c: CASES[k].spot[1] },
];
export const DOUBLE_THREE_FIG = figs(
  board(items('real'), '진짜 금수: 열린 삼이 한꺼번에 둘(쌍삼) → 못 둬(×)'),
  board(items('blocked'), '가짜 금수 1: 한쪽 삼 끝이 흰 돌에 막혀 있으면 열린 삼이 아니야 → 둘 수 있어(점)'),
  board(items('five', [{ t: 'seg', from: [3, 0], to: [3, 4], col: 'var(--pen)', w: 7 }]), '가짜 금수 2: 쌍삼 모양이 생겨도 다섯이 되는 수는 둘 수 있어(점)'),
  board(items('chained', [{ t: 'x', r: 3, c: 1 }]), '가짜 금수 3(렌주): 점에 두면 대각선도 삼처럼 보여도, 그걸 넷으로 키울 자리(×)가 금수(쌍사)라서 삼이 아니야 → 삼은 가로 하나뿐, 둘 수 있어'),
);
