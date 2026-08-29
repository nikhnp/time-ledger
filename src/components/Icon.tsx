'use client'
/* Hand-rolled outline icon set (feather-style, currentColor, 1.8 stroke). No emoji, no icon fonts. */

const ICONS: Record<string, string> = {
  spark: '<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2.1 5-5 2.1 2.1-5 5-2.1z"/>',
  bars: '<path d="M4.5 20v-5M10 20V6M15.5 20v-9M21 20V9"/><path d="M2.5 20h19"/>',
  gauge: '<path d="M4.5 19a8.5 8.5 0 1 1 15 0"/><path d="M12 14.5L15.5 9"/><circle cx="12" cy="14.5" r="1"/>',
  waves: '<path d="M2 12c2.2-3 4.3-3 6.5 0s4.3 3 6.5 0 4.3-3 6 0"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8.2 12.4l2.6 2.6 5-5.6"/>',
  box: '<rect x="3.5" y="4" width="17" height="5" rx="1"/><path d="M5.5 9v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
  pie: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9h9"/>',
  activity: '<path d="M2 12h4l3-8 5 16 3-8h5"/>',
  file: '<path d="M6 3h8.5L20 8.5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v6h6"/><path d="M9 13h6M9 17h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"/>',
  columns: '<rect x="3" y="4" width="4.5" height="16" rx="1"/><rect x="9.75" y="4" width="4.5" height="16" rx="1"/><rect x="16.5" y="4" width="4.5" height="16" rx="1"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7.5l9 6 9-6"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>',
  house: '<path d="M3 11l9-8 9 8"/><path d="M5.5 9.5V20h13V9.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4"/><path d="M17.5 13.8c2.3.9 4 3.1 4 5.7"/>',
  dots: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M8.5 21h7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  paste: '<rect x="5" y="7" width="14" height="14" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M9 11.5h6"/>',
  pencil: '<path d="M12.5 20.5h8"/><path d="M16.8 3.7a2.1 2.1 0 0 1 3 3L7.5 19l-4 1 1-4L16.8 3.7z"/>',
  clock: '<circle cx="12" cy="12.5" r="8.5"/><path d="M12 8v4.5l3 2.5"/><path d="M9.5 2.5h5"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15L6 16z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5c4-2 6.5 2 10.5 0V12c-4 2-6.5-2-10.5 0"/>',
  flame: '<path d="M12 2.5c.8 3.5-3 5-3 9a3 3 0 0 0 6 0c0-1.2-.6-2.2-1.2-3 2.4 1 4.2 3.2 4.2 5.8a5.5 5.5 0 0 1-11 0c0-5 4.2-7 5-11.8z"/>',
  zap: '<path d="M13 2 4.5 13.5H10L9 22l8.5-11.5H12L13 2z"/>',
  alert: '<path d="M12 3.5 21.5 20h-19L12 3.5z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.8 7.2l2.6 1.5M16.6 15.3l2.6 1.5M4.8 16.8l2.6-1.5M16.6 8.7l2.6-1.5"/>',
  chevL: '<path d="M14.5 6 8.5 12l6 6"/>',
  chevR: '<path d="M9.5 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 7.7-8 9-4.6-1.3-8-4.5-8-9V6z"/>',
  'caret-down': '<path d="M6 9l6 6 6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>',
  calplus: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M12 13v5M9.5 15.5h5"/>',
  cycle: '<path d="M4 12a8 8 0 0 1 14-5.3L20 8.5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15.5"/><path d="M20 4v4.5h-4.5M4 20v-4.5h4.5"/>',
  download: '<path d="M12 3v12"/><path d="M7 10.5l5 5 5-5"/><path d="M4 20.5h16"/>',
  upload: '<path d="M12 15V3"/><path d="M7 7.5l5-5 5 5"/><path d="M4 20.5h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
}

export function I({ name, size }: { name: string; size?: number }) {
  return (
    <svg
      className="oi"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={size ? { width: size, height: size } : undefined}
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }}
    />
  )
}
