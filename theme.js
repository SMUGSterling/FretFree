'use strict';
// Sets the stored Theme and Dark paper on <html> before the first paint. The other scripts are deferred behind several
// MB of catalogs, so on a slow connection the page would show in the wrong theme until they arrive. This file loads
// without defer, ahead of the stylesheet, and only sets the two attributes; shared.js (applyTheme) then syncs the
// controls and follows the device. It runs before KEYS exists, so it names KEYS.theme and KEYS.darkPaper itself.
// An embedded score (#e=…) reads no storage, as in shared.js, so it follows the device.
(() => {
  if (/^#e=/.test(location.hash)) return;
  const read = key => {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch {
        return null;
      }
    },
    root = document.documentElement,
    theme = read('fretfree-theme');
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  if (read('fretfree-dark-paper') === true) root.dataset.paper = 'dark';
})();
