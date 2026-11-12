// The line picker. Lines live in lists by situation (shared/lines.js + each game's lines.js).
// A game's lists are added to the shared ones of the same name; a game can replace a shared list
// instead by naming it in `$replace`. Placeholders look like {n} and are filled from vars.

export function mergeLines(common, game = {}) {
  const out = {};
  const replace = new Set(game.$replace || []);
  for (const k of Object.keys(common)) out[k] = common[k].slice();
  for (const k of Object.keys(game)) {
    if (k.startsWith('$')) continue;
    out[k] = replace.has(k) || !out[k] ? game[k].slice() : game[k].concat(out[k]);
  }
  return out;
}

export const fill = (line, vars) => line.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : ''));

// say(key, vars) shows a line in the bubble, never repeating any of the last four.
export function createTalk(lines, bubbleEl, afterSay = () => {}) {
  let recent = [];
  function pick(key) {
    const all = lines[key];
    if (!all || !all.length) return null;
    const fresh = all.filter((x) => !recent.includes(x));
    const pool = fresh.length ? fresh : all;
    const line = pool[Math.floor(Math.random() * pool.length)];
    recent = [line].concat(recent).slice(0, 4);
    return line;
  }
  function say(key, vars) {
    const line = pick(key);
    if (line === null) return false;
    bubbleEl.textContent = fill(line, vars);
    bubbleEl.classList.remove('pop'); void bubbleEl.offsetWidth; bubbleEl.classList.add('pop');
    afterSay();
    return true;
  }
  // small talk: a topic picked in proportion to how many lines it has
  function chat(topics) {
    const have = topics.filter((k) => lines[k] && lines[k].length);
    let r = Math.random() * have.reduce((a, k) => a + lines[k].length, 0);
    for (const k of have) { r -= lines[k].length; if (r < 0) return say(k); }
    return have.length ? say(have[0]) : false;
  }
  // a line for somewhere other than the bubble (the rules sheet's margin)
  const line = (key, vars) => fill(pick(key) || '', vars);
  return { say, chat, line, has: (key) => !!(lines[key] && lines[key].length) };
}
