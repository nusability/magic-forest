import * as THREE from 'three';

// A developer overlay, not game chrome: three quick taps in the top-right corner toggle a panel
// with frame rate, frame time, draw calls, triangles and counts. The choice is remembered.

const TRIPLE_TAP_WINDOW_MS = 700;
const INTERVAL_S = 0.5;
const STORAGE_KEY = 'magic-forest.stats';
const HOT_CORNER_PX = 72;

const CSS = `
  .stats-hot { position: fixed; top: 0; right: 0; width: ${HOT_CORNER_PX}px; height: ${HOT_CORNER_PX}px; z-index: 2; }
  .stats { position: fixed; top: calc(max(12px, env(safe-area-inset-top)) + ${HOT_CORNER_PX - 8}px);
    right: max(14px, env(safe-area-inset-right)); display: none; pointer-events: none; z-index: 1;
    font: 11px/1.45 ui-monospace, Menlo, monospace; color: #f3ecff; background: #000a; padding: 6px 9px;
    border-radius: 6px; white-space: pre; }
`;

export interface StatsSample {
  renderer: THREE.WebGLRenderer;
  plants: number;
  sparkles: number;
}

export class Stats {
  private readonly panel = document.createElement('div');
  private taps: number[] = [];
  private time = 0;
  private frames = 0;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.panel.className = 'stats';
    const hot = document.createElement('div');
    hot.className = 'stats-hot';
    hot.addEventListener('pointerdown', (e) => this.tap(e));
    document.body.append(this.panel, hot);
    this.setVisible(this.readPreference());
  }

  private get visible(): boolean {
    return this.panel.style.display === 'block';
  }

  private setVisible(show: boolean): void {
    this.panel.style.display = show ? 'block' : 'none';
  }

  private tap(e: PointerEvent): void {
    e.stopPropagation(); // a tap here never steers the bird
    const now = performance.now();
    this.taps = [...this.taps.filter((t) => now - t < TRIPLE_TAP_WINDOW_MS), now];
    if (this.taps.length < 3) return;
    this.taps = [];
    this.setVisible(!this.visible);
    try {
      localStorage.setItem(STORAGE_KEY, this.visible ? '1' : '0');
    } catch (err) {
      console.warn('Could not remember the stats toggle', err);
    }
  }

  private readPreference(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (err) {
      console.warn('Could not read the stats toggle', err);
      return false;
    }
  }

  /** Call once per frame after rendering. */
  frame(dt: number, s: StatsSample): void {
    this.time += dt;
    this.frames++;
    if (this.time < INTERVAL_S) return;
    if (this.visible) {
      const info = s.renderer.info;
      const canvas = s.renderer.domElement;
      this.panel.textContent = [
        `fps       ${(this.frames / this.time).toFixed(0)}`,
        `frame     ${((this.time / this.frames) * 1000).toFixed(1)} ms`,
        `draws     ${info.render.calls}`,
        `tris      ${(info.render.triangles / 1000).toFixed(0)}k`,
        `plants    ${s.plants}`,
        `sparkles  ${s.sparkles}`,
        `res       ${canvas.width}×${canvas.height} @${s.renderer.getPixelRatio()}x`,
      ].join('\n');
    }
    this.time = this.frames = 0;
  }
}
