/**
 * A virtual clock that tracks simulated time independently of wall-clock time.
 */
export class VirtualClock {
  private _time: number = 0;

  get time(): number {
    return this._time;
  }

  set time(value: number) {
    if (value < this._time) {
      throw new Error(`Virtual clock cannot go backward: ${value} < ${this._time}`);
    }
    this._time = value;
  }

  advance(toTime: number): void {
    this.time = toTime;
  }

  reset(): void {
    this._time = 0;
  }
}
