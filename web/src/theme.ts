// Light / dark theme. The initial theme is applied to <html data-theme>
// by the inline boot script in index.html before React mounts; this module
// just reads and updates it.

export type Theme = 'dark' | 'light';

const KEY = 'lp-theme';

/** The theme currently applied to the document. */
export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Switch the theme and remember the choice. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode — the choice just won't persist */
  }
}
