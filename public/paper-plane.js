// Paper airplanes, on her page. From the card with his status (it only shows once she is signed in) she writes one
// little line, folds it and flicks it off the screen; it lands in the mailbox with a buzz on his phone. His airplanes
// fly in by themselves, land in the corner, and unfold when she taps them.
(() => {
  const throwButton = document.querySelector('#throw-plane');
  if (!throwButton) return;
  const maxLength = 140; // the same as planeMaxLength in server.js
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const touchScreen = window.matchMedia('(hover: none)');
  const foldMs = () => (reducedMotion.matches ? 0 : 1100);
  const statusSent = document.querySelector('#status-sent');

  document.body.insertAdjacentHTML('beforeend', `
    <div class="plane-desk" id="plane-desk" role="dialog" aria-modal="true" aria-labelledby="plane-desk-title" hidden>
      <div class="plane-stage">
        <p class="plane-desk-title" id="plane-desk-title"></p>
        <div class="plane-carrier">
          <div class="plane-paper">
            <textarea maxlength="${maxLength}" placeholder="write one little line…" aria-label="What your paper airplane says"></textarea>
            <p class="plane-words"></p>
            <span class="plane-flap is-left" aria-hidden="true"></span><span class="plane-flap is-right" aria-hidden="true"></span>
          </div>
        </div>
        <p class="plane-hint" role="status" aria-live="polite"></p>
        <div class="plane-actions">
          <button class="primary-btn" type="button" data-plane="main"></button>
          <button class="text-btn" type="button" data-plane="other"></button>
        </div>
      </div>
    </div>
    <button class="plane-landed" id="plane-landed" type="button" hidden>
      <span class="plane-float"><span class="plane-dart" aria-hidden="true"></span></span>
      <span class="plane-landed-note">for you ✈︎</span>
      <b class="plane-landed-count" hidden></b>
    </button>`);

  const desk = document.querySelector('#plane-desk');
  const title = desk.querySelector('.plane-desk-title');
  const carrier = desk.querySelector('.plane-carrier');
  const paper = desk.querySelector('.plane-paper');
  const textBox = paper.querySelector('textarea');
  const words = paper.querySelector('.plane-words');
  const hint = desk.querySelector('.plane-hint');
  const mainButton = desk.querySelector('[data-plane="main"]');
  const otherButton = desk.querySelector('[data-plane="other"]');
  const landedButton = document.querySelector('#plane-landed');
  const dart = landedButton.querySelector('.plane-dart');
  const landedCount = landedButton.querySelector('.plane-landed-count');
  let stepTimer = null;
  let closeTimer = null;
  let drag = null;
  let landed = null; // his airplane waiting in the corner: { id, text }
  let waiting = [];
  let openedFrom = throwButton;

  // What each moment of the desk says, and what its two buttons do.
  const states = {
    write: { title: 'a paper airplane ✈︎', main: 'fold it ✈︎', other: 'not now' },
    folding: { title: 'a paper airplane ✈︎' },
    ready: { title: 'a paper airplane ✈︎', main: 'throw ✈︎', other: 'unfold' },
    flying: {},
    unfolding: { title: 'a paper airplane landed ✈︎' },
    read: { title: 'a paper airplane landed ✈︎', main: 'throw one back ✈︎', other: 'keep it ♡' }
  };

  function writingHint() {
    const left = maxLength - textBox.value.length;
    return left <= 30 ? `${left} left` : 'write one little line, then fold it';
  }

  function setState(state) {
    const copy = states[state];
    desk.dataset.state = state;
    title.textContent = copy.title || '';
    mainButton.hidden = !copy.main;
    otherButton.hidden = !copy.other;
    mainButton.textContent = copy.main || '';
    otherButton.textContent = copy.other || '';
    const writing = state === 'write';
    textBox.readOnly = !writing;
    textBox.tabIndex = writing ? 0 : -1;
    if (state === 'write') hint.textContent = writingHint();
    else if (state === 'ready') hint.textContent = touchScreen.matches ? 'flick it up to throw ✈︎' : 'drag it up and let go, or tap throw';
    else hint.textContent = '';
    mainButton.disabled = writing && !textBox.value.trim();
  }

  function after(ms, step) {
    window.clearTimeout(stepTimer);
    stepTimer = window.setTimeout(step, ms);
  }

  function resetCarrier() {
    carrier.getAnimations().forEach(animation => animation.cancel());
    carrier.classList.remove('snap-back');
    carrier.style.transform = '';
  }

  function showPaper({ folded = false, text = null } = {}) {
    resetCarrier();
    paper.classList.remove('is-folded', 'is-unfolding');
    if (folded) paper.classList.add('is-folded');
    textBox.hidden = text !== null;
    words.hidden = text === null;
    words.textContent = text || '';
  }

  function openDesk() {
    window.clearTimeout(closeTimer);
    desk.hidden = false;
    document.body.classList.add('plane-desk-open');
    window.requestAnimationFrame(() => desk.classList.add('is-open'));
  }

  function closeDesk() {
    const state = desk.dataset.state;
    if (desk.hidden || state === 'folding' || state === 'unfolding') return;
    window.clearTimeout(stepTimer);
    desk.classList.remove('is-open');
    document.body.classList.remove('plane-desk-open');
    closeTimer = window.setTimeout(() => {
      desk.hidden = true;
      showPaper();
      if (openedFrom?.isConnected && !openedFrom.hidden) openedFrom.focus({ preventScroll: true });
      // Another of his may be waiting its turn.
      window.setTimeout(checkPlanes, 900);
    }, 260);
  }

  function startWriting() {
    showPaper();
    setState('write');
    openDesk();
    window.setTimeout(() => textBox.focus({ preventScroll: true }), 80);
  }

  function fold() {
    if (!textBox.value.trim()) return;
    textBox.blur();
    setState('folding');
    paper.classList.add('is-folded');
    after(foldMs(), () => setState('ready'));
  }

  // The same folds, backwards: her own airplane opens to be changed, his opens to be read (after a moment, so she
  // sees it folded first).
  function unfoldPaper(next, { delayed = false } = {}) {
    setState('unfolding');
    resetCarrier();
    paper.classList.remove('is-folded');
    paper.classList.toggle('is-delayed', delayed && !reducedMotion.matches);
    void paper.offsetWidth;
    paper.classList.add('is-unfolding');
    after(foldMs() + (paper.classList.contains('is-delayed') ? 450 : 0), () => {
      paper.classList.remove('is-unfolding', 'is-delayed');
      next();
    });
  }

  // ---- Flying: a smooth path through a few points, at an even speed, nose first, with a dotted trail behind it.
  function catmullRom(p0, p1, p2, p3, t) {
    const along = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
    return { x: along(p0.x, p1.x, p2.x, p3.x), y: along(p0.y, p1.y, p2.y, p3.y) };
  }

  function flightFrames(points, { scaleFrom = 1, scaleTo = 1, turn = 0 } = {}) {
    const padded = [points[0], ...points, points.at(-1)];
    const samples = [];
    for (let index = 1; index < padded.length - 2; index += 1) {
      for (let step = 0; step < 14; step += 1) samples.push(catmullRom(padded[index - 1], padded[index], padded[index + 1], padded[index + 2], step / 14));
    }
    samples.push(points.at(-1));
    let distance = 0;
    const distances = samples.map((point, index) => (distance += index ? Math.hypot(point.x - samples[index - 1].x, point.y - samples[index - 1].y) : 0));
    // The nose points the way it is going (0° is straight up); angles are kept continuous so it never spins backwards.
    let angle = null;
    const frames = samples.map((point, index) => {
      const before = samples[Math.max(0, index - 1)];
      const next = samples[Math.min(samples.length - 1, index + 1)];
      const heading = Math.atan2(next.x - before.x, before.y - next.y) * 180 / Math.PI;
      if (angle === null) angle = heading;
      else angle += ((heading - angle + 540) % 360) - 180;
      const offset = distance ? distances[index] / distance : index / (samples.length - 1);
      const scale = scaleFrom + (scaleTo - scaleFrom) * offset;
      return { offset, transform: `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) rotate(${(angle + turn).toFixed(1)}deg) scale(${scale.toFixed(3)})` };
    });
    return { frames, endAngle: angle + turn };
  }

  function dropTrail(target, animation) {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      if (count < 3 || count % 2) return;
      const box = target.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (x < -20 || y < -20 || x > window.innerWidth + 20 || y > window.innerHeight + 20) return;
      const dot = document.createElement('span');
      dot.className = 'plane-trail';
      dot.style.left = `${x.toFixed(1)}px`;
      dot.style.top = `${y.toFixed(1)}px`;
      dot.addEventListener('animationend', () => dot.remove());
      document.body.append(dot);
    }, 34);
    animation.finished.catch(() => {}).finally(() => window.clearInterval(timer));
  }

  function fly(element, points, duration, { trailFrom = element, ...options } = {}) {
    if (reducedMotion.matches || !element.animate) {
      return element.animate
        ? element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished.catch(() => {})
        : Promise.resolve();
    }
    const animation = element.animate(flightFrames(points, options).frames, { duration, easing: 'cubic-bezier(.3,.15,.7,1)', fill: 'forwards' });
    dropTrail(trailFrom, animation);
    return animation.finished.catch(() => {});
  }

  // Her throw: up, one loop to the side, and away off the top of the screen.
  function throwPath(from) {
    const unit = Math.min(1.15, Math.max(0.7, Math.min(window.innerWidth, window.innerHeight) / 620));
    const loop = [[0, -110], [40, -200], [120, -220], [170, -150], [120, -85], [55, -115], [40, -220], [120, -430]]
      .map(([x, y]) => ({ x: from.x * 0.4 + x * unit, y: Math.min(from.y, 0) + y * unit }));
    return [from, ...loop, { x: window.innerWidth * 0.6, y: -window.innerHeight - 260 }];
  }

  async function throwPlane(from = { x: 0, y: 0 }) {
    if (desk.dataset.state !== 'ready') return;
    const line = textBox.value.trim();
    setState('flying');
    const sent = fetch('/api/voice/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plane: line })
    }).then(async response => {
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'it did not fly, try again?');
    });
    sent.catch(() => {});
    await fly(carrier, throwPath(from), 2300, { trailFrom: paper, scaleTo: 0.55 });
    try {
      await sent;
    } catch (error) {
      // It came back: the line is still there to try again.
      showPaper();
      setState('write');
      hint.textContent = error.message === 'Failed to fetch' ? 'it did not fly, try again?' : error.message;
      return;
    }
    textBox.value = '';
    closeDesk();
    if (statusSent) statusSent.textContent = 'landed ♡';
  }

  // Drag the folded airplane and let go going up to throw it; anything else and it drifts back.
  carrier.addEventListener('pointerdown', event => {
    if (desk.dataset.state !== 'ready') return;
    event.preventDefault();
    carrier.setPointerCapture(event.pointerId);
    carrier.classList.remove('snap-back');
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, moves: [{ y: event.clientY, time: event.timeStamp }] };
  });
  carrier.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.dx = event.clientX - drag.x;
    drag.dy = event.clientY - drag.y;
    drag.moves = [...drag.moves.filter(move => event.timeStamp - move.time < 120), { y: event.clientY, time: event.timeStamp }];
    carrier.style.transform = `translate(${drag.dx.toFixed(1)}px, ${drag.dy.toFixed(1)}px) rotate(${(drag.dx * 0.12).toFixed(1)}deg)`;
  });
  function letGo(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { dx, dy, moves } = drag;
    drag = null;
    const first = moves[0];
    const speed = event.timeStamp > first.time ? (event.clientY - first.y) / (event.timeStamp - first.time) : 0; // px per ms; up is negative
    if (dy < -70 || (dy < -20 && speed < -0.45)) {
      carrier.style.transform = '';
      throwPlane({ x: dx, y: dy });
      return;
    }
    carrier.classList.add('snap-back');
    carrier.style.transform = '';
  }
  carrier.addEventListener('pointerup', letGo);
  carrier.addEventListener('pointercancel', letGo);

  // ---- His airplanes: one at a time, it flies in, loops once and lands in the corner; tap it to unfold.
  function showCount() {
    const more = waiting.filter(plane => plane.id !== landed?.id).length;
    landedCount.hidden = !more;
    landedCount.textContent = more ? `+${more}` : '';
  }

  function settle(angle) {
    dart.getAnimations().forEach(animation => animation.cancel());
    dart.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    landedButton.classList.add('is-resting');
  }

  function flyIn(plane) {
    landed = plane;
    landedButton.hidden = false;
    landedButton.classList.remove('is-resting');
    landedButton.setAttribute('aria-label', 'A paper airplane landed for you. Tap to unfold it');
    showCount();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const r = Math.min(width, height) * 0.13;
    const cx = -width * 0.5;
    const cy = -height * 0.45;
    const points = [
      { x: -width - 140, y: cy + r * 0.3 }, { x: cx - r * 1.7, y: cy + r }, { x: cx, y: cy + r }, { x: cx + r, y: cy },
      { x: cx, y: cy - r }, { x: cx - r, y: cy }, { x: cx + r * 0.3, y: cy + r * 1.1 }, { x: -width * 0.22, y: -60 },
      { x: -80, y: -10 }, { x: 0, y: 0 }
    ];
    const { frames, endAngle } = flightFrames(points);
    const restAngle = endAngle % 360;
    if (reducedMotion.matches || !dart.animate) {
      settle(restAngle);
      window.dispatchEvent(new CustomEvent('plane:landed'));
      return;
    }
    const animation = dart.animate(frames, { duration: 2800, easing: 'ease-out', fill: 'forwards' });
    dropTrail(dart, animation);
    animation.finished.then(() => {
      settle(restAngle);
      window.dispatchEvent(new CustomEvent('plane:landed'));
    }).catch(() => {});
  }

  function clearLanded() {
    landed = null;
    landedButton.hidden = true;
    landedButton.classList.remove('is-resting');
    dart.getAnimations().forEach(animation => animation.cancel());
  }

  async function checkPlanes() {
    if (document.hidden) return;
    try {
      const response = await fetch('/api/voice/planes');
      if (!response.ok) return;
      waiting = await response.json();
    } catch (error) {
      return;
    }
    // One opened somewhere else (in the mailbox, or on another phone) no longer waits here.
    if (landed && !waiting.some(plane => plane.id === landed.id)) clearLanded();
    showCount();
    if (!landed && waiting.length && desk.hidden && !document.querySelector('.modal.is-open')) flyIn(waiting[0]);
  }

  landedButton.addEventListener('click', () => {
    if (!landed || !landedButton.classList.contains('is-resting')) return;
    const plane = landed;
    clearLanded();
    waiting = waiting.filter(entry => entry.id !== plane.id);
    openedFrom = throwButton;
    showPaper({ text: plane.text });
    openDesk();
    unfoldPaper(() => {
      setState('read');
      mainButton.focus({ preventScroll: true });
    }, { delayed: true });
    fetch(`/api/voice/messages/${plane.id}/unfold`, { method: 'POST' }).catch(() => {});
  });

  mainButton.addEventListener('click', () => {
    const state = desk.dataset.state;
    if (state === 'write') fold();
    else if (state === 'ready') throwPlane();
    else if (state === 'read') {
      showPaper();
      setState('write');
      textBox.focus({ preventScroll: true });
    }
  });
  otherButton.addEventListener('click', () => {
    if (desk.dataset.state === 'ready') {
      unfoldPaper(() => {
        setState('write');
        textBox.focus({ preventScroll: true });
      });
    } else {
      closeDesk();
    }
  });
  textBox.addEventListener('input', () => {
    hint.textContent = writingHint();
    mainButton.disabled = !textBox.value.trim();
  });
  throwButton.addEventListener('click', () => {
    openedFrom = throwButton;
    if (desk.hidden) startWriting();
  });
  desk.addEventListener('click', event => {
    if (event.target === desk && ['write', 'ready', 'read'].includes(desk.dataset.state)) closeDesk();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !desk.hidden && ['write', 'ready', 'read'].includes(desk.dataset.state)) closeDesk();
  });

  // The mailbox checks in about every 45 seconds while the page is open, and on load once she is signed in.
  window.addEventListener('mailbox:unread', checkPlanes);
  window.addEventListener('plane:unfolded', checkPlanes);
})();
