// Ayesha's side of the voice notes: password door, the thread, and sending voice or text to Zohaib.
(() => {
  const voiceModal = document.querySelector('#voice-modal');
  const unlockForm = document.querySelector('#voice-unlock-form');
  const unlockStatus = document.querySelector('#voice-unlock-status');
  const panel = document.querySelector('#voice-panel');
  const thread = document.querySelector('#voice-thread');
  const badge = document.querySelector('#voice-badge');
  let pollTimer = null;
  let mailTimer = null;

  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error || 'Something went wrong. Please try again.');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function showBadge(unread) {
    badge.hidden = !unread;
    badge.textContent = unread ? `${unread} new` : '';
    // The bunny listens for this so it can bring the mail.
    window.dispatchEvent(new CustomEvent('mailbox:unread', { detail: { unread } }));
  }

  // While the page is open (and the mailbox is closed), look for new replies every 45 seconds.
  function checkForMail() {
    if (document.hidden || voiceModal.classList.contains('is-open')) return;
    request('/api/voice/session').then(session => showBadge(session.unread)).catch(error => {
      if (error.status === 401) stopMailChecks();
    });
  }

  function startMailChecks() {
    if (!mailTimer) mailTimer = window.setInterval(checkForMail, 45000);
  }

  function stopMailChecks() {
    window.clearInterval(mailTimer);
    mailTimer = null;
  }

  async function loadThread() {
    chat.render(await request('/api/voice/messages'));
    showBadge(0);
  }

  // Tap a message to react / reply / unsend (her own, for 5 minutes), double-tap for ❤️, swipe right to reply.
  const chat = window.VoiceKit.mountThread(thread, {
    me: 'ayesha',
    names: { ayesha: 'You', zohaib: 'Zohaib' },
    react: (id, reaction) => request(`/api/voice/messages/${id}/reaction`, { method: 'PUT', body: JSON.stringify({ reaction }) }),
    played: id => request(`/api/voice/messages/${id}/played`, { method: 'POST' }),
    unsend: id => request(`/api/voice/messages/${id}`, { method: 'DELETE' }),
    onReply: target => composer.replyTo(target),
    refresh: () => loadThread().catch(() => {}),
    onError: message => composer.showStatus(message)
  });

  async function showPanel() {
    unlockForm.hidden = true;
    panel.hidden = false;
    composer.fit();
    await loadThread();
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => loadThread().catch(() => {}), 15000);
    startMailChecks();
  }

  function closeVoiceModal() {
    window.clearInterval(pollTimer);
    chat.stop();
    composer.reset();
    voiceModal.classList.remove('is-open');
    voiceModal.setAttribute('aria-hidden', 'true');
  }

  const composer = window.VoiceKit.mountComposer(document.querySelector('#voice-composer'), {
    placeholder: 'or type a little message to Zohaib…',
    draftKey: 'ayesha-chat-draft',
    async sendVoice(recording, replyTo) {
      await window.VoiceKit.uploadVoice('/api/voice/messages/audio', recording, replyTo);
      await loadThread();
    },
    async sendText(text, replyTo) {
      await request('/api/voice/messages', { method: 'POST', body: JSON.stringify({ text, replyTo }) });
      await loadThread();
    },
    async sendSticker(sticker, replyTo) {
      await request('/api/voice/messages', { method: 'POST', body: JSON.stringify({ sticker, replyTo }) });
      await loadThread();
    }
  });

  document.querySelector('#open-voice-notes').addEventListener('click', async () => {
    unlockStatus.textContent = '';
    voiceModal.classList.add('is-open');
    voiceModal.setAttribute('aria-hidden', 'false');
    try {
      await showPanel();
    } catch (error) {
      panel.hidden = true;
      unlockForm.hidden = false;
      document.querySelector('#voice-password').value = '';
    }
  });

  unlockForm.addEventListener('submit', async event => {
    event.preventDefault();
    unlockStatus.textContent = 'Checking the password...';
    try {
      await request('/api/voice/unlock', { method: 'POST', body: JSON.stringify({ password: document.querySelector('#voice-password').value }) });
      unlockStatus.textContent = '';
      await showPanel();
    } catch (error) {
      unlockStatus.textContent = error.message;
    }
  });

  document.querySelector('#close-voice-modal').addEventListener('click', closeVoiceModal);
  voiceModal.addEventListener('click', event => { if (event.target === voiceModal) closeVoiceModal(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && voiceModal.classList.contains('is-open')) closeVoiceModal();
  });

  // If her phone is already signed in, show how many new notes are waiting from Zohaib, and keep watching.
  request('/api/voice/session').then(session => {
    showBadge(session.unread);
    startMailChecks();
  }).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (!document.hidden && mailTimer) checkForMail(); });
  // Opening the sealed "only for you" card signs her in too; pick that up so new replies show straight away.
  window.addEventListener('mailbox:signed-in', () => {
    request('/api/voice/session').then(session => {
      showBadge(session.unread);
      startMailChecks();
    }).catch(() => {});
  });
})();
