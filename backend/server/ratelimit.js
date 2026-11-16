'use strict';

/** Small in-memory fixed-window limiter. Resets on restart (fine for one instance). */
class RateLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** Seconds until allowed again, or 0 if the key is not blocked. */
  retryAfter(key) {
    const e = this.hits.get(key);
    if (!e) return 0;
    const now = Date.now();
    if (e.resetAt <= now) {
      this.hits.delete(key);
      return 0;
    }
    return e.count >= this.max ? Math.ceil((e.resetAt - now) / 1000) : 0;
  }

  hit(key) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    if (this.hits.size > 10000) this.prune();
  }

  reset(key) {
    this.hits.delete(key);
  }

  prune() {
    const now = Date.now();
    for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
  }
}

module.exports = { RateLimiter };
