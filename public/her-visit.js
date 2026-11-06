// Her visits, from her page. It starts once the mailbox knows she is signed in, and only keeps going if the server says
// it records this browser (never a stranger, never his devices). It counts the time the page is really on her screen
// (visible, and touched in the last 3 minutes) and where that time goes, sending it every 30 seconds, and it reports the
// taps only the page can see. Everything else (notes she opens, messages, games…) the server notes as it happens.
(() => {
  const idleAfterMs = 3 * 60 * 1000;
  const reportEveryMs = 30 * 1000;
  let started = false;
  let tracking = null; // null until the server answers
  let lastTouch = Date.now();
  let lastThemeTap = 0;
  let pending = { seconds: 0, areas: {} };
  let counter = null;
  let reporter = null;

  function stop() {
    window.clearInterval(counter);
    window.clearInterval(reporter);
    counter = null;
    reporter = null;
  }

  function send(body, keepalive = false) {
    return fetch('/api/her/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive })
      .then(response => response.json())
      .then(answer => {
        tracking = answer.tracking === true;
        if (!tracking) stop();
      })
      .catch(() => {});
  }

  // Where her eyes are: an open window first (an airplane, the mailbox, the wardrobe, a note), otherwise the part of
  // the page in the middle of the screen.
  function area() {
    const desk = document.querySelector('#plane-desk');
    if (desk && !desk.hidden) return 'plane';
    if (document.querySelector('#voice-modal')?.classList.contains('is-open')) return 'mailbox';
    if (document.querySelector('#wardrobe')?.classList.contains('is-open')) return 'wardrobe';
    if (document.querySelector('#message-modal')?.classList.contains('is-open')) return 'reading';
    const section = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest('.notes, .distraction, .voice-notes');
    if (section?.classList.contains('notes')) return 'notes';
    if (section?.classList.contains('distraction')) return 'distraction';
    if (section?.classList.contains('voice-notes')) return 'corner';
    return 'top';
  }

  function countSecond() {
    if (document.hidden || Date.now() - lastTouch > idleAfterMs) return;
    const where = area();
    pending.seconds += 1;
    pending.areas[where] = (pending.areas[where] || 0) + 1;
  }

  function flush(keepalive = false) {
    if (!pending.seconds || tracking === false) return;
    const body = pending;
    pending = { seconds: 0, areas: {} };
    send(body, keepalive);
  }

  function did(kind, detail = null) {
    if (tracking !== false) send({ did: kind, detail });
  }

  function start() {
    if (started) return;
    started = true;
    send({}).then(() => {
      if (!tracking) return;
      counter = window.setInterval(countSecond, 1000);
      reporter = window.setInterval(flush, reportEveryMs);
    });
  }

  window.addEventListener('mailbox:unread', start);
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(type => {
    window.addEventListener(type, () => { lastTouch = Date.now(); }, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush(true);
    else lastTouch = Date.now();
  });
  window.addEventListener('pagehide', () => flush(true));

  // Taps the server can't see.
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('#bunny')) did('bunny');
    else if (target.closest('#flower')) did('flower');
    else if (target.closest('#open-voice-notes')) did('mailbox');
    else if (target.closest('#wardrobe-toggle')) did('wardrobe');
    else if (target.closest('.wardrobe-item, #wardrobe-surprise')) did('outfit');
    else if (target.closest('#theme-toggle')) lastThemeTap = Date.now();
  }, true);

  // Night or day, when she switched it herself (not when it changes on its own with the time of day).
  new MutationObserver(() => {
    if (Date.now() - lastThemeTap < 3000) did('theme', document.documentElement.dataset.theme === 'night' ? 'night' : 'day');
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // The flower's secret, once it shows.
  const secret = document.querySelector('#flower-secret');
  if (secret) {
    new MutationObserver(() => { if (!secret.hidden) did('secret'); }).observe(secret, { attributes: true, attributeFilter: ['hidden'] });
  }

  // The note of the day, when it pops up by itself (notes she opens are noted by the server).
  const noteModal = document.querySelector('#message-modal');
  if (noteModal) {
    let wasOpen = false;
    new MutationObserver(() => {
      const open = noteModal.classList.contains('is-open');
      if (open && !wasOpen && noteModal.querySelector('.modal-label')?.textContent === 'a little welcome for you') {
        did('popup', noteModal.querySelector('#modal-message')?.textContent || '');
      }
      wasOpen = open;
    }).observe(noteModal, { attributes: true, attributeFilter: ['class'] });
  }
})();
