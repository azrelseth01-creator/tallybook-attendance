// Custom profile pictures. The teacher picks an image (up to 10 MB), drags and zooms it inside a
// round window, and we save a small square copy (256 px JPEG, usually 10-30 KB) on the student.
// The original is never stored, so the book, backups and cloud sync stay small.
export const MAX_BYTES = 10 * 1024 * 1024;
export const OUT_SIZE = 256;
const VIEW = 190; // css px of the round crop window
const MAX_ZOOM = 4;

export const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Check the file and decode it. Throws an Error with a message that is safe to show. */
export async function readImage(file) {
  if (!file) throw new Error('No file was chosen.');
  if (file.size > MAX_BYTES) throw new Error(`That image is ${mb(file.size)}. Please choose one that is 10 MB or smaller.`);
  if (file.type && !file.type.startsWith('image/')) throw new Error('That file is not an image. Choose a JPG, PNG, WebP or GIF.');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('This browser could not open that image. Try a JPG, PNG or WebP (iPhone HEIC photos need to be saved as JPG first).'));
      img.src = url;
    });
  } catch (err) { URL.revokeObjectURL(url); throw err; }
  if (!img.naturalWidth || !img.naturalHeight) { URL.revokeObjectURL(url); throw new Error('That image looks empty.'); }
  return { img, url };
}

/**
 * Mounts a drag-and-zoom cropper into `host`.
 * onChange(dataUrl) fires after every adjustment with the 256 px square result.
 * Returns { destroy() }.
 */
export function mountCropper(host, { img, url }, onChange) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const base = VIEW / Math.min(w, h); // "cover" scale
  let zoom = 1;
  let ox = 0; // image centre, relative to the window centre (css px)
  let oy = 0;

  host.innerHTML = `
    <div class="crop">
      <div class="crop-win" style="--v:${VIEW}px" tabindex="0" role="group" aria-label="Photo position. Drag to move, or use the arrow keys.">
        <img class="crop-img" alt="" draggable="false" src="${url}">
      </div>
      <label class="crop-zoom"><span>Zoom</span><input type="range" min="1" max="${MAX_ZOOM}" step="0.01" value="1" aria-label="Zoom"></label>
      <p class="muted small">Drag the photo to centre the face. Slide to zoom.</p>
    </div>`;
  const win = host.querySelector('.crop-win');
  const el = host.querySelector('.crop-img');
  const range = host.querySelector('input[type=range]');

  const clampOffsets = () => {
    const s = base * zoom;
    const mx = Math.max(0, (w * s - VIEW) / 2);
    const my = Math.max(0, (h * s - VIEW) / 2);
    ox = Math.min(mx, Math.max(-mx, ox));
    oy = Math.min(my, Math.max(-my, oy));
  };
  const layout = () => {
    clampOffsets();
    const s = base * zoom;
    el.style.width = `${w * s}px`;
    el.style.height = `${h * s}px`;
    el.style.left = `${VIEW / 2 + ox - (w * s) / 2}px`;
    el.style.top = `${VIEW / 2 + oy - (h * s) / 2}px`;
  };

  let pending = 0;
  const emit = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => onChange(render()));
  };
  const render = () => {
    const s = base * zoom;
    const side = VIEW / s;
    const sx = w / 2 - ox / s - side / 2;
    const sy = h / 2 - oy / s - side / 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // JPEG has no transparency
    ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, OUT_SIZE, OUT_SIZE);
    return canvas.toDataURL('image/jpeg', 0.86);
  };

  let drag = null;
  win.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, ox, oy };
    win.setPointerCapture(e.pointerId);
    win.classList.add('grab');
  });
  win.addEventListener('pointermove', (e) => {
    if (!drag) return;
    ox = drag.ox + (e.clientX - drag.x);
    oy = drag.oy + (e.clientY - drag.y);
    layout(); emit();
  });
  const end = () => { drag = null; win.classList.remove('grab'); };
  win.addEventListener('pointerup', end);
  win.addEventListener('pointercancel', end);
  win.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 20 : 6;
    const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    ox += d[0]; oy += d[1];
    layout(); emit();
  });
  win.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.min(MAX_ZOOM, Math.max(1, zoom - e.deltaY * 0.002));
    range.value = String(zoom);
    layout(); emit();
  }, { passive: false });
  range.addEventListener('input', () => { zoom = Number(range.value); layout(); emit(); });

  layout();
  onChange(render());
  return { destroy() { cancelAnimationFrame(pending); URL.revokeObjectURL(url); host.innerHTML = ''; } };
}
