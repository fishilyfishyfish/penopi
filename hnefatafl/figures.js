// The little diagrams in the hnefatafl rules sheet (hnefatafl/game.js): moving, closing in, the king.
import { diagram, figs } from '../shared/diagram.js';

const crown = '<path d="M9 29 L7 13 L15 20 L20 9 L25 20 L33 13 L31 29 Z M10 33 H30" style="fill:none;stroke:var(--ink);stroke-width:2.6;stroke-linejoin:round;stroke-linecap:round"/>';
const att = (r, c) => ({ t: 'piece', r, c, k: 2.3, g: '<ellipse cx="20" cy="20" rx="15" ry="14" style="fill:var(--ink)"/>' });
const def = (r, c) => ({ t: 'piece', r, c, k: 2.3, g: '<ellipse cx="20" cy="20" rx="14" ry="13" style="fill:var(--sheet);stroke:var(--ink);stroke-width:2.4"/>' });
const king = (r, c) => ({ t: 'piece', r, c, k: 2.3, g: '<ellipse cx="20" cy="20" rx="15" ry="14" style="fill:var(--sheet);stroke:var(--ink);stroke-width:2.6"/>' + crown });
const board = (rows, cols, items, caption, extra = {}) => diagram({ rows, cols, items, caption, label: caption, max: 146, ...extra });
const corner = (r, c) => ({ t: 'x', r, c });
const throneHl = (r, c) => ({ r, c });

export const MOVE_FIGS = figs(
  board(5, 5, [def(2, 1), ...[[2, 2], [2, 3], [2, 4], [1, 1], [0, 1], [3, 1], [4, 1]].map(([r, c]) => ({ t: 'dot', r, c }))], '룩처럼: 가로나 세로로 빈 칸을 몇 칸이든'),
  board(5, 5, [att(2, 0), def(2, 3), { t: 'dot', r: 2, c: 1 }, { t: 'dot', r: 2, c: 2 }, { t: 'x', r: 2, c: 4 }], '다른 말은 뛰어넘을 수 없어'),
);
export const CAPTURE_FIGS = figs(
  board(1, 5, [att(0, 0), def(0, 1), att(0, 3), { t: 'dot', r: 0, c: 2 }, { t: 'arrow', from: [0, 3], to: [0, 2], trim: 22 }], '내가 움직여서 끼우면 잡아'),
  board(1, 5, [att(0, 0), def(0, 1), att(0, 2), { t: 'cap', r: 0, c: 1 }], '잡힌 말은 판에서 치워'),
  board(3, 3, [att(2, 0), corner(0, 0), def(1, 0), { t: 'cap', r: 2, c: 0 }], '구석은 적: 구석 옆의 공격 말은 수비 말 하나로도 잡혀'),
);
export const KING_FIGS = figs(
  board(3, 3, [king(1, 1), att(0, 1), att(2, 1), att(1, 0), att(1, 2), { t: 'cap', r: 1, c: 1 }], '11×11: 사방을 공격 말 넷이 막으면 왕이 잡혀'),
  board(3, 3, [king(1, 1), att(0, 1), att(2, 1), att(1, 0), { t: 'dot', r: 1, c: 2 }], '셋만으로는 왕이 빠져나가'),
  board(3, 3, [king(1, 1), att(0, 1), att(1, 0), att(2, 1), { t: 'hl', r: 1, c: 2 }].filter((x) => x.t !== 'hl'), '왕좌(노란 칸) 옆에서는 셋과 빈 왕좌로 충분해', { hl: [{ r: 1, c: 2 }] }),
);
