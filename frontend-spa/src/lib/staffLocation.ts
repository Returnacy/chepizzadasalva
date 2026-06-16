// Per-device record of which location a staff member is working at "today".
// Drives per-location stamp attribution under a BRAND-scoped (shared) wallet:
// the chosen location id rides on every stamp the staff applies that day.
// Free daily selection — re-prompted on the first action of each new day.

const KEY_ID = 'staffSelectedBusinessId';
const KEY_NAME = 'staffSelectedLocationName';
const KEY_DATE = 'staffLocationSelectionDate';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export type SelectedLocation = { id: string; name: string };

// The selection is only valid for the day it was made; a stale (yesterday's)
// selection is treated as absent so staff are re-prompted.
export function getSelectedLocation(): SelectedLocation | null {
  try {
    const id = localStorage.getItem(KEY_ID);
    const date = localStorage.getItem(KEY_DATE);
    if (!id || date !== todayKey()) return null;
    return { id, name: localStorage.getItem(KEY_NAME) || '' };
  } catch {
    return null;
  }
}

export function setSelectedLocation(id: string, name: string): void {
  try {
    localStorage.setItem(KEY_ID, id);
    localStorage.setItem(KEY_NAME, name);
    localStorage.setItem(KEY_DATE, todayKey());
  } catch {
    /* localStorage unavailable — selection just won't persist */
  }
}

export function clearSelectedLocation(): void {
  try {
    localStorage.removeItem(KEY_ID);
    localStorage.removeItem(KEY_NAME);
    localStorage.removeItem(KEY_DATE);
  } catch {
    /* no-op */
  }
}
