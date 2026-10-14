// "How this works" panel: data/HOW_IT_WORKS.md (reach and other methods,
// with sources) followed by data/METHODS.md (how the ST3 station points were
// derived), rendered with marked, which loads only when the panel first opens.
const MARKED = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';

export function setupMethods() {
  const el = document.getElementById('methods');
  const body = el.querySelector('[data-body]');
  let loaded = null;
  let opener = null;

  const load = async () => {
    const [{ marked }, how, stations] = await Promise.all([
      import(MARKED),
      fetch('/data/HOW_IT_WORKS.md').then((r) => r.text()),
      fetch('/data/METHODS.md').then((r) => r.text()),
    ]);
    // Both files are ours (committed in the repo), not user input.
    body.innerHTML = marked.parse(how) + '<hr>' + marked.parse(stations);
    for (const a of body.querySelectorAll('a[href^="http"]')) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
  };

  const open = () => {
    opener = document.activeElement;
    el.hidden = false;
    el.querySelector('[data-close-methods]').focus();
    loaded ||= load().catch((err) => {
      console.error(err);
      loaded = null;
      body.innerHTML = '<p class="error-text">Couldn\'t load the methods.</p>';
    });
  };
  const close = () => {
    if (el.hidden) return;
    el.hidden = true;
    opener?.focus?.();
  };
  for (const b of document.querySelectorAll('[data-open-methods]')) b.addEventListener('click', open);
  el.querySelector('[data-close-methods]').addEventListener('click', close);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
}
