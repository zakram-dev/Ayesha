// Shared by her voice corner (public page) and the admin Voice notes tab:
// recording in the browser, playing notes back, and the chat thread (reactions, replies, unsend, stickers).
(() => {
  // Ask for AAC in MP4 first: it is what iPhones record and every browser can play. Plain 'audio/mp4'
  // makes Chrome use Opus inside MP4, which older iPhones may not play, so it only comes after.
  const preferredTypes = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  const maxRecordingMs = 2 * 60 * 1000;
  // Matches unsendMinutes in server.js; the server has the final say.
  const unsendMs = 5 * 60 * 1000;
  const doubleTapMs = 320;
  const swipeToReplyPx = 56;
  // The emoji either of you can react with (the same list is in server.js); a double-tap is the first one.
  const reactions = ['❤️', '😂', '🥰', '🥺', '😮', '😢'];
  const trashIcon = '<svg class="trash-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 7V4.8c0-.4.4-.8.8-.8h3.4c.4 0 .8.4.8.8V7M6.5 7l.9 12.2c.1 1 .8 1.8 1.8 1.8h5.6c1 0 1.7-.8 1.8-1.8L17.5 7M10.2 10.5v6.5M13.8 10.5v6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.round((ms || 0) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  // Saved times come from SQLite as "YYYY-MM-DD HH:MM:SS" in UTC; a full ISO time (with T and a zone) is read as it is.
  function parseWhen(createdAt) {
    return new Date(createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`);
  }

  function formatWhen(createdAt) {
    return parseWhen(createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // A short line about a message, for the "replying to" bar.
  function previewOf(message) {
    if (message.sticker) return 'a bunny sticker';
    if (message.kind === 'voice') return `voice note · ${formatDuration(message.durationMs)}`;
    const text = message.text || '';
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  }

  function replayClass(element, className) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  async function startRecording(onTick) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = preferredTypes.find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const startedAt = Date.now();
    const timer = window.setInterval(() => onTick(Date.now() - startedAt), 200);
    recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
    const finished = new Promise(resolve => recorder.addEventListener('stop', () => {
      window.clearInterval(timer);
      stream.getTracks().forEach(track => track.stop());
      const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
      resolve({ blob: new Blob(chunks, { type }), type, durationMs: Math.min(Date.now() - startedAt, maxRecordingMs) });
    }));
    recorder.start(250);
    return () => {
      if (recorder.state !== 'inactive') recorder.stop();
      return finished;
    };
  }

  // One shared player per page: tapping a note plays it, tapping another stops the first.
  function attachPlayer(container, { onPlay } = {}) {
    let current = null;

    function reset(entry) {
      entry.button.textContent = '▶';
      entry.button.setAttribute('aria-label', 'Play voice note');
      entry.bar.style.width = '0%';
    }

    container.addEventListener('click', event => {
      const button = event.target.closest('.voice-play');
      if (!button) return;
      if (current?.button === button) {
        if (current.audio.paused) current.audio.play();
        else current.audio.pause();
        return;
      }
      if (current) {
        current.audio.pause();
        reset(current);
      }
      const entry = {
        button,
        bar: button.parentElement.querySelector('.voice-progress i'),
        audio: new Audio(button.dataset.src),
        durationMs: Number(button.dataset.duration)
      };
      current = entry;
      entry.audio.addEventListener('play', () => {
        button.textContent = '❚❚';
        button.setAttribute('aria-label', 'Pause voice note');
        onPlay?.(button);
      });
      entry.audio.addEventListener('pause', () => { button.textContent = '▶'; button.setAttribute('aria-label', 'Play voice note'); });
      entry.audio.addEventListener('timeupdate', () => {
        const total = Number.isFinite(entry.audio.duration) && entry.audio.duration > 0 ? entry.audio.duration * 1000 : entry.durationMs;
        entry.bar.style.width = `${Math.min(100, (entry.audio.currentTime * 1000 / total) * 100)}%`;
      });
      entry.audio.addEventListener('ended', () => {
        reset(entry);
        if (current === entry) current = null;
      });
      entry.audio.play().catch(() => {
        reset(entry);
        button.closest('.voice-message')?.classList.add('voice-unplayable');
      });
    });

    return {
      stop() {
        if (!current) return;
        current.audio.pause();
        reset(current);
        current = null;
      }
    };
  }

  // A sticker carries its reaction on the bunny itself; a bubble carries it on its corner.
  function messageBody(message, reaction) {
    if (message.sticker && window.BunnyStickers) return `<div class="voice-sticker">${window.BunnyStickers.svg(message.sticker)}${reaction}</div>`;
    if (message.kind === 'voice') {
      return `<div class="voice-clip">
          <button class="voice-play" type="button" data-src="${escapeHtml(message.audioUrl)}" data-duration="${message.durationMs}" aria-label="Play voice note">▶</button>
          <span class="voice-progress"><i></i></span>
          <small class="voice-time">${formatDuration(message.durationMs)}</small>
        </div>`;
    }
    return `<p>${escapeHtml(message.text)}</p>`;
  }

  // Draws the thread. It only redraws when something changed, so a voice note keeps playing and an open
  // message stays open while the thread checks for news. Returns whether it redrew.
  function renderThread(container, messages, { me, names }) {
    const key = JSON.stringify(messages);
    if (container.dataset.rendered && container.lastThreadKey === key) return false;
    const reactionsBefore = container.reactionsShown || new Map();
    container.reactionsShown = new Map(messages.filter(message => message.reaction).map(message => [message.id, message.reaction]));
    container.lastThreadKey = key;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    container.innerHTML = messages.length
      ? messages.map(message => {
        const mine = message.sender === me;
        const reply = message.replyTo
          ? (message.replyTo.gone
            ? '<p class="voice-reply-quote is-gone">↩ a message that’s no longer here</p>'
            : `<button class="voice-reply-quote" type="button" data-jump="${message.replyTo.id}"><small>↩ ${escapeHtml(names[message.replyTo.sender])}</small><span>${escapeHtml(message.replyTo.preview)}</span></button>`)
          : '';
        // A comment on one of the sealed notes shows that note above it.
        const note = message.note
          ? `<blockquote class="voice-note-quote"><small>about the note</small><span>${escapeHtml(message.note)}</span></blockquote>`
          : '';
        const seen = mine ? (message.kind === 'voice' && message.playedAt ? 'listened ✓' : message.readAt ? 'seen ✓' : '') : '';
        // A new or changed reaction pops in; the rest just sit there.
        const isNew = container.dataset.rendered && reactionsBefore.get(message.id) !== message.reaction;
        const reaction = message.reaction
          ? `<span class="voice-reaction${isNew ? ' pop' : ''}" role="img" aria-label="reacted ${escapeHtml(message.reaction)}">${escapeHtml(message.reaction)}</span>`
          : '';
        return `<article class="voice-message ${mine ? 'mine' : 'theirs'}${message.sticker ? ' is-sticker' : ''}${message.reaction ? ' has-reaction' : ''}" data-id="${message.id}" tabindex="0">
          <small class="voice-meta">${escapeHtml(names[message.sender])} · ${escapeHtml(formatWhen(message.createdAt))}</small>
          ${reply}${note}${message.sticker ? messageBody(message, reaction) : messageBody(message, '') + reaction}
          ${seen ? `<div class="voice-foot"><small class="voice-seen">${seen}</small></div>` : ''}
        </article>`;
      }).join('')
      : '<p class="voice-empty">No notes yet. Say hello ✦</p>';
    if (nearBottom || !container.dataset.rendered) container.scrollTop = container.scrollHeight;
    container.dataset.rendered = 'true';
    return true;
  }

  // The thread with everything you can do to a message: tap for react / reply / unsend, double-tap for ❤️,
  // swipe right to reply, tap a quote to jump to the message it answers.
  function mountThread(container, { me, names, react, played, unsend, remove, onReply, refresh, onError = window.alert }) {
    let messages = [];
    let selectedId = null;
    let tapTimer = null;
    let armTimer = null;
    let lastTap = { id: null, time: 0 };
    let swipe = null;
    let ignoreClickUntil = 0;
    const playedIds = new Set();
    const byId = id => messages.find(message => message.id === Number(id));
    const articleFor = id => container.querySelector(`.voice-message[data-id="${Number(id)}"]`);

    const player = attachPlayer(container, {
      // The first time a voice note from the other one is played, they see "listened ✓".
      onPlay(button) {
        const message = byId(button.closest('.voice-message')?.dataset.id);
        if (!message || message.sender === me || message.playedAt || playedIds.has(message.id)) return;
        playedIds.add(message.id);
        played(message.id).catch(() => playedIds.delete(message.id));
      }
    });

    function render(list) {
      messages = list;
      const redrew = renderThread(container, list, { me, names });
      if (redrew && selectedId) openActions(articleFor(selectedId));
    }

    function closeActions() {
      window.clearTimeout(armTimer);
      container.querySelector('.voice-actions')?.remove();
      container.querySelector('.voice-message.is-selected')?.classList.remove('is-selected');
      selectedId = null;
    }

    function openActions(article) {
      closeActions();
      const message = article && byId(article.dataset.id);
      if (!message) return;
      const theirs = message.sender !== me;
      const canUnsend = !theirs && unsend && Date.now() - parseWhen(message.createdAt).getTime() < unsendMs;
      // The trash can sits apart on the far side, so it is hard to hit by accident.
      const trash = canUnsend ? 'unsend' : remove ? 'delete' : '';
      const buttons = [
        theirs && react
          ? `<button class="voice-react-open" type="button" data-act="react" aria-label="React with an emoji">${message.reaction ? escapeHtml(message.reaction) : '+'}</button>`
          : '',
        onReply ? '<button type="button" data-act="reply">↩ reply</button>' : '',
        trash ? `<button class="voice-trash" type="button" data-act="${trash}" aria-label="${trash === 'unsend' ? 'Unsend this message' : 'Delete this message'}" title="${trash}">${trashIcon}</button>` : ''
      ].join('');
      if (!buttons) return;
      article.insertAdjacentHTML('beforeend', `<div class="voice-actions" role="toolbar" aria-label="Message options">${buttons}</div>`);
      article.classList.add('is-selected');
      selectedId = message.id;
      article.querySelector('.voice-actions').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    async function setReaction(message, reaction) {
      // Show it straight away; the next check brings the saved state.
      render(messages.map(entry => (entry.id === message.id ? { ...entry, reaction } : entry)));
      try {
        await react(message.id, reaction);
      } catch (error) {
        onError(error.message);
      }
      refresh();
    }

    // "+" opens the emoji in place of the options; the one already chosen is marked, and tapping it again takes it away.
    function showReactionPicker(article, message) {
      const row = article.querySelector('.voice-actions');
      row.classList.add('is-picking');
      row.setAttribute('aria-label', 'Pick a reaction');
      row.innerHTML = reactions.map(emoji => `<button class="voice-react-choice${emoji === message.reaction ? ' is-current' : ''}" type="button" data-react="${emoji}" aria-label="${emoji === message.reaction ? `Take away ${emoji}` : `React ${emoji}`}">${emoji}</button>`).join('');
      row.querySelector('button').focus({ preventScroll: true });
    }

    function startReply(message) {
      closeActions();
      onReply({ id: message.id, who: message.sender === me ? 'yourself' : names[message.sender], preview: previewOf(message) });
    }

    // A double-tap is a quick ❤️ (it never replaces a reaction already chosen).
    function loveByDoubleTap(article) {
      const message = byId(article.dataset.id);
      if (!message || message.sender === me || !react) return;
      window.getSelection()?.removeAllRanges();
      if (message.reaction) {
        const shown = article.querySelector('.voice-reaction');
        if (shown) replayClass(shown, 'pop');
        return;
      }
      const burst = document.createElement('span');
      burst.className = 'voice-heart-burst';
      burst.textContent = '♥';
      burst.addEventListener('animationend', () => burst.remove());
      article.append(burst);
      setReaction(message, reactions[0]);
    }

    async function runAction(action, article) {
      const message = byId(article.dataset.id);
      if (!message) return;
      if (action === 'react') {
        showReactionPicker(article, message);
      } else if (action === 'reply') {
        startReply(message);
      } else if (action === 'unsend' || action === 'delete') {
        // The first tap only asks ("unsend?"); a second tap within a few seconds does it.
        const button = article.querySelector('.voice-trash');
        if (!button.classList.contains('is-armed')) {
          button.classList.add('is-armed');
          button.insertAdjacentHTML('beforeend', `<span>${action}?</span>`);
          window.clearTimeout(armTimer);
          armTimer = window.setTimeout(() => {
            button.classList.remove('is-armed');
            button.querySelector('span')?.remove();
          }, 4000);
          return;
        }
        closeActions();
        try {
          await (action === 'unsend' ? unsend : remove)(message.id);
        } catch (error) {
          onError(error.message);
        }
        refresh();
      }
    }

    container.addEventListener('click', event => {
      if (Date.now() < ignoreClickUntil) return;
      const jump = event.target.closest('.voice-reply-quote[data-jump]');
      if (jump) {
        const original = articleFor(jump.dataset.jump);
        if (original) {
          original.scrollIntoView({ block: 'center', behavior: 'smooth' });
          replayClass(original, 'flash');
        }
        return;
      }
      const choice = event.target.closest('[data-react]');
      if (choice) {
        const message = byId(choice.closest('.voice-message').dataset.id);
        closeActions();
        if (message) setReaction(message, choice.dataset.react === message.reaction ? null : choice.dataset.react);
        return;
      }
      const action = event.target.closest('[data-act]');
      if (action) return runAction(action.dataset.act, action.closest('.voice-message'));
      if (event.target.closest('button, a')) return;
      const article = event.target.closest('.voice-message');
      if (!article) return closeActions();
      // Two quick taps are a ❤️; one tap (after a short wait, to tell them apart) opens the options.
      const id = Number(article.dataset.id);
      const now = Date.now();
      window.clearTimeout(tapTimer);
      if (lastTap.id === id && now - lastTap.time < doubleTapMs) {
        lastTap = { id: null, time: 0 };
        return loveByDoubleTap(article);
      }
      lastTap = { id, time: now };
      tapTimer = window.setTimeout(() => {
        if (selectedId === id) closeActions();
        else openActions(articleFor(id));
      }, doubleTapMs);
    });

    container.addEventListener('keydown', event => {
      const article = event.target.closest?.('.voice-message');
      if (!article || event.target !== article || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      if (selectedId === Number(article.dataset.id)) closeActions();
      else openActions(article);
    });

    // Swipe a message to the right (on a touch screen) to reply to it.
    container.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || !onReply || event.target.closest('button')) return;
      const article = event.target.closest('.voice-message');
      if (article) swipe = { article, pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, axis: null };
    });
    container.addEventListener('pointermove', event => {
      if (!swipe || event.pointerId !== swipe.pointerId) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      if (!swipe.axis && Math.hypot(dx, dy) > 10) swipe.axis = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
      if (swipe.axis !== 'x') return;
      swipe.dx = Math.max(0, Math.min(dx, 80));
      swipe.article.style.transform = `translateX(${swipe.dx}px)`;
      swipe.article.style.setProperty('--swipe', String(Math.min(1, swipe.dx / swipeToReplyPx)));
    });
    function endSwipe() {
      if (!swipe) return;
      const { article, dx, axis } = swipe;
      swipe = null;
      if (axis !== 'x') return;
      ignoreClickUntil = Date.now() + 400;
      article.classList.add('swipe-back');
      article.style.transform = '';
      article.style.removeProperty('--swipe');
      window.setTimeout(() => article.classList.remove('swipe-back'), 250);
      const message = byId(article.dataset.id);
      if (dx >= swipeToReplyPx && message) startReply(message);
    }
    container.addEventListener('pointerup', endSwipe);
    container.addEventListener('pointercancel', endSwipe);

    return {
      render,
      stop() {
        player.stop();
        closeActions();
      }
    };
  }

  // Record → listen back → send (or redo), a text box that grows and keeps an unsent draft, bunny stickers,
  // and the "replying to" bar.
  function mountComposer(root, { sendVoice, sendText, sendSticker, placeholder = 'or type a little message…', draftKey }) {
    const stickers = sendSticker && window.BunnyStickers ? window.BunnyStickers : null;
    root.classList.add('voice-composer');
    root.innerHTML = `
      <div class="voice-replying" hidden>
        <p><small>↩ replying to <b class="voice-replying-who"></b></small><span class="voice-replying-text"></span></p>
        <button class="voice-replying-cancel" type="button" aria-label="Don't reply to this message">×</button>
      </div>
      <div class="voice-recorder" data-state="idle">
        <button class="voice-record" type="button" data-show="idle">🎙 record a voice note</button>
        <div class="voice-recording" data-show="recording">
          <span class="voice-dot" aria-hidden="true"></span><span class="voice-timer">0:00</span><small>/ 2:00</small>
          <button class="voice-stop" type="button">stop</button>
          <button class="voice-cancel" type="button" aria-label="Discard recording">×</button>
        </div>
        <div class="voice-review" data-show="review">
          <button class="voice-redo" type="button">redo</button>
          <div class="voice-clip"><button class="voice-play" type="button" aria-label="Play recording">▶</button><span class="voice-progress"><i></i></span><small class="voice-time"></small></div>
          <button class="voice-send" type="button">send →</button>
        </div>
        <p class="voice-sending" data-show="sending">sending…</p>
      </div>
      ${stickers ? `<div class="voice-sticker-tray" hidden role="group" aria-label="Bunny stickers">${stickers.list.map(sticker => `
        <button type="button" data-sticker="${sticker.id}" aria-label="Send the ${escapeHtml(sticker.name)} bunny">${stickers.svg(sticker.id)}<small>${escapeHtml(sticker.name)}</small></button>`).join('')}
      </div>` : ''}
      <form class="voice-text-form">
        ${stickers ? `<button class="voice-sticker-toggle" type="button" aria-label="Bunny stickers" aria-expanded="false">${stickers.icon}</button>` : ''}
        <textarea rows="1" maxlength="1000" placeholder="${escapeHtml(placeholder)}" aria-label="Type a message" required></textarea>
        <button type="submit">send</button>
      </form>
      <p class="voice-status" role="status"></p>`;

    const recorderBox = root.querySelector('.voice-recorder');
    const status = root.querySelector('.voice-status');
    const timer = root.querySelector('.voice-timer');
    const reviewClip = root.querySelector('.voice-review .voice-play');
    const reviewPlayer = attachPlayer(root.querySelector('.voice-review'));
    const textForm = root.querySelector('.voice-text-form');
    const textBox = textForm.querySelector('textarea');
    const replyBar = root.querySelector('.voice-replying');
    const tray = root.querySelector('.voice-sticker-tray');
    const trayToggle = root.querySelector('.voice-sticker-toggle');
    // On phones the return key makes a new line (the send button sends); with a keyboard, Enter sends.
    const enterSends = !window.matchMedia('(hover: none)').matches;
    let stopRecording = null;
    let recording = null;
    let previewUrl = null;
    let reviewShownAt = 0;
    let replyingTo = null;

    // A half-written message stays in this browser until it is sent.
    const draft = {
      read() {
        try {
          return draftKey ? localStorage.getItem(draftKey) || '' : '';
        } catch (error) {
          return '';
        }
      },
      save(value) {
        try {
          if (!draftKey) return;
          if (value.trim()) localStorage.setItem(draftKey, value);
          else localStorage.removeItem(draftKey);
        } catch (error) {
          // Private browsing: the draft just isn't kept.
        }
      }
    };

    function growTextBox() {
      if (!textBox.offsetParent) return; // hidden for now; it fits itself when shown or focused
      textBox.style.height = 'auto';
      textBox.style.height = `${Math.min(textBox.scrollHeight + 2, 140)}px`;
    }

    function setReply(target) {
      replyingTo = target;
      replyBar.hidden = !target;
      root.querySelector('.voice-replying-who').textContent = target ? target.who : '';
      root.querySelector('.voice-replying-text').textContent = target ? target.preview : '';
      if (target) textBox.focus({ preventScroll: true });
    }

    function showTray(open) {
      if (!tray) return;
      tray.hidden = !open;
      trayToggle.setAttribute('aria-expanded', String(open));
    }

    function setState(state) {
      if (state === 'review') reviewShownAt = Date.now();
      recorderBox.dataset.state = state;
      recorderBox.querySelectorAll('[data-show]').forEach(element => { element.hidden = element.dataset.show !== state; });
    }

    function clearPreview() {
      reviewPlayer.stop();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      recording = null;
    }

    async function finishRecording() {
      if (!stopRecording) return;
      const stop = stopRecording;
      stopRecording = null;
      recording = await stop();
      if (recording.durationMs < 500 || !recording.blob.size) {
        clearPreview();
        setState('idle');
        status.textContent = 'That was a bit short. Try holding on a little longer.';
        return;
      }
      previewUrl = URL.createObjectURL(recording.blob);
      reviewClip.dataset.src = previewUrl;
      reviewClip.dataset.duration = recording.durationMs;
      root.querySelector('.voice-review .voice-time').textContent = formatDuration(recording.durationMs);
      setState('review');
    }

    root.querySelector('.voice-record').addEventListener('click', async () => {
      status.textContent = '';
      showTray(false);
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        status.textContent = 'This browser cannot record voice notes. You can still type a message.';
        return;
      }
      try {
        stopRecording = await startRecording(elapsed => {
          timer.textContent = formatDuration(elapsed);
          if (elapsed >= maxRecordingMs) finishRecording();
        });
        timer.textContent = '0:00';
        setState('recording');
      } catch (error) {
        status.textContent = 'The microphone is not available. Please allow microphone access and try again.';
      }
    });
    root.querySelector('.voice-stop').addEventListener('click', finishRecording);
    root.querySelector('.voice-cancel').addEventListener('click', async () => {
      await finishRecording();
      clearPreview();
      setState('idle');
    });
    root.querySelector('.voice-redo').addEventListener('click', () => {
      clearPreview();
      setState('idle');
    });
    root.querySelector('.voice-send').addEventListener('click', async () => {
      // Ignore a double-tap on "stop" landing on "send" before she has had a chance to listen back.
      if (!recording || Date.now() - reviewShownAt < 700) return;
      setState('sending');
      try {
        await sendVoice(recording, replyingTo?.id);
        clearPreview();
        setState('idle');
        setReply(null);
        status.textContent = 'Sent ✦';
      } catch (error) {
        setState('review');
        status.textContent = error.message;
      }
    });

    textBox.value = draft.read();
    textBox.addEventListener('focus', growTextBox);
    textBox.addEventListener('input', () => {
      growTextBox();
      draft.save(textBox.value);
    });
    textBox.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !enterSends) return;
      event.preventDefault();
      textForm.querySelector('button[type="submit"]').click();
    });
    textForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = textForm.querySelector('button[type="submit"]');
      if (!textBox.value.trim()) return;
      button.disabled = true;
      try {
        await sendText(textBox.value, replyingTo?.id);
        textBox.value = '';
        draft.save('');
        growTextBox();
        setReply(null);
        status.textContent = 'Sent ✦';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    root.querySelector('.voice-replying-cancel').addEventListener('click', () => setReply(null));
    trayToggle?.addEventListener('click', () => showTray(tray.hidden));
    tray?.addEventListener('click', async event => {
      const button = event.target.closest('[data-sticker]');
      if (!button || button.disabled) return;
      tray.querySelectorAll('button').forEach(sticker => { sticker.disabled = true; });
      status.textContent = 'sending…';
      try {
        await sendSticker(button.dataset.sticker, replyingTo?.id);
        showTray(false);
        setReply(null);
        status.textContent = 'Sent ✦';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        tray.querySelectorAll('button').forEach(sticker => { sticker.disabled = false; });
      }
    });

    setState('idle');
    window.requestAnimationFrame(growTextBox);
    return {
      replyTo: setReply,
      fit: growTextBox,
      showStatus(message) {
        status.textContent = message;
      },
      reset() {
        if (stopRecording) finishRecording().then(() => { clearPreview(); setState('idle'); });
        else {
          clearPreview();
          setState('idle');
        }
        setReply(null);
        showTray(false);
        status.textContent = '';
      }
    };
  }

  async function uploadVoice(url, recording, replyTo) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': recording.type,
        'X-Duration-Ms': String(Math.round(recording.durationMs)),
        ...(replyTo ? { 'X-Reply-To': String(replyTo) } : {})
      },
      body: recording.blob
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'The voice note could not be sent. Please try again.');
    }
  }

  window.VoiceKit = { attachPlayer, renderThread, mountThread, mountComposer, uploadVoice, formatDuration, formatWhen };
})();
