import { describe, it, expect } from 'vitest';
import { MinHeap } from '../src/engine/MinHeap.ts';
import type { Event } from '../src/types/index.ts';

function makeEvent(time: number, seq: number, type = 'test', nodeId = 0): Event {
  return { type, nodeId, time, seq };
}

describe('MinHeap', () => {
  describe('push/pop', () => {
    it('should be empty initially', () => {
      const heap = new MinHeap<Event>();
      expect(heap.empty).toBe(true);
      expect(heap.size).toBe(0);
    });

    it('should pop in priority order (by time)', () => {
      const heap = new MinHeap<Event>();
      heap.push(makeEvent(10, 3));
      heap.push(makeEvent(5, 1));
      heap.push(makeEvent(7, 2));

      expect(heap.pop()?.time).toBe(5);
      expect(heap.pop()?.time).toBe(7);
      expect(heap.pop()?.time).toBe(10);
      expect(heap.pop()).toBeUndefined();
    });

    it('should pop in seq order for same-time ties', () => {
      const heap = new MinHeap<Event>();
      heap.push(makeEvent(5, 3));
      heap.push(makeEvent(5, 1));
      heap.push(makeEvent(5, 2));

      expect(heap.pop()?.seq).toBe(1);
      expect(heap.pop()?.seq).toBe(2);
      expect(heap.pop()?.seq).toBe(3);
    });

    it('should handle single element', () => {
      const heap = new MinHeap<Event>();
      heap.push(makeEvent(1, 1));
      expect(heap.pop()?.time).toBe(1);
      expect(heap.empty).toBe(true);
    });

    it('should return undefined when popping an empty heap', () => {
      const heap = new MinHeap<Event>();
      expect(heap.pop()).toBeUndefined();
    });
  });

  describe('peek', () => {
    it('should return min without removing', () => {
      const heap = new MinHeap<Event>();
      heap.push(makeEvent(10, 2));
      heap.push(makeEvent(5, 1));

      expect(heap.peek()?.time).toBe(5);
      expect(heap.peek()?.seq).toBe(1);
      expect(heap.size).toBe(2); // not removed
    });

    it('should return undefined on empty peek', () => {
      const heap = new MinHeap<Event>();
      expect(heap.peek()).toBeUndefined();
    });
  });

  describe('large-scale ordering', () => {
    it('should correctly order 100 events', () => {
      const heap = new MinHeap<Event>();
      const shuffled: Event[] = [];
      for (let i = 0; i < 100; i++) {
        shuffled.push(makeEvent(Math.floor(Math.random() * 1000), i));
      }
      for (const e of shuffled) heap.push(e);

      let prevTime = -1;
      let prevSeq = -1;
      for (let i = 0; i < 100; i++) {
        const e = heap.pop()!;
        expect(e.time).toBeGreaterThanOrEqual(prevTime);
        if (e.time === prevTime) {
          expect(e.seq).toBeGreaterThan(prevSeq);
        }
        prevTime = e.time;
        prevSeq = e.seq;
      }
    });

    it('should preserve tie-breaking with many same-time events', () => {
      const heap = new MinHeap<Event>();
      for (let i = 5; i >= 1; i--) {
        heap.push(makeEvent(42, i));
      }
      for (let i = 1; i <= 5; i++) {
        expect(heap.pop()?.seq).toBe(i);
      }
    });
  });

  describe('toArray', () => {
    it('should return sorted copy without mutating heap', () => {
      const heap = new MinHeap<Event>();
      heap.push(makeEvent(3, 2));
      heap.push(makeEvent(1, 1));
      heap.push(makeEvent(2, 3));

      const arr = heap.toArray();
      expect(arr.map((e) => e.time)).toEqual([1, 2, 3]);
      // Internal heap is still valid for further ops
      expect(heap.pop()?.time).toBe(1);
    });
  });

  describe('clear', () => {
    it('should empty the heap completely', () => {
      const heap = new MinHeap<Event>();
      heap.push(makeEvent(1, 1));
      heap.push(makeEvent(2, 2));
      heap.clear();
      expect(heap.empty).toBe(true);
      expect(heap.pop()).toBeUndefined();
    });
  });
});
