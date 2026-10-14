// Shared page state. Layers and panels subscribe instead of reaching into
// each other, so new ones can be added without touching the rest.

function store(initial) {
  const listeners = new Set();
  return {
    ...initial,
    update(fn = () => {}) {
      fn(this);
      for (const l of listeners) l(this);
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(this);
    },
  };
}

// Which lines and directions are switched on. A line that is off remembers
// its direction settings for when it comes back on.
export const view = store({
  lines: {}, // { "1 Line": true }
  dirs: {}, // { "1 Line": { "0": true, "1": true } }
  init(directions, lines) {
    for (const line of lines) {
      this.lines[line] = true;
      this.dirs[line] = Object.fromEntries(Object.keys(directions?.[line] || { 0: 1, 1: 1 }).map((d) => [d, true]));
    }
  },
  shown(line, dir) {
    return this.lines[line] !== false && this.dirs[line]?.[dir] !== false;
  },
  // ["1 Line|0", ...] — matches each map feature's `key` property.
  visibleKeys() {
    return Object.entries(this.dirs).flatMap(([line, dirs]) =>
      this.lines[line] ? Object.keys(dirs).filter((d) => dirs[d]).map((d) => `${line}|${d}`) : [],
    );
  },
});

// The latest /api/trains response.
export const liveFeed = store({ body: null });
