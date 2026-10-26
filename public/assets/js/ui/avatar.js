import { esc, initials } from '../core/utils.js';

export const ICONS = [
  '🦊', '🐼', '🐯', '🐸', '🦉', '🐙', '🦄', '🐧', '🐢', '🦋', '🐝', '🐬',
  '🦁', '🐨', '🐰', '🐻', '🦖', '🐳', '🦔', '🐞', '🌻', '⭐', '🚀', '🎨',
  '⚽', '🎸', '📚', '🔬', '🍎', '🌈', '🧩', '🎲', '🏀', '🛹', '🎧', '🪁',
  '🍉', '🍕', '🌵', '🪐', '🧸', '🦈', '🐿️', '🦜',
];

export const COLORS = [
  '#ffd84a', '#ff8fa3', '#7bdff2', '#b2f7a0', '#c8a2ff',
  '#ffb347', '#8ec5ff', '#f4a6d7', '#9be3c3', '#f5c2a0',
];

/** A round "sticker" avatar: the student's own photo, or an emoji (or initials) on a colour. */
export function avatar(student, size = 44) {
  if (student.photo) {
    return `<span class="avatar has-photo" style="--s:${size}px;--bg:${student.color || COLORS[0]}"><img class="av-photo" src="${esc(student.photo)}" alt="" draggable="false"></span>`;
  }
  const inner = student.icon && student.icon !== 'initials'
    ? `<span class="av-emoji">${student.icon}</span>`
    : `<span class="av-init">${esc(initials(student.name))}</span>`;
  return `<span class="avatar" style="--s:${size}px;--bg:${student.color || COLORS[0]}">${inner}</span>`;
}
