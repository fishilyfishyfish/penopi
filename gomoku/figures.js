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
export const DOUBLE_THREE_FIG = figs(
  board([stone(true, 3, 1), stone(true, 3, 2), stone(true, 1, 3), stone(true, 2, 3), { t: 'x', r: 3, c: 3 }], '여기 두면 열린 삼이 한꺼번에 둘(쌍삼): 흑은 못 둬'),
);
