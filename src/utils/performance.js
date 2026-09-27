const measurements = [];

export function markPerformance(name) {
  try { globalThis.performance?.mark?.(name); } catch { /* browser sin Performance API completa */ }
}

export function measurePerformance(name, startMark, endMark = undefined) {
  try {
    const end = endMark ?? `${startMark}-end`;
    globalThis.performance?.mark?.(end);
    const entry = globalThis.performance?.measure?.(name, startMark, end);
    if (entry) {
      measurements.push({ name, duration: entry.duration, at: Date.now() });
      if (measurements.length > 100) measurements.shift();
      globalThis.dispatchEvent?.(new CustomEvent('ronda:performance', { detail: { ...measurements.at(-1) } }));
      return entry.duration;
    }
  } catch { /* medición no crítica */ }
  return null;
}

export function performanceSnapshot() {
  return measurements.map(item => ({ ...item }));
}
