// The game page: everything that isn't the game itself.
// The status line and the rules button, Penopi peeking over the board with its bubble, the board,
// the side pickers (then a new-game button), the rules sheet with the record, and when Penopi talks.
//
// A game (each game folder's game.js) is an object:
//   id            folder name, also the record's key
//   name          shown in the title and the aria labels
//   sides         [{id, html, first}] buttons to pick a side; first: true if I move first, false if
//                 Penopi does, undefined if neither is known yet (backgammon decides by dice)
//   lines, chat   game lines (added to shared/lines.js, see talk.js) and extra small-talk topics
//   rules         {title?, html: the <li>s of the rules list, note?: a line under the list}
//   options       optional [{key, label, choices: [{id, html}], default}]: choices shown above the side buttons
//                 (e.g. a rule set), remembered in this browser; start(side, opts) gets {key: chosen id}
//   longGame      plies after which "longGame" may be said
//   legacyRecord  optional localStorage key of an older record to take over
//   practice      optional true: Penopi is still practising this game, so no record is kept (and none is talked
//                 about); the first line is 'practiceHello'
//   mount(api)    draws the starting position; api is below
//   start(side)   a side was picked: play (call api.yourTurn / api.engineTurn / api.over as it goes)
//   reset()       new game: stop thinking, show the starting position (pickers come back)
//
// Talking follows LOA 튀르크: the engine's real evaluation after each of its moves, as Penopi's
// winning chance p, against the last one. A game may judge my move itself (verdict).

import { NAME, perchHtml, animate } from './character.js';
import { COMMON, CHAT } from './lines.js';
import { mergeLines, createTalk } from './talk.js';
import { loadRecord, visit, store } from './record.js';
import { offline } from './offline.js';

