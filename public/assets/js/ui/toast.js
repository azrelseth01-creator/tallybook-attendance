import { esc } from '../core/utils.js';
import { icon } from './icons.js';

export function toast(message, { type = 'info', action, duration = 4600 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-msg">${esc(message)}</span>${action ? `<button class="toast-act" type="button">${esc(action.label)}</button>` : ''}<button class="toast-x" type="button" aria-label="Dismiss">${icon('x', 14)}</button>`;
  const close = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector('.toast-x').onclick = close;
  if (action) el.querySelector('.toast-act').onclick = () => { action.run(); close(); };
  host.append(el);
  while (host.children.length > 3) host.firstChild.remove();
  if (duration) setTimeout(close, duration);
  return close;
}
