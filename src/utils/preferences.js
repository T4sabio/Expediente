const PREF_KEY = 'ronda.ui.preferences.v1';
const TIMELINE_PREFIX = 'ronda.timeline.read.v1';

const DEFAULTS = Object.freeze({ density: 'normal', highContrast: false, darkTheme: false });

function storage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function readUiPreferences() {
  const s = storage();
  if (!s) return { ...DEFAULTS };
  try {
    const value = JSON.parse(s.getItem(PREF_KEY) || '{}');
    return {
      density: ['compact', 'normal', 'comfortable'].includes(value.density) ? value.density : DEFAULTS.density,
      highContrast: Boolean(value.highContrast),
      darkTheme: Boolean(value.darkTheme)
    };
  } catch { return { ...DEFAULTS }; }
}

export function writeUiPreferences(patch) {
  const next = { ...readUiPreferences(), ...patch };
  const s = storage();
  try { s?.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* preference no crítica */ }
  return next;
}

function hashText(text) {
  let hash = 2166136261;
  for (const char of String(text ?? '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function timelineReadKey(userId, hc) {
  return `${TIMELINE_PREFIX}:${hashText(userId)}:${hashText(hc)}`;
}

export function getTimelineReadAt(userId, hc) {
  const s = storage();
  try {
    const value = Number(s?.getItem(timelineReadKey(userId, hc)) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch { return 0; }
}

export function markTimelineRead(userId, hc, at = Date.now()) {
  const timestamp = Number(at) || Date.now();
  try { storage()?.setItem(timelineReadKey(userId, hc), String(timestamp)); } catch { /* no crítico */ }
  return timestamp;
}

export function countTimelineUnread(events = [], readAt = 0) {
  const cutoff = Number(readAt) || 0;
  return events.filter(event => {
    const ts = new Date(event?.event_at ?? event?.eventAt ?? 0).getTime();
    return Number.isFinite(ts) && ts > cutoff;
  }).length;
}

export { DEFAULTS as UI_PREFERENCES_DEFAULTS };
