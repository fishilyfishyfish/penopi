// The little diagrams in the konane rules sheet (konane/game.js): the opening hole, a jump, jumping on.
import { diagram, figs } from '../shared/diagram.js';

const stone = (black, r, c) => ({ t: 'piece', r, c, k: 2.6, g: black ? '<ellipse cx="20" cy="20" rx="15" ry="14" style="fill:var(--ink)"/>' : '<ellipse cx="20" cy="20" rx="14" ry="13" style="fill:var(--sheet);stroke:var(--ink);stroke-width:2.4"/>' });
const strip = (items, caption) => diagram({ rows: 1, cols: 5, items, caption, label: caption, max: 146 });
const block = (items, caption) => diagram({ rows: 4, cols: 4, dark: (r, c) => (r + c) % 2 === 1, items, caption, label: caption, max: 146 });
const full = (skip) => { const out = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!skip.some(([a, b]) => a === r && b === c)) out.push(stone((r + c) % 2 === 0, r, c)); return out; };

export const OPEN_FIGS = figs(
  block([...full([[0, 0]]), { t: 'dot', r: 0, c: 0 }], '시작: 돌을 꽉 채워 놓고, 흑이 귀퉁이나 가운데 돌 하나를 빼'),
  block([...full([[0, 0], [0, 1]]), { t: 'dot', r: 0, c: 0 }, { t: 'dot', r: 0, c: 1 }], '백은 그 구멍 바로 옆 흰 돌 하나를 빼. 이제부터 뛰어'),
);
export const JUMP_FIGS = figs(
  strip([stone(true, 0, 0), stone(false, 0, 1), { t: 'dot', r: 0, c: 2 }, { t: 'arrow', from: [0, 0], to: [0, 2] }], '내 돌이 바로 옆 상대 돌을 뛰어넘어 빈칸에 내려'),
  strip([stone(true, 0, 2)], '뛰어넘긴 상대 돌은 판에서 치워'),
  strip([stone(true, 0, 0), stone(false, 0, 1), stone(false, 0, 3), { t: 'cap', r: 0, c: 1 }, { t: 'cap', r: 0, c: 3 }, { t: 'dot', r: 0, c: 4 }], '같은 방향이면 이어서 또 뛸 수 있어. 한 번에 둘을 치우는 거야'),
);