export function boot(game) {
  document.title = `${game.name} · ${NAME}`;
  const lines = mergeLines(COMMON, game.lines);
  const topics = CHAT.concat(game.chat || []);
  // a practice game keeps no record: a blank one that is never saved
  const record = game.practice ? { rec: { games: 0, penopi: 0, human: 0, draws: 0, streak: 0, hstreak: 0 }, add: () => 0, reset() {} } : loadRecord(game.id, game.legacyRecord);
  const rec = record.rec;
  visit();
  store.set(`penopi.${game.id}.opened`, Date.now()); // the lobby puts recently opened games first

  document.body.insertAdjacentHTML('afterbegin', `
<main class="stage game-${game.id}" id="stage">
  <div class="bar">
    <div class="status" id="status" aria-live="polite"></div>
    <button type="button" class="btn small" id="btn-rules">규칙</button>
  </div>
  ${perchHtml(NAME)}
  <div class="board" id="board" aria-label="${game.name} 판"></div>
  <div class="ask" id="tray" hidden></div>
  <div class="controls">
    <div class="setup" id="pick">${(game.options || []).map((o) => `<div class="opts" role="radiogroup" aria-label="${o.label}"><span class="opts-label">${o.label}</span>${o.choices.map((c) => `<button type="button" class="btn small opt" data-opt="${o.key}" data-val="${c.id}" role="radio">${c.html}</button>`).join('')}</div>`).join('')}<div class="controls">${game.sides.map((s, i) => `<button type="button" class="btn" data-side="${i}">${s.html}</button>`).join('')}</div></div>
    <button type="button" class="btn" id="btn-new" hidden>새 게임</button>
  </div>
</main>
<dialog class="sheet" id="rules" aria-labelledby="rules-title">
  <h2 id="rules-title" tabindex="-1">${game.rules.title || '규칙도 몰라?'}</h2>
  <p class="snark" id="rules-snark"></p>
  <ol>${game.rules.html}</ol>
  ${game.rules.note ? `<p class="note">${game.rules.note}</p>` : ''}
  <div class="record"><span id="record"></span><button type="button" class="btn quiet" id="btn-reset"${game.practice ? ' hidden' : ''}>전적 지우기</button>
    <p class="snark" id="reset-snark" aria-live="polite" hidden></p></div>
  <div class="foot"><a class="btn quiet" href="../">다른 게임</a><form method="dialog"><button class="btn small">알겠어</button></form></div>
</dialog>`);
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), statusEl = $('status'), boardEl = $('board'), tray = $('tray');
  const perch = stage.querySelector('.perch');

  let pc = null; // Penopi's controls, once animated
  const talk = createTalk(lines, perch.querySelector('.bubble'), () => pc && pc.place(pc.x, pc.walking()));
  // A line about a move (mine or Penopi's) lasts until the turn after next begins: a remark on my move is gone by
  // the time it's my turn again, so "못 들어오네" can't read as if it were about the new turn. Other lines
  // (small talk, nagging, poking, the start) stay until something else is said.
  const bubbleEl = perch.querySelector('.bubble');
  let turnNo = 0, lastTurn = null, bound = null; // bound: turnNo when the move line showing now was said
  const say = (key, vars) => { const ok = talk.say(key, vars); if (ok) bound = null; return ok; };
  const sayMove = (key, vars) => { const ok = talk.say(key, vars); if (ok) bound = turnNo; return ok; };
  const chat = () => { if (talk.chat(topics)) bound = null; };
  function turnBegins(who) {
    if (who === lastTurn) return;
    lastTurn = who; turnNo++;
    if (bound !== null && turnNo - bound >= 2) { bubbleEl.textContent = ''; bound = null; }
  }
  pc = animate(perch, say, () => !tray.hidden && tray.dataset.waiting === '1');

  // ---------- a game in progress ----------
  let started = false, gameId = 0, side = null;
  let prevP = null, flags = {}, turnStart = 0, slowTimer = 0, chatTimer = 0, winTimer = 0;
  const stopTimers = () => { clearTimeout(slowTimer); clearTimeout(chatTimer); };

  function status(html) { if (statusEl.dataset.h !== html) { statusEl.innerHTML = html; statusEl.dataset.h = html; } }
  const chip = (c) => (c ? `<span class="chip ${c}"></span>` : '');

  const api = {
    board: boardEl,
    tray,
    name: NAME,
    get gameId() { return gameId; },
    get started() { return started; },
    get side() { return side; },
    say: sayMove, // a game's own lines are about what just happened in the game
    has: talk.has,
    status,
    chip,
    walkTo: (x, ms) => pc.walkTo(x, ms),
    runTo: (x) => pc.walkTo(x, 600),           // dash over to a spot (0..1 across the board)
    act: (name, ms) => pc.act(name, ms),
    thinking: (on) => pc.thinking(on),
    // I picked up a piece at x (0..1): Penopi sidles over, now and then with a remark
    peek(x, firstOfTurn) {
      if (pc.hiding || pc.is('sunk')) return;
      pc.walkTo(x, 2200);
      peeks = firstOfTurn ? 1 : peeks + 1;
      if (peeks === 3) say('peekAgain');
      else if (peeks === 1 && Math.random() < 0.35) say('peek');
    },
    // my turn: status line, and Penopi's small talk / nagging if I take long
    yourTurn({ color, label, text } = {}) {
      turnBegins('human');
      pc.thinking(false);
      status(text || `${chip(color)}내 차례${label ? ` (${label})` : ''}`);
      stopTimers();
      turnStart = Date.now();
      const g = gameId, still = () => g === gameId && started && turnStart && Date.now() - turnStart >= 14000;
      chatTimer = setTimeout(() => { if (still() && Math.random() < 0.6) chat(); }, 15000);
      slowTimer = setTimeout(() => { if (still()) { say('slow'); pc.pace(() => g === gameId); } }, 40000);
    },
    engineTurn({ color, text } = {}) {
      turnBegins('penopi');
      stopTimers(); turnStart = 0;
      status(text || `${chip(color)}${NAME} 차례`);
      pc.thinking(true);
      pc.wake();
    },
    // after my move. facts: [[key, vars, chance], ...] in priority order; plies: moves played so far
    humanMoved({ facts = [], plies = 0 } = {}) {
      const elapsed = turnStart ? Date.now() - turnStart : 99999;
      stopTimers(); turnStart = 0;
      for (const [key, vars, chance = 1] of facts) if (Math.random() < chance && sayMove(key, vars)) return;
      if (elapsed < 1500 && Math.random() < 0.3) sayMove('fast');
      else if (!flags.long && plies >= (game.longGame || 60)) { flags.long = true; sayMove('longGame'); }
    },
    // after Penopi's move.
    //   p        Penopi's winning chance now (0..1), from the engine's own evaluation
    //   mate     moves Penopi still needs to win for sure, if the engine has proved it; doomed: proved lost
    //   verdict  'blunder' | 'good' | null to judge my last move directly; undefined: judge from the swing in p
    //   facts    [[key, vars, chance], ...] game events to remark on, tried after the evaluation lines
    //   nodes, depth  for "normalNodes" ("국면 {nodes}개 봤어")
    engineMoved(info) {
      pc.thinking(false);
      const { p } = info;
      if (info.mate) { sayMove(flags.mate ? 'mateCount' : 'mate', { n: info.mate }); flags.mate = true; prevP = 1; return; }
      if (info.doomed) { if (!flags.doom) { flags.doom = true; sayMove('doomed'); pc.act('duck', 1300); } prevP = 0; return; }
      const swing = prevP === null ? 0 : p - prevP; // how much my last move changed Penopi's chances
      prevP = p;
      let verdict = info.verdict;
      if (verdict === undefined) verdict = swing > 0.15 && p > 0.6 ? 'blunder' : swing <= -0.2 ? 'oops' : swing <= -0.1 ? 'good' : null;
      if (verdict === 'blunder') {
        if (!(swing > 0.15 && Math.random() < 0.3 && sayMove('blunderSwing', { d: Math.round(swing * 100) }))) sayMove('blunder');
        return;
      }
      if (verdict === 'oops' && Math.random() < 0.8) { sayMove('selfBlunder'); return; }
      if (verdict === 'good' && Math.random() < 0.7) { sayMove('goodMove'); return; }
      for (const [key, vars, chance = 1] of info.facts || []) if (Math.random() < chance && sayMove(key, vars)) return;
      if (p > 0.85 && !flags.lead) { flags.lead = true; sayMove('winning', { p: Math.round(p * 100) }); pc.walkTo(0.15 + Math.random() * 0.7, 1800); return; }
      if (p < 0.2 && !flags.behind) { flags.behind = true; sayMove('losing', { p: Math.round(p * 100) }); return; }
      const r = Math.random();
      if (info.nodes && r < 0.2 && talk.has('normalNodes')) sayMove('normalNodes', { nodes: man(info.nodes), depth: info.depth });
      else if (r < 0.3) sayMove('normal');
      else if (r < 0.45) chat();
    },
    // the game is over. winner: 'human' | 'penopi' | 'draw'; vars fill the lines ({n} moves etc.);
    // key: a more specific line to try first (e.g. 'engineWinGammon', or a draw's reason)
    over({ winner, vars = {}, key, text }) {
      stopTimers(); turnStart = 0;
      pc.thinking(false);
      const broke = record.add(winner);
      if (text) status(text);
      else status(winner === 'draw' ? '무승부' : winner === 'human' ? '내가 이겼다' : `${NAME}가 이겼다`);
      let follow, fv = vars;
      if (winner === 'draw') { if (!(key && say(key, vars))) say('draw', vars); }
      else if (winner === 'human') {
        if (!(key && say(key, vars))) say(rec.human === 1 ? 'humanWinFirst' : 'humanWin', vars);
        follow = 'humanWin2';
        pc.sunk(true); // stays half hidden until the next game
      } else {
        if (!(key && say(key, vars))) say('engineWin', vars);
        pc.act('hop', 1400);
        follow = broke >= 2 ? 'streakBroken' : 'engineWin2'; fv = { ...vars, k: broke };
      }
      const g = gameId;
      clearTimeout(winTimer);
      if (follow) winTimer = setTimeout(() => { if (g === gameId) say(follow, fv); }, 3500);
      $('btn-new').hidden = false;
    },
  };
  let peeks = 0;
  const man = (n) => (n >= 10000 ? Math.round(n / 10000) + '만' : String(n));

  // ---------- picking a side, starting, starting over ----------
  function start(i) {
    gameId++;
    started = true; side = game.sides[i].id;
    prevP = null; flags = {};
    turnNo = 0; lastTurn = null; bound = null;
    clearTimeout(winTimer);
    pc.sunk(false);
    $('pick').hidden = true;
    $('btn-new').hidden = false;
    stage.classList.add('playing');
    const first = game.sides[i].first;
    if (rec.hstreak >= 2) say('humanStreak', { k: rec.hstreak });
    else if (rec.streak >= 2 && Math.random() < 0.7) say('streak', { k: rec.streak });
    else if (rec.games > 0 && (rec.games + 1) % 10 === 0) say('milestone', { n: rec.games + 1 });
    else if (rec.games > 0 && Math.random() < 0.6) say('rematch', { w: rec.penopi, l: rec.human });
    else say(first === true ? 'startHuman' : first === false ? 'startEngine' : 'startColor');
    requestAnimationFrame(() => pc.place(pc.x)); // the board just grew
    game.start(side, { ...opts });
  }
  function newGame() {
    gameId++;
    started = false; side = null;
    stopTimers(); turnStart = 0; clearTimeout(winTimer);
    pc.sunk(false); pc.thinking(false);
    tray.hidden = true; tray.innerHTML = '';
    status('');
    $('pick').hidden = false;
    $('btn-new').hidden = true;
    stage.classList.remove('playing');
    game.reset();
    say('pick');
    requestAnimationFrame(() => pc.place(pc.x));
    stage.querySelector('[data-side="0"]').focus();
  }
  stage.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => start(Number(b.dataset.side))));
  // game options (a rule set...): one choice per option, remembered in this browser
  const optKey = `penopi.${game.id}.options`, opts = {};
  const saved = store.get(optKey, {});
  for (const o of game.options || []) opts[o.key] = o.choices.some((c) => c.id === saved[o.key]) ? saved[o.key] : o.default;
  const showOpts = () => stage.querySelectorAll('[data-opt]').forEach((b) => {
    const on = opts[b.dataset.opt] === b.dataset.val;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  stage.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
    opts[b.dataset.opt] = b.dataset.val; store.set(optKey, opts); showOpts();
    if (game.optionChanged) game.optionChanged(b.dataset.opt, b.dataset.val);
  }));
  showOpts();
  api.options = opts;
  $('btn-new').addEventListener('click', newGame);

  // ---------- rules sheet and record ----------
  const rulesEl = $('rules'), resetBtn = $('btn-reset');
  let rulesSeen = 0, wiped = false;
  function showRecord() {
    $('record').textContent = game.practice ? `${NAME}가 아직 연습 중이라 전적은 안 적어.` : `전적: ${NAME} ${rec.penopi}승 · 너 ${rec.human}승${rec.draws ? ` · 무승부 ${rec.draws}` : ''}`;
    resetBtn.textContent = '전적 지우기'; resetBtn.dataset.armed = '';
  }
  function resetSnark(key) {
    const el = $('reset-snark');
    el.textContent = talk.line(key, { w: rec.penopi, l: rec.human });
    el.hidden = false;
    resetBtn.scrollIntoView({ block: 'nearest' });
  }
  $('btn-rules').addEventListener('click', () => {
    $('rules-snark').textContent = talk.line(rulesSeen++ ? 'rulesAgain' : 'rules');
    showRecord();
    $('reset-snark').hidden = true; wiped = false;
    if (rulesEl.showModal) rulesEl.showModal(); else rulesEl.setAttribute('open', '');
    $('rules-title').focus({ preventScroll: true }); // not the reset button at the bottom
    rulesEl.scrollTop = 0;
  });
  rulesEl.addEventListener('close', () => say(wiped ? 'recordResetBye' : 'rulesDone'));
  resetBtn.addEventListener('click', () => {
    if (!rec.games) { resetSnark('recordResetEmpty'); return; }
    if (!resetBtn.dataset.armed) {
      resetBtn.dataset.armed = '1'; resetBtn.textContent = '그래도 지울래';
      resetSnark(rec.human ? 'recordResetAsk' : 'recordResetAskZero');
      return;
    }
    record.reset();
    showRecord();
    resetSnark('recordReset'); wiped = true;
  });

  offline();
  game.mount(api);
  // read-only handle for the automatic checks (tools/smoke.mjs)
  globalThis.__penopi = { debug: () => (game.debug ? game.debug() : null) };
  // the first line knows whether we've met here, and how long ago
  const away = rec.last ? Math.floor((Date.now() - rec.last) / 86400000) : 0;
  if (game.practice) say('practiceHello');
  else if (!rec.games) say('firstVisit');
  else if (away >= 1) say('welcomeBack', { days: away, w: rec.penopi, l: rec.human });
  else say('pick');
  return api;
}
