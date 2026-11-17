// The lobby: one card per game in games.js, each with my record against Penopi; Penopi hosts.
import { GAMES } from './games.js';
import { NAME, perchHtml, animate } from './shared/character.js';
import { COMMON, LOBBY } from './shared/lines.js';
import { createTalk } from './shared/talk.js';
import { loadRecord, visit, store } from './shared/record.js';
import { offline } from './shared/offline.js';

const shelf = document.getElementById('shelf');
document.getElementById('kinds').insertAdjacentHTML('beforebegin', perchHtml(NAME));
const perch = document.querySelector('.perch');
const lines = { ...COMMON, ...LOBBY };
let pc = null;
const talk = createTalk(lines, perch.querySelector('.bubble'), () => pc && pc.place(pc.x, pc.walking()));
pc = animate(perch, (k, v) => talk.say(k, v));

let w = 0, l = 0, games = 0;
// the games I opened most recently first (shared/shell.js keeps penopi.<id>.opened), the rest in games.js order
const opened = (g) => store.get(`penopi.${g.id}.opened`, 0) || 0;
const ORDER = GAMES.map((g, i) => [g, i]).sort((a, b) => (opened(b[0]) - opened(a[0])) || (a[1] - b[1])).map(([g]) => g);
for (const game of GAMES) { const { rec } = loadRecord(game.id); if (!game.practice) { w += rec.penopi; l += rec.human; games += rec.games; } }

const FILTERS = [['all', '전부'], ['move', '말 옮기기'], ['line', '잇기'], ['take', '차지하기'], ['practice', '연습 중']];
const matches = (g, f) => f === 'all' || (f === 'practice' ? !!g.practice : g.kind === f);
let filter = store.get('penopi.lobby.filter', 'all');
if (!FILTERS.some(([k]) => k === filter)) filter = 'all';
const kinds = document.getElementById('kinds');
kinds.innerHTML = FILTERS.map(([k, name]) => `<button type="button" class="kind" data-f="${k}" aria-pressed="false">${name} <span class="n">${GAMES.filter((g) => matches(g, k)).length}</span></button>`).join('');
let shown = ORDER;

// pointing at a card: Penopi walks over and pitches it (once per card per visit)
const pitched = new Set();
function render() {
  kinds.querySelectorAll('.kind').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.f === filter)));
  shown = ORDER.filter((g) => matches(g, filter));
  shelf.innerHTML = shown.map((game) => {
    const { rec } = loadRecord(game.id);
    const r = game.practice ? `${NAME} 연습 중 · 전적 안 적음` : rec.games ? `${NAME} ${rec.penopi}승 · 너 ${rec.human}승` : '아직 안 둬 봤어';
    return `<a class="card" href="${game.id}/" data-id="${game.id}">
    <img src="${game.id}/thumb.svg" alt="" width="88" height="88">
    <h2>${game.name}</h2><p class="blurb">${game.blurb}</p><p class="rec">${r}</p></a>`;
  }).join('');
  shelf.querySelectorAll('.card').forEach((card, i) => {
    const point = () => {
      pc.walkTo(i % 2 ? 0.75 : 0.25, 1200); // two cards a row
      const game = shown[i];
      if (!pitched.has(game.id) && game.pitch) { pitched.add(game.id); perch.querySelector('.bubble').textContent = game.pitch; pc.place(pc.x, true); }
    };
    card.addEventListener('pointerenter', point);
    card.addEventListener('focus', point);
  });
}
kinds.addEventListener('click', (e) => {
  const c = e.target.closest('.kind');
  if (!c || c.dataset.f === filter) return;
  filter = c.dataset.f; store.set('penopi.lobby.filter', filter); render();
});
render();
const tally = document.getElementById('tally');
tally.textContent = games ? `지금까지 ${games}판: ${NAME} ${w}승 · 너 ${l}승` : '';

const v = visit();
if (v.first) talk.say('lobbyFirst');
else if (v.days >= 1) talk.say('lobbyBack', { days: v.days });
else if (w + l > 0 && Math.random() < 0.5) talk.say(l > w ? 'lobbyRecordLosing' : 'lobbyRecord', { w, l });
else talk.say('lobbyHello');
offline();
