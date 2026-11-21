// The little diagrams in the 얼티메이트 틱택토 rules sheet (ttt9/game.js): which small board you send the other side to.
import { diagram, figs } from '../shared/diagram.js';

const big = (items, hl, caption) => diagram({ rows: 9, thick: 3, wide: true, max: 230, items, hl, caption, label: caption });
const board = (b) => ({ r: ((b / 3) | 0) * 3, c: (b % 3) * 3, rows: 3, cols: 3 });

// X plays the bottom-middle cell of the top-left board: the other side must play in the bottom-middle board
export const SEND_FIG = figs(big(
  [{ t: 'mx', r: 2, c: 1 }, { t: 'ring', r: 2, c: 1 }, { t: 'arrow', from: [2, 1], to: [7, 4], trim: 42 }],
  [board(7)],
  '왼쪽 위 판의 아래 가운데 칸에 두면, 상대는 큰 판의 아래 가운데 판에서만 둘 수 있어',
));

// the board it points at (the middle one) is already won: any open board will do
export const FREE_FIG = figs(big(
  [{ t: 'mo', r: 4, c: 4, s: 3.4, w: 12 }, { t: 'mx', r: 1, c: 1 }, { t: 'ring', r: 1, c: 1 }, { t: 'arrow', from: [1, 1], to: [4, 4], trim: 42 }],
  [0, 1, 2, 3, 5, 6, 7, 8].map(board),
  '가리키는 판(가운데)이 이미 끝났으면, 끝나지 않은 아무 판(노란 판)에서나 둘 수 있어',
));
