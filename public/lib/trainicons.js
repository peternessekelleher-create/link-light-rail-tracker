// Train marker icons with a crowding fill level: the marker fills from the
// bottom up (empty to full), in the line's color, so crowding never changes
// the color. Icons are drawn once per line and level (0..10) on a canvas.
//
//   live       circle, white outline (an arrow is a separate rotating layer)
//   simulated  rounded square, translucent, dashed line-color outline
const RATIO = 2;

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size * RATIO;
  const ctx = c.getContext('2d');
  ctx.scale(RATIO, RATIO);
  return { c, ctx };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

export function addLiveTrainIcons(map, colors) {
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
      map.addImage(`train:${line}:${lvl}`, ctx.getImageData(0, 0, size * RATIO, size * RATIO), { pixelRatio: RATIO });
    }
  }
  // Direction arrow, drawn on its own rotating layer above the body.
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

export function addSimTrainIcons(map, lines) {
  const size = 30;
  const box = 18;
  const x0 = (size - box) / 2;
  for (const { id, color } of lines) {
    for (let lvl = 0; lvl <= 10; lvl++) {
      const { ctx } = canvas(size);
      const shape = () => roundRect(ctx, x0, x0, box, box, 4);
      fillLevel(ctx, shape, x0, x0 + box, size, lvl / 10, color, 0.75);
      shape();
      ctx.lineWidth = 2.5;
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
      roundRect(ctx, x0 - 2, x0 - 2, box + 4, box + 4, 5);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
      map.addImage(`sim:${id}:${lvl}`, ctx.getImageData(0, 0, size * RATIO, size * RATIO), { pixelRatio: RATIO });
    }
  }
}
