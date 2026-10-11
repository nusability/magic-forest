import * as THREE from 'three';
import { MULTIPLIER_INFO, type MultiplierKind } from './pickups';
import type { Game } from './game';
import { TUNING } from './tuning';

// The heads-up display: how much of the meadow is forest (and how close that is to the goal),
// how much the blight has taken, the bird's magic, the multipliers held, short toasts, and the
// end-of-level banner. Three quick taps in the top-right corner toggle a stats panel.

const TRIPLE_TAP_WINDOW_MS = 700;
const TOAST_MS = 2600;
const STATS_INTERVAL_S = 0.5;
const STATS_KEY = 'magic-forest.stats';

const CSS = `
  .hud { position: fixed; inset: 0; pointer-events: none; font: 600 13px/1.2 system-ui, -apple-system, sans-serif;
    color: #f3ecff; text-shadow: 0 1px 3px #0008; padding: max(12px, env(safe-area-inset-top)) max(14px, env(safe-area-inset-right))
    max(14px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left)); }
  .meters { width: min(58vw, 260px); display: grid; gap: 8px; }
  .meter-label { display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 12px; opacity: .9; }
  .bar { position: relative; height: 8px; border-radius: 4px; background: #ffffff1f; overflow: hidden; }
  .fill { position: absolute; inset: 0 auto 0 0; border-radius: 4px; transition: width .25s; }
  .forest .fill { background: linear-gradient(90deg, #2fd9a0, #9effc8); box-shadow: 0 0 10px #4fffc0; }
  .blight .fill { background: linear-gradient(90deg, #5a1f8a, #b04cff); }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px; }
  .chip { padding: 2px 7px; border-radius: 9px; font-size: 11px; background: #0006; border: 1px solid currentColor; }
  .magic { position: absolute; left: 50%; transform: translateX(-50%); bottom: max(18px, env(safe-area-inset-bottom));
    width: min(70vw, 320px); text-align: center; }
  .magic .bar { height: 10px; border-radius: 5px; }
  .magic .fill { background: linear-gradient(90deg, #ffb84d, #fff1b0); box-shadow: 0 0 12px #ffd56e; }
  .hint { margin-top: 6px; font-size: 12px; opacity: .85; min-height: 1.2em; }
  .toast { position: absolute; left: 50%; top: 26%; transform: translateX(-50%); font-size: 17px; text-align: center;
    opacity: 0; transition: opacity .35s; white-space: nowrap; }
  .toast small { display: block; font-size: 12px; font-weight: 500; opacity: .85; }
  .banner { position: absolute; inset: 0; display: none; place-items: center; background: #05031a99; pointer-events: auto; }
  .banner div { text-align: center; font-size: 26px; }
  .banner button { margin-top: 18px; font: inherit; font-size: 16px; color: #140b2e; background: #f3ecff; border: 0;
    border-radius: 22px; padding: 10px 22px; }
  .hot { position: absolute; top: 0; right: 0; width: 72px; height: 72px; pointer-events: auto; }
  .stats { position: absolute; top: calc(max(12px, env(safe-area-inset-top)) + 64px); right: max(14px, env(safe-area-inset-right));
    display: none; font: 11px/1.45 ui-monospace, Menlo, monospace; background: #000a; padding: 6px 9px; border-radius: 6px;
    white-space: pre; text-shadow: none; }
`;

export interface Stats {
  renderer: THREE.WebGLRenderer;
  plants: number;
  sparkles: number;
}

