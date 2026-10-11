import type { CrystalKind } from './crystals';
import { TUNING } from './tuning';

// The level's rules: the bird always sows; crystals it collects last the whole level and stack;
// the level is won when enough of the meadow is forest and lost when the blight has taken too
// much of it.

export type Status = 'playing' | 'won' | 'lost';

export class Game {
  status: Status = 'playing';
  readonly collected: Record<CrystalKind, number> = { flow: 0, bloom: 0, wings: 0, swift: 0 };

  factor(kind: CrystalKind): number {
    return TUNING.multipliers[kind] ** this.collected[kind];
  }

  get totalCollected(): number {
    return Object.values(this.collected).reduce((a, b) => a + b, 0);
  }

  collect(kind: CrystalKind): void {
    this.collected[kind]++;
  }

  judge(forestShare: number, blightShare: number): void {
    if (this.status !== 'playing') return;
    if (forestShare >= TUNING.level.target) this.status = 'won';
    else if (blightShare >= TUNING.level.loseAt) this.status = 'lost';
  }
}
