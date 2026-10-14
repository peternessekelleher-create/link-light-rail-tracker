// Train marker icons with a crowding fill level: the marker fills from the
// bottom up (empty to full), in the line's color, so crowding never changes
// the color. Icons are drawn once per line and level (0..10) on a canvas.
//
// Live and simulated trains share one design: a circle with a white outline,
// filled in the line's color; the direction arrow is a separate rotating
// layer. Simulated trains differ only in color (and a small "SIM" tag).
const RATIO = 2;

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size * RATIO;
  const ctx = c.getContext('2d');
  ctx.scale(RATIO, RATIO);
  return { c, ctx };
}

// Fill the current path's interior from the bottom to `level` (0..1).
function fillLevel(ctx, path, top, bottom, width, level, color, alpha) {
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = 'rgba(15,19,24,0.92)';
  ctx.fillRect(0, top, width, bottom - top);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const h = (bottom - top) * level;
  ctx.fillRect(0, bottom - h, width, h);
  ctx.restore();
}

export function addLiveTrainIcons(map, colors, prefix = 'train') {
  const size = 34;
  const r = 10;
  const mid = size / 2;
  const circle = (ctx, radius) => () => {
    ctx.beginPath();
    ctx.arc(mid, mid, radius, 0, Math.PI * 2);
  };
  for (const [line, color] of Object.entries(colors)) {
    for (let lvl = 0; lvl <= 10; lvl++) {
      const { ctx } = canvas(size);
      circle(ctx, r + 2.5)();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.stroke();
      fillLevel(ctx, circle(ctx, r), mid - r, mid + r, size, lvl / 10, color, 1);
      circle(ctx, r)();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      map.addImage(`${prefix}:${line}:${lvl}`, ctx.getImageData(0, 0, size * RATIO, size * RATIO), { pixelRatio: RATIO });
    }
  }
  // Direction arrow, drawn on its own rotating layer above the body.
  if (map.hasImage('train-arrow')) return;
  const { ctx } = canvas(size);
  ctx.beginPath();
  ctx.moveTo(mid, mid - 6);
  ctx.lineTo(mid + 5, mid + 4);
  ctx.lineTo(mid, mid + 1.5);
  ctx.lineTo(mid - 5, mid + 4);
  ctx.closePath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  map.addImage('train-arrow', ctx.getImageData(0, 0, size * RATIO, size * RATIO), { pixelRatio: RATIO });
}

// Simulated trains look exactly like live ones, in the project's color.
export function addSimTrainIcons(map, lines) {
  addLiveTrainIcons(map, Object.fromEntries(lines.map((l) => [l.id, l.color])), 'sim');
}
