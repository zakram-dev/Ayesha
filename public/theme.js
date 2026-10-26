// Loaded in <head> so the right theme is set before the page paints (no flash of day colours at night).
(() => {
  const overrideKey = 'ayesha-theme-override';
  const nightStartHour = 19;
  const nightEndHour = 6;
  let memoryOverride = null;

  function isNightAt(date) {
    const hour = date.getHours();
    return hour >= nightStartHour || hour < nightEndHour;
  }

  function nextAutomaticSwitch(date) {
    const next = new Date(date);
    next.setMinutes(0, 0, 0);
    const hour = date.getHours();
    if (hour < nightEndHour) next.setHours(nightEndHour);
    else if (hour < nightStartHour) next.setHours(nightStartHour);
    else {
      next.setDate(next.getDate() + 1);
      next.setHours(nightEndHour);
    }
    return next.getTime();
  }

  function readOverride() {
    let override = memoryOverride;
    try {
      override = JSON.parse(localStorage.getItem(overrideKey) || 'null') || memoryOverride;
    } catch (error) {
      // Storage can be blocked (private mode); fall back to the in-memory choice.
    }
    return override && override.until > Date.now() ? override.theme : null;
  }

  function current() {
    return readOverride() || (isNightAt(new Date()) ? 'night' : 'day');
  }

  function apply() {
    const theme = current();
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'night' ? '#170f1c' : '#fffaf7');
    return theme;
  }

  // A manual choice lasts until the next automatic switch (6am or 7pm), then the clock takes over again.
  function toggle() {
    memoryOverride = { theme: current() === 'night' ? 'day' : 'night', until: nextAutomaticSwitch(new Date()) };
    try {
      localStorage.setItem(overrideKey, JSON.stringify(memoryOverride));
    } catch (error) {
      // Keep the in-memory choice for this visit.
    }
    return apply();
  }

  window.ayeshaTheme = { apply, toggle, current };
  apply();
})();
