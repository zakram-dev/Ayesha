// Shared by her voice corner (public page) and the admin Voice notes tab:
// recording in the browser, playing notes back, and drawing the chat thread.
(() => {
  // Ask for AAC in MP4 first: it is what iPhones record and every browser can play. Plain 'audio/mp4'
  // makes Chrome use Opus inside MP4, which older iPhones may not play, so it only comes after.
  const preferredTypes = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  const maxRecordingMs = 2 * 60 * 1000;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.round((ms || 0) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function formatWhen(createdAt) {
    const date = new Date(`${createdAt.replace(' ', 'T')}Z`);
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
  function attachPlayer(container) {
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
      entry.audio.addEventListener('play', () => { button.textContent = '❚❚'; button.setAttribute('aria-label', 'Pause voice note'); });
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

  function renderThread(container, messages, { me, names, canDelete }) {
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    container.innerHTML = messages.length
      ? messages.map(message => {
        const mine = message.sender === me;
        const body = message.kind === 'voice'
          ? `<div class="voice-clip">
              <button class="voice-play" type="button" data-src="${escapeHtml(message.audioUrl)}" data-duration="${message.durationMs}" aria-label="Play voice note">▶</button>
              <span class="voice-progress"><i></i></span>
              <small class="voice-time">${formatDuration(message.durationMs)}</small>
            </div>`
          : `<p>${escapeHtml(message.text)}</p>`;
        return `<article class="voice-message ${mine ? 'mine' : 'theirs'}" data-id="${message.id}">
          <small class="voice-meta">${escapeHtml(names[message.sender])} · ${escapeHtml(formatWhen(message.createdAt))}</small>
          ${body}
          <div class="voice-foot">
            ${mine && message.readAt ? '<small class="voice-seen">seen ✓</small>' : ''}
            ${canDelete(message) ? `<button class="voice-delete" type="button" data-id="${message.id}">delete</button>` : ''}
          </div>
        </article>`;
      }).join('')
      : '<p class="voice-empty">No notes yet. Say hello ✦</p>';
    if (nearBottom || !container.dataset.rendered) container.scrollTop = container.scrollHeight;
    container.dataset.rendered = 'true';
  }

  // Record → listen back → send (or redo), plus a small text box for when talking isn't possible.
  function mountComposer(root, { sendVoice, sendText, placeholder = 'or type a little message…' }) {
    root.classList.add('voice-composer');
    root.innerHTML = `
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
      <form class="voice-text-form">
        <input maxlength="1000" placeholder="${escapeHtml(placeholder)}" aria-label="Type a message" required />
        <button type="submit">send</button>
      </form>
      <p class="voice-status" role="status"></p>`;

    const recorderBox = root.querySelector('.voice-recorder');
    const status = root.querySelector('.voice-status');
    const timer = root.querySelector('.voice-timer');
    const reviewClip = root.querySelector('.voice-review .voice-play');
    const reviewPlayer = attachPlayer(root.querySelector('.voice-review'));
    let stopRecording = null;
    let recording = null;
    let previewUrl = null;
    let reviewShownAt = 0;

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
        await sendVoice(recording);
        clearPreview();
        setState('idle');
        status.textContent = 'Sent ✦';
      } catch (error) {
        setState('review');
        status.textContent = error.message;
      }
    });
    root.querySelector('.voice-text-form').addEventListener('submit', async event => {
      event.preventDefault();
      const input = event.target.querySelector('input');
      const button = event.target.querySelector('button');
      button.disabled = true;
      try {
        await sendText(input.value);
        input.value = '';
        status.textContent = 'Sent ✦';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    setState('idle');
    return {
      reset() {
        if (stopRecording) finishRecording().then(() => { clearPreview(); setState('idle'); });
        else {
          clearPreview();
          setState('idle');
        }
        status.textContent = '';
      }
    };
  }

  async function uploadVoice(url, recording) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': recording.type, 'X-Duration-Ms': String(Math.round(recording.durationMs)) },
      body: recording.blob
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'The voice note could not be sent. Please try again.');
    }
  }

  window.VoiceKit = { attachPlayer, renderThread, mountComposer, uploadVoice, formatDuration };
})();
