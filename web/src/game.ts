import type { CrystalKind } from './crystals';
import { TUNING } from './tuning';

// The level's rules: enclose meadow to grow forest; win when the forest covers the target share
// of the meadow, lose when dawn comes first. Crystals last the whole level and stack.

export type Status = 'playing' | 'won' | 'lost';

export class Game {
  status: Status = 'playing';
  elapsed = 0;
  private bonusTime = 0;
  readonly collected: Record<CrystalKind, number> = { swift: 0, calm: 0, time: 0 };

  get speed(): number { return TUNING.multipliers.swift ** this.collected.swift; }
  get wispSpeed(): number { return TUNING.multipliers.calm ** this.collected.calm; }
  get nightLength(): number { return TUNING.night.duration + this.bonusTime; }
  /** 0 at nightfall, 1 at dawn. */
  get night(): number { return Math.min(1, this.elapsed / this.nightLength); }

  collect(kind: CrystalKind): void {
    this.collected[kind]++;
    if (kind === 'time') this.bonusTime += TUNING.multipliers.time;
  }

  /** A wisp broke the trail: the night runs shorter. */
  penalise(): void {
    this.elapsed += TUNING.territory.shatterPenalty;
  }

  update(dt: number, claimedShare: number): void {
    if (this.status !== 'playing') return;
    this.elapsed += dt;
    if (claimedShare >= TUNING.level.target) this.status = 'won';
    else if (this.night >= 1) this.status = 'lost';
  }
}
