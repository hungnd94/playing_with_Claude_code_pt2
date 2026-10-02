/**
 * Timeline layers: per-cell owner, culture and religion every TIMELINE_STEP
 * years, stored as keyframes every KEY_EVERY snapshots plus per-snapshot diffs.
 */
import type { LayerTimeline } from "./types";
import type { Sim } from "./sim";

export class LayerRecorder {
  private prev: Int32Array | null = null;
  constructor(readonly out: LayerTimeline, readonly keyEvery: number) {}

  record(cur: Int32Array, snap: number): void {
    if (snap % this.keyEvery === 0) this.out.keyframes.push(cur.slice());
    if (!this.prev) {
      this.out.diffCells.push(new Int32Array(0));
      this.out.diffValues.push(new Int32Array(0));
      this.prev = cur.slice();
      return;
    }
    const prev = this.prev;
    let k = 0;
    for (let i = 0; i < cur.length; i++) if (cur[i] !== prev[i]) k++;
    const cells = new Int32Array(k);
    const vals = new Int32Array(k);
    k = 0;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] !== prev[i]) {
        cells[k] = i;
        vals[k] = cur[i];
        prev[i] = cur[i];
        k++;
      }
    }
    this.out.diffCells.push(cells);
    this.out.diffValues.push(vals);
  }
}

export class TimelineRecorder {
  owner: LayerRecorder;
  culture: LayerRecorder;
  religion: LayerRecorder;
  constructor(private sim: Sim) {
    const t = sim.h.timeline;
    this.owner = new LayerRecorder(t.owner, t.keyEvery);
    this.culture = new LayerRecorder(t.culture, t.keyEvery);
    this.religion = new LayerRecorder(t.religion, t.keyEvery);
  }
  record(): void {
    const t = this.sim.h.timeline;
    const snap = t.snapshots;
    this.owner.record(this.sim.cellOwner, snap);
    this.culture.record(this.sim.cellCulture, snap);
    this.religion.record(this.sim.cellReligion, snap);
    t.snapshots++;
  }
}
