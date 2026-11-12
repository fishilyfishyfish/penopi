// The lobby: one card per game in games.js, each with my record against Penopi; Penopi hosts.
import { GAMES } from './games.js';
import { NAME, perchHtml, animate } from './shared/character.js';
import { COMMON, LOBBY } from './shared/lines.js';
import { createTalk } from './shared/talk.js';
import { loadRecord, visit } from './shared/record.js';
import { offline } from './shared/offline.js';

const shelf = document.getElementById('shelf');
shelf.insertAdjacentHTML('beforebegin', perchHtml(NAME));
const perch = document.querySelector('.perch');
const lines = { ...COMMON, ...LOBBY };
let pc = null;
const talk = createTalk(lines, perch.querySelector('.bubble'), () => pc && pc.place(pc.x, pc.walking()));
pc = animate(perch, (k, v) => talk.say(k, v));

let w = 0, l = 0;
shelf.innerHTML = GAMES.map((game) => {
  const { rec } = loadRecord(game.id);
  w += rec.penopi; l += rec.human;
  const r = rec.games ? `${NAME} ${rec.penopi}승 · 너 ${rec.human}승` : '아직 안 둬 봤어';
  return `<a class="card" href="${game.id}/" data-id="${game.id}">
    <img src="${game.id}/thumb.svg" alt="" width="88" height="88">
    <div><h2>${game.name}</h2><p>${game.blurb}</p><p class="rec">${r}</p></div></a>`;
}).join('');

// pointing at a card: Penopi walks over and pitches it (once per card per visit)
const pitched = new Set();
shelf.querySelectorAll('.card').forEach((card, i) => {
  const point = () => {
    pc.walkTo(0.2 + (0.6 * i) / Math.max(1, GAMES.length - 1), 1200);
    const game = GAMES[i];
    if (!pitched.has(game.id) && game.pitch) { pitched.add(game.id); perch.querySelector('.bubble').textContent = game.pitch; pc.place(pc.x, true); }
  };
  card.addEventListener('pointerenter', point);
  card.addEventListener('focus', point);
});

const v = visit();
if (v.first) talk.say('lobbyFirst');
else if (v.days >= 1) talk.say('lobbyBack', { days: v.days });
else if (w + l > 0 && Math.random() < 0.5) talk.say(l > w ? 'lobbyRecordLosing' : 'lobbyRecord', { w, l });
else talk.say('lobbyHello');
offline();
