import type { Event } from '../types/index.js';

/**
 * A min-heap priority queue for events ordered by (time, seq) lexicographically.
 */
export class MinHeap<T extends Event> {
  private data: Event[] = [];

  get size(): number {
    return this.data.length;
  }

  get empty(): boolean {
    return this.data.length === 0;
  }

  private parent(i: number): number {
    return Math.floor((i - 1) / 2);
  }

  private leftChild(i: number): number {
    return 2 * i + 1;
  }

  private rightChild(i: number): number {
    return 2 * i + 2;
  }

  /** Lexicographic comparison of two events: first by time, then by seq. */
  private lessThan(a: Event, b: Event): boolean {
    if (a.time !== b.time) {
      return a.time < b.time;
    }
    return a.seq < b.seq;
  }

  private swap(i: number, j: number): void {
    const tmp = this.data[i];
    this.data[i] = this.data[j];
    this.data[j] = tmp;
  }

  /** Restore heap invariant upward from index i. */
  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = this.parent(i);
      if (this.lessThan(this.data[i], this.data[p])) {
        this.swap(i, p);
        i = p;
      } else {
        break;
      }
    }
  }

  /** Restore heap invariant downward from index i. */
  private bubbleDown(i: number): void {
    const n = this.data.length;
    while (true) {
      const left = this.leftChild(i);
      const right = this.rightChild(i);
      let smallest = i;

      if (left < n && this.lessThan(this.data[left], this.data[smallest])) {
        smallest = left;
      }
      if (right < n && this.lessThan(this.data[right], this.data[smallest])) {
        smallest = right;
      }

      if (smallest !== i) {
        this.swap(i, smallest);
        i = smallest;
      } else {
        break;
      }
    }
  }

  push(event: Event): void {
    this.data.push(event);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): Event | undefined {
    if (this.data.length === 0) {
      return undefined;
    }
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  peek(): Event | undefined {
    return this.data[0];
  }

  /** Returns a sorted copy of all elements (for snapshot serialization). */
  toArray(): Event[] {
    return [...this.data].sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      return a.seq - b.seq;
    });
  }

  clear(): void {
    this.data = [];
  }
}
