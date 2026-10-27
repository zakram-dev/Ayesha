// Ayesha's side of the voice notes: password door, the thread, and sending voice or text to Zohaib.
(() => {
  const voiceModal = document.querySelector('#voice-modal');
  const unlockForm = document.querySelector('#voice-unlock-form');
  const unlockStatus = document.querySelector('#voice-unlock-status');
  const panel = document.querySelector('#voice-panel');
  const thread = document.querySelector('#voice-thread');
  const badge = document.querySelector('#voice-badge');
  const player = window.VoiceKit.attachPlayer(thread);
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
    const messages = await request('/api/voice/messages');
    window.VoiceKit.renderThread(thread, messages, {
      me: 'ayesha',
      names: { ayesha: 'You', zohaib: 'Zohaib' },
      canDelete: message => message.sender === 'ayesha'
    });
    showBadge(0);
  }

  async function showPanel() {
    unlockForm.hidden = true;
    panel.hidden = false;
    await loadThread();
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => loadThread().catch(() => {}), 15000);
    startMailChecks();
  }

  function closeVoiceModal() {
    window.clearInterval(pollTimer);
    player.stop();
    composer.reset();
    voiceModal.classList.remove('is-open');
    voiceModal.setAttribute('aria-hidden', 'true');
  }

  const composer = window.VoiceKit.mountComposer(document.querySelector('#voice-composer'), {
    placeholder: 'or type a little message to Zohaib…',
    async sendVoice(recording) {
      await window.VoiceKit.uploadVoice('/api/voice/messages/audio', recording);
      await loadThread();
    },
    async sendText(text) {
      await request('/api/voice/messages', { method: 'POST', body: JSON.stringify({ text }) });
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

  thread.addEventListener('click', async event => {
    const button = event.target.closest('.voice-delete');
    if (!button || !window.confirm('Delete this message?')) return;
    try {
      await request(`/api/voice/messages/${button.dataset.id}`, { method: 'DELETE' });
      await loadThread();
    } catch (error) {
      window.alert(error.message);
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
})();
