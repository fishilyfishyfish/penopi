// The little diagrams in the shogi rules sheet (shogi/game.js): where each piece can go. Pieces point up (mine).
import { diagram, figs } from '../shared/diagram.js';
import { GLYPHS } from '../shared/glyphs.js';

const NAME = ['', '보', '향', '계', '은', '금', '각', '비', '왕', '토', '행', '규', '전', '마', '룡'];
const SCALE = [0, 0.84, 0.88, 0.9, 0.94, 0.94, 0.97, 0.97, 1, 0.84, 0.88, 0.9, 0.94, 0.97, 0.97];
// the same tile as the board's (shogi/game.js pieceSvg), my side, hangul names; promoted pieces in red
const tile = (t, r, c) => ({
  t: 'piece', r, c, b: 100, k: 1, cls: 'sp',
  g: `<g transform="translate(50 50) scale(${SCALE[t]}) translate(-50 -50)"><polygon points="50,5 80,22 89,93 11,93 20,22"/><path class="g hangul${t > 8 ? ' pro' : ''}" d="${GLYPHS.hangul[NAME[t]]}" transform="translate(50 57) scale(0.6) translate(-50 -50)"/></g>`,
});
const dots = (list) => list.map(([r, c]) => ({ t: 'dot', r, c }));
const board5 = (items, caption) => diagram({ rows: 5, items, caption, label: caption, max: 146 });
const ray = (r0, c0, dr, dc) => { const out = []; for (let r = r0 + dr, c = c0 + dc; r >= 0 && r < 5 && c >= 0 && c < 5; r += dr, c += dc) out.push([r, c]); return out; };
const one = (r0, c0, list) => list.map(([dr, dc]) => [r0 + dr, c0 + dc]).filter(([r, c]) => r >= 0 && r < 5 && c >= 0 && c < 5);
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]], DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const rays = (r, c, dirs) => dirs.flatMap(([dr, dc]) => ray(r, c, dr, dc));

export const MOVE_FIGS = figs(
  board5([tile(8, 2, 2), ...dots(one(2, 2, [...ORTHO, ...DIAG]))], '왕: 사방 한 칸'),
  board5([tile(7, 2, 2), ...dots(rays(2, 2, ORTHO))], '비: 가로·세로로 멀리'),
  board5([tile(6, 2, 2), ...dots(rays(2, 2, DIAG))], '각: 대각선으로 멀리'),
  board5([tile(5, 2, 2), ...dots(one(2, 2, [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1]]))], '금: 앞·옆·뒤 한 칸(뒤 대각선은 못 가)'),
  board5([tile(4, 2, 2), ...dots(one(2, 2, [[-1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]))], '은: 앞 세 방향과 뒤 대각선'),
  board5([tile(3, 3, 2), ...dots(one(3, 2, [[-2, -1], [-2, 1]]))], '계: 앞으로 두 칸 뛰고 옆으로 한 칸(앞으로만)'),
  board5([tile(2, 4, 2), ...dots(ray(4, 2, -1, 0))], '향: 앞으로 멀리'),
  board5([tile(1, 3, 2), ...dots([[2, 2]])], '보: 앞으로 한 칸'),
);

export const PROMO_FIGS = figs(
  board5([tile(13, 2, 2), ...dots([...rays(2, 2, DIAG), ...one(2, 2, ORTHO)])], '마(승급한 각): 각 + 사방 한 칸'),
  board5([tile(14, 2, 2), ...dots([...rays(2, 2, ORTHO), ...one(2, 2, DIAG)])], '룡(승급한 비): 비 + 대각선 한 칸'),
);

// 이보: a second pawn on a file that already has one of mine (an unpromoted pawn) cannot be dropped; a promoted one doesn't count
export const NIFU_FIGS = figs(
  board5([tile(1, 3, 2), { t: 'x', r: 0, c: 2 }, { t: 'x', r: 1, c: 2 }, { t: 'x', r: 2, c: 2 }, { t: 'x', r: 4, c: 2 }, ...dots([[0, 0], [2, 4]])], '이보: 내 보(보)가 있는 줄(×)에는 보를 못 놓아. 다른 줄(점)은 괜찮아'),
  board5([tile(9, 3, 2), ...dots([[0, 2], [1, 2], [2, 2], [4, 2]])], '승급한 보(토)만 있는 줄에는 보를 놓을 수 있어'),
);
