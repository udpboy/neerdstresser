// Simple per-endpoint cooldown wrapper to avoid spamming the backend.
// Ensures at least COOLDOWN_MS gap between fetch starts for the same path.
const COOLDOWN_MS = 3000;

if (typeof window !== "undefined" && !window.__FETCH_LIMITER_INSTALLED__) {
  window.__FETCH_LIMITER_INSTALLED__ = true;
  const originalFetch = window.fetch.bind(window);
  const lastCall = new Map();

  window.fetch = (...args) => {
    const target = args[0];
    let key = "unknown";
    try {
      const url = typeof target === "string" ? new URL(target, window.location.origin) : new URL(target.url);
      key = `${url.origin}${url.pathname}`;
    } catch {
      key = typeof target === "string" ? target : target?.url || "unknown";
    }
    const now = Date.now();
    const last = lastCall.get(key) || 0;
    const wait = Math.max(0, last + COOLDOWN_MS - now);
    lastCall.set(key, now + wait);

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        originalFetch(...args).then(resolve).catch(reject);
      }, wait);
    });
  };
}
