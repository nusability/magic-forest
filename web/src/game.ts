import { TUNING } from './tuning';
import type { MultiplierKind } from './pickups';

// The level's rules: magic is gathered from orbs and spent sowing over the meadow; multipliers
// last the whole level and stack; the level is won when enough of the meadow is forest and lost
// when the blight has taken too much of it.

export type Status = 'playing' | 'won' | 'lost';

export class Game {
  status: Status = 'playing';
  magic: number = TUNING.magic.start;
  readonly collected: Record<MultiplierKind, number> = { bloom: 0, wings: 0, thrift: 0, well: 0 };

  private factor(kind: MultiplierKind): number {
    return TUNING.multipliers[kind] ** this.collected[kind];
  }

  /** Seeding and feeding strength of each sparkle. */
  get bloom(): number { return this.factor('bloom'); }
  /** How widely sparkles spread. */
  get spread(): number { return this.factor('wings'); }
  get capacity(): number { return TUNING.magic.capacity * this.factor('well'); }
  get drainPerSecond(): number { return TUNING.magic.drainPerSecond * this.factor('thrift'); }

  /** Spends the magic for dt seconds of sowing. Returns false when there was none. */
  sow(dt: number): boolean {
    if (this.status !== 'playing' || this.magic <= 0) return false;
    this.magic = Math.max(0, this.magic - this.drainPerSecond * dt);
    return true;
  }

  gather(amount: number): void {
    this.magic = Math.min(this.capacity, this.magic + amount);
  }

  collect(kind: MultiplierKind): void {
    this.collected[kind]++;
  }

  judge(forestShare: number, blightShare: number): void {
    if (this.status !== 'playing') return;
    if (forestShare >= TUNING.level.target) this.status = 'won';
    else if (blightShare >= TUNING.level.loseAt) this.status = 'lost';
  }
}