export class Hud {
  private readonly root = document.createElement('div');
  private readonly forestFill: HTMLElement;
  private readonly forestText: HTMLElement;
  private readonly blightFill: HTMLElement;
  private readonly blightText: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly magicFill: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly stats: HTMLElement;
  private toastTimer = 0;
  private taps: number[] = [];
  private statsTime = 0;
  private statsFrames = 0;
  private chipsKey = '';

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="meters">
        <div class="forest"><div class="meter-label"><span>Forest</span><span data-forest-text></span></div>
          <div class="bar"><div class="fill" data-forest></div></div></div>
        <div class="blight"><div class="meter-label"><span>Blight</span><span data-blight-text></span></div>
          <div class="bar"><div class="fill" data-blight></div></div></div>
        <div class="chips" data-chips></div>
      </div>
      <div class="magic"><div class="meter-label"><span>Magic</span></div>
        <div class="bar"><div class="fill" data-magic></div></div><div class="hint" data-hint></div></div>
      <div class="toast" data-toast></div>
      <div class="banner" data-banner><div><span data-banner-text></span><br><button data-again>Play again</button></div></div>
      <div class="stats" data-stats></div>
      <div class="hot" data-hot></div>`;
    document.body.appendChild(this.root);
    const q = (sel: string): HTMLElement => {
      const el = this.root.querySelector<HTMLElement>(`[data-${sel}]`);
      if (!el) throw new Error(`HUD element ${sel} missing`);
      return el;
    };
    this.forestFill = q('forest');
    this.forestText = q('forest-text');
    this.blightFill = q('blight');
    this.blightText = q('blight-text');
    this.chips = q('chips');
    this.magicFill = q('magic');
    this.hint = q('hint');
    this.toastEl = q('toast');
    this.banner = q('banner');
    this.stats = q('stats');
    q('again').addEventListener('click', () => location.reload());
    q('hot').addEventListener('pointerdown', (e) => this.hotTap(e));
    this.setStatsVisible(this.readStatsPreference());
  }

  private hotTap(e: PointerEvent): void {
    e.stopPropagation();
    const now = performance.now();
    this.taps = [...this.taps.filter((t) => now - t < TRIPLE_TAP_WINDOW_MS), now];
    if (this.taps.length >= 3) {
      this.taps = [];
      const show = this.stats.style.display !== 'block';
      this.setStatsVisible(show);
      try {
        localStorage.setItem(STATS_KEY, show ? '1' : '0');
      } catch (err) {
        console.warn('Could not remember the stats toggle', err);
      }
    }
  }

  private readStatsPreference(): boolean {
    try {
      return localStorage.getItem(STATS_KEY) === '1';
    } catch (err) {
      console.warn('Could not read the stats toggle', err);
      return false;
    }
  }

  private setStatsVisible(show: boolean): void {
    this.stats.style.display = show ? 'block' : 'none';
  }

  toast(title: string, detail: string, color: string): void {
    this.toastEl.innerHTML = `<span style="color:${color}">${title}</span><small>${detail}</small>`;
    this.toastEl.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.style.opacity = '0'), TOAST_MS);
  }

  multiplierToast(kind: MultiplierKind): void {
    const info = MULTIPLIER_INFO[kind];
    this.toast(`${info.name} ×${TUNING.multipliers[kind]}`, info.blurb, `#${info.color.toString(16).padStart(6, '0')}`);
  }

  update(game: Game, forestShare: number, blightShare: number, sowing: boolean, overMeadow: boolean): void {
    const pct = (x: number): string => `${Math.round(x * 100)}%`;
    this.forestFill.style.width = pct(Math.min(1, forestShare / TUNING.level.target));
    this.forestText.textContent = `${pct(forestShare)} of ${pct(TUNING.level.target)}`;
    this.blightFill.style.width = pct(Math.min(1, blightShare / TUNING.level.loseAt));
    this.blightText.textContent = `${pct(blightShare)} of ${pct(TUNING.level.loseAt)}`;
    this.magicFill.style.width = pct(game.magic / game.capacity);
    this.hint.textContent = sowing ? ''
      : game.magic <= 0 ? 'Out of magic: fly to the golden lights'
      : overMeadow ? '' : 'Fly over the meadow to sow';

    const key = JSON.stringify(game.collected);
    if (key !== this.chipsKey) {
      this.chipsKey = key;
      this.chips.innerHTML = (Object.keys(game.collected) as MultiplierKind[])
        .filter((k) => game.collected[k] > 0)
        .map((k) => {
          const info = MULTIPLIER_INFO[k];
          const factor = (TUNING.multipliers[k] ** game.collected[k]).toFixed(2).replace(/\.?0+$/, '');
          return `<span class="chip" style="color:#${info.color.toString(16).padStart(6, '0')}">${info.name} ×${factor}</span>`;
        })
        .join('');
    }

    if (game.status !== 'playing' && this.banner.style.display !== 'grid') {
      this.banner.style.display = 'grid';
      const text = this.root.querySelector('[data-banner-text]');
      if (!text) throw new Error('HUD banner text missing');
      text.textContent = game.status === 'won' ? 'The forest holds. You win!' : 'The blight has taken the meadow.';
    }
  }

  /** Call once per frame after rendering. */
  frame(dt: number, s: Stats): void {
    this.statsTime += dt;
    this.statsFrames++;
    if (this.statsTime < STATS_INTERVAL_S || this.stats.style.display !== 'block') {
      if (this.statsTime >= STATS_INTERVAL_S) this.statsTime = this.statsFrames = 0;
      return;
    }
    const info = s.renderer.info;
    const canvas = s.renderer.domElement;
    this.stats.textContent = [
      `fps       ${(this.statsFrames / this.statsTime).toFixed(0)}`,
      `frame     ${((this.statsTime / this.statsFrames) * 1000).toFixed(1)} ms`,
      `draws     ${info.render.calls}`,
      `tris      ${(info.render.triangles / 1000).toFixed(0)}k`,
      `plants    ${s.plants}`,
      `sparkles  ${s.sparkles}`,
      `res       ${canvas.width}×${canvas.height} @${s.renderer.getPixelRatio()}x`,
    ].join('\n');
    this.statsTime = this.statsFrames = 0;
  }
}
