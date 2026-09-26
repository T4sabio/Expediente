const svg = inner => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none">${inner}</svg>`;
const S = 'stroke="currentColor" stroke-width="1.7"';

const ICONS = {
  grid: svg(`<rect x="3" y="3" width="8" height="8" rx="1.5" ${S}/><rect x="13" y="3" width="8" height="8" rx="1.5" ${S}/><rect x="3" y="13" width="8" height="8" rx="1.5" ${S}/><rect x="13" y="13" width="8" height="8" rx="1.5" ${S}/>`),
  pulse: svg(`<path d="M2 12h4l2 7 4-14 2 7h4l2-4 2 4h2" ${S} stroke-linecap="round" stroke-linejoin="round"/>`),
  pill: svg(`<rect x="3" y="9" width="18" height="6" rx="3" ${S}/><line x1="12" y1="9" x2="12" y2="15" ${S}/>`),
  flask: svg(`<path d="M9 3h6M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3" ${S} stroke-linecap="round" stroke-linejoin="round"/>`),
  chat: svg(`<path d="M4 4h16v12H8l-4 4V4Z" ${S} stroke-linejoin="round"/>`),
  dish: svg(`<circle cx="12" cy="12" r="9" ${S}/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="14" cy="13" r="1" fill="currentColor"/><circle cx="11" cy="15" r="1" fill="currentColor"/>`),
  check: svg(`<rect x="4" y="3" width="16" height="18" rx="2" ${S}/><path d="M8 11l3 3 5-6" ${S} stroke-linecap="round" stroke-linejoin="round"/>`)
};

export const icon = name => ICONS[name] ?? '';
