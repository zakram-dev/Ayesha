// The bunny stickers for the mailbox chat: the same soft white bunny as on the page, in six little poses.
// Shared by her mailbox and the admin chat. Ids must match bunnyStickers in server.js.
(() => {
  const ink = '#3c2432';
  const line = '#e3c0ce';
  const idPrefix = `sticker-${Math.random().toString(36).slice(2, 8)}`;
  let drawn = 0;

  const stickers = [
    { id: 'wave', name: 'hi!' },
    { id: 'heart', name: 'for you' },
    { id: 'hug', name: 'hug' },
    { id: 'blush', name: 'shy' },
    { id: 'yay', name: 'yay!' },
    { id: 'sleepy', name: 'sleepy' }
  ];

  const eyes = {
    open: `<ellipse cx="52" cy="57" rx="2.5" ry="3.1" fill="${ink}" /><ellipse cx="68" cy="57" rx="2.5" ry="3.1" fill="${ink}" /><circle cx="53" cy="55.6" r="1" fill="#fff" /><circle cx="69" cy="55.6" r="1" fill="#fff" />`,
    happy: `<path d="M48.5 58.5q3.5-4 7 0M64.5 58.5q3.5-4 7 0" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" />`,
    sleep: `<path d="M48.5 57q3.5 3.2 7 0M64.5 57q3.5 3.2 7 0" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" />`,
    squint: `<path d="M49 54.6l5 2.8-5 2.8M71 54.6l-5 2.8 5 2.8" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />`
  };

  const mouths = {
    smile: `<path d="M57 66.5q1.5 2 3 0q1.5 2 3 0" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round" />`,
    grin: `<path d="M55.5 66.2q4.5 6.5 9 0z" fill="#c2456b" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round" />`,
    snore: '<ellipse cx="60" cy="68" rx="1.6" ry="2" fill="#c2456b" />',
    tiny: `<path d="M58.4 67q1.6 1.5 3.2 0" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round" />`
  };

  const cheeks = {
    soft: '<ellipse cx="45" cy="64" rx="5.2" ry="3.6" fill="#f29ab5" opacity=".55" /><ellipse cx="75" cy="64" rx="5.2" ry="3.6" fill="#f29ab5" opacity=".55" />',
    rosy: '<ellipse cx="45" cy="64" rx="7" ry="4.6" fill="#f29ab5" opacity=".85" /><ellipse cx="75" cy="64" rx="7" ry="4.6" fill="#f29ab5" opacity=".85" />'
      + '<path d="M42 62l-1.8 3M45.5 62l-1.8 3M49 62l-1.8 3M72 62l-1.8 3M75.5 62l-1.8 3M79 62l-1.8 3" stroke="#d9607f" stroke-width="1.1" stroke-linecap="round" />'
  };

  function paw(fur, cx, cy, rx, ry, angle, extraClass = '') {
    return `<ellipse${extraClass ? ` class="${extraClass}"` : ''} cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${angle} ${cx} ${cy})" fill="${fur}" stroke="${line}" stroke-width="1.1" />`;
  }

  function heart(x, y, scale, fill = '#e8577e') {
    return `<path transform="translate(${x} ${y}) scale(${scale})" d="M0 4.2C-3.4 1.9-5 .3-5-1.6c0-1.4 1-2.5 2.4-2.5 1.1 0 1.9.6 2.6 1.6.7-1 1.5-1.6 2.6-1.6 1.4 0 2.4 1.1 2.4 2.5 0 1.9-1.6 3.5-5 5.8z" fill="${fill}" />`;
  }

  function sparkle(x, y, size) {
    return `<path d="M${x} ${y - size}Q${x} ${y} ${x + size} ${y}Q${x} ${y} ${x} ${y + size}Q${x} ${y} ${x - size} ${y}Q${x} ${y} ${x} ${y - size}z" fill="#f6c453" />`;
  }

  // Each pose: ear tilt, face, paws (drawn in front) and any little extras around the bunny.
  const poses = {
    wave: fur => ({
      face: eyes.open + cheeks.soft + mouths.smile,
      paws: paw(fur, 42, 92, 6, 8.5, 15)
        + `<g class="st-wave">${paw(fur, 87, 67, 6.2, 9.2, 28)}<path d="M97 51q4 5 2.5 11M102.5 46q6 7 3.5 16" fill="none" stroke="#f29ab5" stroke-width="2" stroke-linecap="round" /></g>`
    }),
    heart: fur => ({
      face: eyes.happy + cheeks.soft + mouths.smile,
      paws: '<path d="M60 107c-9.6-6.6-15.2-11.6-15.2-17.4 0-4.1 3.1-7.2 7.1-7.2 3.3 0 5.7 1.8 8.1 4.8 2.4-3 4.8-4.8 8.1-4.8 4 0 7.1 3.1 7.1 7.2 0 5.8-5.6 10.8-15.2 17.4z" fill="#e8577e" stroke="#c2456b" stroke-width="1.2" />'
        + '<ellipse cx="53" cy="87.5" rx="2.6" ry="1.6" transform="rotate(-35 53 87.5)" fill="#fff" opacity=".7" />'
        + paw(fur, 44.5, 93, 5.5, 7.5, 25) + paw(fur, 75.5, 93, 5.5, 7.5, -25)
    }),
    hug: fur => ({
      face: eyes.happy + cheeks.soft + mouths.smile,
      paws: paw(fur, 29, 85, 11, 6.2, -12) + paw(fur, 91, 85, 11, 6.2, 12),
      extras: heart(60, 13, 1.2) + heart(30, 24, .8, '#f29ab5') + heart(90, 24, .8, '#f29ab5')
    }),
    blush: fur => ({
      face: eyes.squint + cheeks.rosy + mouths.tiny,
      paws: paw(fur, 38.5, 72, 5.6, 7.6, 22) + paw(fur, 81.5, 72, 5.6, 7.6, -22),
      extras: heart(92, 34, .9, '#f29ab5') + heart(100, 45, .6, '#f29ab5')
    }),
    yay: fur => ({
      face: eyes.happy + cheeks.soft + mouths.grin,
      paws: paw(fur, 33, 66, 6, 9, -30) + paw(fur, 87, 66, 6, 9, 30),
      extras: sparkle(20, 42, 5) + sparkle(100, 40, 6) + sparkle(28, 22, 3.5) + sparkle(93, 20, 3.5)
    }),
    sleepy: fur => ({
      ears: [-34, 34],
      face: eyes.sleep + cheeks.soft + mouths.snore,
      paws: paw(fur, 42, 92, 6, 8.5, 15) + paw(fur, 78, 92, 6, 8.5, -15),
      extras: '<path d="M55 23h5l-5 6h5M63 9h8l-8 9.5h8" fill="none" stroke="#a88ad8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />'
    })
  };

  function svg(id) {
    const pose = poses[id];
    const sticker = stickers.find(entry => entry.id === id);
    if (!pose || !sticker) return '';
    // Gradient ids must be unique on the page, since many stickers can show at once.
    drawn += 1;
    const furId = `${idPrefix}-fur-${drawn}`;
    const earId = `${idPrefix}-ear-${drawn}`;
    const fur = `url(#${furId})`;
    const { ears = [0, 0], face, paws, extras = '' } = pose(fur);
    const ear = (x, angle) => `<g transform="rotate(${angle} ${x} 46)"><ellipse cx="${x}" cy="27" rx="8" ry="20" fill="${fur}" stroke="${line}" stroke-width="1.1" /><ellipse cx="${x}" cy="29" rx="3.6" ry="13.5" fill="url(#${earId})" /></g>`;
    return `<svg class="bunny-sticker sticker-${id}" viewBox="0 0 120 120" role="img" aria-label="bunny sticker: ${sticker.name}">
      <defs>
        <radialGradient id="${furId}" cx=".38" cy=".3" r=".85"><stop offset="0" stop-color="#ffffff" /><stop offset=".6" stop-color="#fff4f0" /><stop offset="1" stop-color="#eed7e0" /></radialGradient>
        <radialGradient id="${earId}" cx=".5" cy=".3" r=".75"><stop offset="0" stop-color="#fcdbe5" /><stop offset="1" stop-color="#ee9fb7" /></radialGradient>
      </defs>
      <ellipse cx="60" cy="114" rx="30" ry="4.5" fill="#5c2c43" opacity=".12" />
      ${ear(47, ears[0])}${ear(73, ears[1])}
      <ellipse cx="60" cy="94" rx="27" ry="20" fill="${fur}" stroke="${line}" stroke-width="1.1" />
      <ellipse cx="60" cy="98" rx="15.5" ry="12" fill="#fffdfb" opacity=".85" />
      <ellipse cx="47" cy="111" rx="8.5" ry="4.6" fill="${fur}" stroke="${line}" stroke-width="1.1" />
      <ellipse cx="73" cy="111" rx="8.5" ry="4.6" fill="${fur}" stroke="${line}" stroke-width="1.1" />
      <circle cx="60" cy="58" r="23" fill="${fur}" stroke="${line}" stroke-width="1.1" />
      <ellipse cx="50" cy="46" rx="8" ry="4.3" transform="rotate(-30 50 46)" fill="#fff" opacity=".6" />
      ${face}
      <ellipse cx="60" cy="63.5" rx="2.2" ry="1.6" fill="#e88aab" />
      ${paws}${extras}
    </svg>`;
  }

  // A small line drawing of a bunny face, for the button that opens the stickers.
  const icon = '<svg class="sticker-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9.6C7.4 8.3 6.6 6 6.9 3.6c.2-1.5 1.4-1.9 2.3-.9 1.1 1.3 1.6 3.6 1.4 6M15 9.6c1.6-1.3 2.4-3.6 2.1-6-.2-1.5-1.4-1.9-2.3-.9-1.1 1.3-1.6 3.6-1.4 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /><circle cx="12" cy="15" r="6.6" fill="none" stroke="currentColor" stroke-width="1.6" /><circle cx="9.7" cy="14.4" r="1" fill="currentColor" /><circle cx="14.3" cy="14.4" r="1" fill="currentColor" /><path d="M11 17.3q1 .9 2 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg>';

  window.BunnyStickers = { list: stickers, svg, icon };
})();
