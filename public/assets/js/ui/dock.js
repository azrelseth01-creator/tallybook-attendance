// The floating music dock: always reachable, never in the way.
import * as store from '../core/store.js';
import { icon } from './icons.js';
import { toolbarHTML, bindToolbar, addFormHTML, bindAddForm, queueHTML, bindQueue } from './musicbar.js';

export function initDock() {
  const dock = document.getElementById('musicDock');
  dock.innerHTML = `
    <div class="dock-panel" id="dockPanel">
      <div class="dock-stage">
        <div id="ytWrap"><div id="ytHost"></div></div>
        <div id="spWrap"><div id="spHost"></div></div>
        <p class="dock-idle">Press play to start the music. The video or Spotify player appears here.</p>
      </div>
      ${addFormHTML()}
      ${queueHTML()}
      <p class="dock-note">Spotify plays full songs only when this browser is signed in to Spotify; otherwise it plays previews. YouTube volume is controlled here.</p>
    </div>
    <div class="dock-bar">
      ${toolbarHTML({ compact: true })}
      <button class="icon-btn dock-toggle" id="dockToggle" aria-expanded="false" aria-controls="dockPanel" aria-label="Show music queue">${icon('expand', 18)}</button>
    </div>`;
  bindToolbar(dock);
  bindAddForm(dock);
  bindQueue(dock);
  const toggle = dock.querySelector('#dockToggle');
  const set = (open) => {
    dock.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide music queue' : 'Show music queue');
    toggle.innerHTML = icon(open ? 'collapse' : 'expand', 18);
  };
  toggle.onclick = () => { const o = dock.dataset.open !== 'true'; set(o); store.setSetting('music.dockOpen', o); };
  set(false);
  apply();
}

/** Show or hide the dock based on the "music on" setting. */
export function apply() {
  const dock = document.getElementById('musicDock');
  dock.hidden = !store.getSetting('music.on') || !(store.getSetting('music.queue') || []).length;
}

export function openDock() {
  const dock = document.getElementById('musicDock');
  if (dock.hidden) return;
  if (dock.dataset.open !== 'true') dock.querySelector('#dockToggle').click();
}
