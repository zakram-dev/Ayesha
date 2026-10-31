const loginPanel = document.querySelector('#login-panel');
const adminContent = document.querySelector('#admin-content');
const logoutButton = document.querySelector('#logout');
const status = document.querySelector('#status');
let categories = [];
let quotes = [];
let popupSettings = null;
let editingQuoteId = null;
let editingCategoryId = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

function showStatus(message, isError = false) {
  status.textContent = message;
  status.className = `status${isError ? ' error' : ''}`;
}

function renderCategoryOptions() {
  const options = categories
    .filter(category => category.active)
    .map(category => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('');
  document.querySelector('#quote-category').innerHTML = options;
  document.querySelector('#quote-category-filter').innerHTML = `<option value="">All categories</option>${categories.map(category => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('')}`;
}

// On sealed notes: whether she has opened it yet (new notes reach her first).
function openedBadge(quote) {
  if (!quote.category_private || quote.status !== 'active') return '';
  return quote.opened_at ? '<b class="badge private-badge">opened ✓</b>' : '<b class="badge new-badge">✦ new · not opened yet</b>';
}

function renderQuotes() {
  const search = document.querySelector('#quote-search').value.toLowerCase();
  const categoryFilter = document.querySelector('#quote-category-filter').value;
  document.querySelector('#quotes').innerHTML = quotes
    .filter(quote => (!categoryFilter || String(quote.category_id) === categoryFilter)
      && (quote.text.toLowerCase().includes(search) || quote.category_name.toLowerCase().includes(search)))
    .map(quote => `<tr><td>${escapeHtml(quote.text)}${quote.is_main_quote ? '<b class="badge">pinned</b>' : ''}${openedBadge(quote)}${quote.liked_at ? '<b class="badge private-badge">♡ she loved this</b>' : ''}${quote.comment_count ? `<b class="badge private-badge">💬 ${quote.comment_count}</b>` : ''}</td><td>${escapeHtml(quote.category_name)}</td><td>${escapeHtml(quote.status || (quote.active ? 'active' : 'archived'))}</td><td><button class="small-button" data-action="edit-quote" data-id="${quote.id}">Edit</button> <button class="small-button" data-action="toggle-quote" data-id="${quote.id}">${quote.status === 'active' ? 'Archive' : 'Activate'}</button> <button class="small-button danger" data-action="delete-quote" data-id="${quote.id}">Delete</button></td></tr>`).join('');
}

function renderCategories() {
  document.querySelector('#categories').innerHTML = categories.map(category => `<tr><td>${escapeHtml(category.name)}${category.private ? '<b class="badge private-badge">🔒 only for her</b>' : ''}<small class="category-card-title">${escapeHtml(category.card_title || '')}</small></td><td>${escapeHtml(category.slug)}</td><td>${category.quote_count}</td><td>${category.active ? 'Active' : 'Inactive'}</td><td><button class="small-button" data-action="edit-category" data-id="${category.id}">Edit</button> <button class="small-button" data-action="add-quote" data-id="${category.id}">Add quote</button> <button class="small-button" data-action="toggle-category" data-id="${category.id}">${category.active ? 'Deactivate' : 'Activate'}</button> <button class="small-button danger" data-action="delete-category" data-id="${category.id}">Delete</button></td></tr>`).join('');
}

function renderPopupSettings() {
  const mode = document.querySelector('#popup-mode').value;
  const pool = categories.find(category => String(category.id) === document.querySelector('#popup-pool').value);
  const pinnedUntil = document.querySelector('#popup-pinned-until').value;
  const pinnedQuote = popupSettings?.pinnedQuote;
  document.querySelectorAll('[data-popup-mode]').forEach(field => { field.hidden = field.dataset.popupMode !== mode; });

  let hint;
  if (mode === 'rotate') {
    hint = pool
      ? `Each visit shows a quote from ${pool.name} that she hasn't seen yet. Once she has seen all ${pool.quote_count}, it reshuffles.`
      : 'Choose a category to rotate through.';
  } else if (!pinnedQuote) {
    hint = 'No quote is pinned yet. Tick "Pin as popup quote" on a quote in the Quotes tab. Until then the popup keeps rotating.';
  } else if (pinnedUntil && pinnedUntil < new Date().toLocaleDateString('en-CA')) {
    hint = `The pin on "${pinnedQuote.text}" ended on ${pinnedUntil}, so the popup is rotating again.`;
  } else {
    hint = `Showing "${pinnedQuote.text}" ${pinnedUntil ? `until the end of ${pinnedUntil}, then back to rotating.` : 'with no end date.'}`;
  }
  document.querySelector('#popup-mode-hint').textContent = hint;
}

function renderAnnouncementLinkFields() {
  const linkType = document.querySelector('#announcement-link-type').value;
  document.querySelector('[data-announcement-link="label"]').hidden = linkType === 'none';
  document.querySelector('[data-announcement-link="url"]').hidden = linkType !== 'link';
}

function renderAnnouncement(announcement) {
  document.querySelector('#announcement-enabled').checked = announcement.enabled;
  document.querySelector('#announcement-text').value = announcement.text;
  document.querySelector('#announcement-link-type').value = announcement.linkType;
  document.querySelector('#announcement-link-label').value = announcement.linkLabel;
  document.querySelector('#announcement-link-url').value = announcement.linkUrl;
  document.querySelector('#announcement-until').value = announcement.until;
  const ended = announcement.until && announcement.until < new Date().toLocaleDateString('en-CA');
  const state = document.querySelector('#announcement-state');
  state.textContent = !announcement.enabled ? 'Hidden' : ended ? `Ended on ${announcement.until}` : 'Showing now';
  state.className = `announcement-state${announcement.enabled && !ended ? ' live' : ''}`;
  renderAnnouncementLinkFields();
}

function renderPinUntilField() {
  document.querySelector('#quote-pin-until-label').hidden = !document.querySelector('#quote-main').checked;
}

function resetQuoteForm() {
  editingQuoteId = null;
  document.querySelector('#quote-form').reset();
  document.querySelector('#quote-status').value = 'draft';
  document.querySelector('#quote-submit').textContent = 'Add quote';
  document.querySelector('#quote-cancel').hidden = true;
  renderPinUntilField();
}

function activateTab(tabName) {
  document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === tabName));
  window.clearInterval(voicePollTimer);
  if (tabName === 'status') loadMyStatus();
  if (tabName === 'voice') {
    loadVoiceThread();
    loadAlerts();
    voiceComposer.fit();
    voicePollTimer = window.setInterval(loadVoiceThread, 20000);
  } else {
    voiceChat.stop();
  }
}

// ---- Voice notes with Ayesha ----
const voiceThread = document.querySelector('#admin-voice-thread');
let voicePollTimer = null;

function showVoiceBadge(unread) {
  const badge = document.querySelector('#voice-tab-badge');
  badge.hidden = !unread;
  badge.textContent = unread || '';
}

async function loadVoiceThread() {
  try {
    voiceChat.render(await request('/api/admin/voice/messages'));
    showVoiceBadge(0);
  } catch (error) {
    showStatus(error.message, true);
  }
}

const voiceComposer = window.VoiceKit.mountComposer(document.querySelector('#admin-voice-composer'), {
  placeholder: 'or type a little message to Ayesha…',
  draftKey: 'admin-chat-draft',
  async sendVoice(recording, replyTo) {
    await window.VoiceKit.uploadVoice('/api/admin/voice/messages/audio', recording, replyTo);
    await loadVoiceThread();
  },
  async sendText(text, replyTo) {
    await request('/api/admin/voice/messages', { method: 'POST', body: JSON.stringify({ text, replyTo }) });
    await loadVoiceThread();
  },
  async sendSticker(sticker, replyTo) {
    await request('/api/admin/voice/messages', { method: 'POST', body: JSON.stringify({ sticker, replyTo }) });
    await loadVoiceThread();
  }
});

// Tap a message to react / reply / delete (any message, any time), double-tap for ❤️, swipe right to reply.
const voiceChat = window.VoiceKit.mountThread(voiceThread, {
  me: 'zohaib',
  names: { ayesha: 'Ayesha', zohaib: 'You' },
  react: (id, reaction) => request(`/api/admin/voice/messages/${id}/reaction`, { method: 'PUT', body: JSON.stringify({ reaction }) }),
  played: id => request(`/api/admin/voice/messages/${id}/played`, { method: 'POST' }),
  remove: id => request(`/api/admin/voice/messages/${id}`, { method: 'DELETE' }),
  onReply: target => voiceComposer.replyTo(target),
  refresh: loadVoiceThread,
  onError: message => showStatus(message, true)
});

function renderAlerts(topic) {
  const setup = document.querySelector('#alerts-setup');
  setup.innerHTML = topic
    ? `<p>Alerts are on. To get them on your phone:</p>
      <ol class="alert-steps">
        <li>Install the free <strong>ntfy</strong> app (App Store or Google Play).</li>
        <li>Tap <strong>+</strong> and subscribe to this topic: <code>${escapeHtml(topic)}</code></li>
        <li>Tap <strong>Send test alert</strong> below. Your phone should buzz.</li>
      </ol>
      <p class="setting-hint">Keep the topic name private: anyone who knows it could see the alerts. Alerts only say that something arrived, never what it says.</p>
      <div class="alert-actions"><button class="button" type="button" data-alerts="test">Send test alert</button><button class="button secondary" type="button" data-alerts="off">Turn off alerts</button></div>`
    : `<p>Get a buzz on your phone whenever Ayesha sends a voice note or message.</p>
      <div class="alert-actions"><button class="button" type="button" data-alerts="on">Set up phone alerts</button></div>`;
}

async function loadAlerts() {
  try {
    renderAlerts((await request('/api/admin/alerts')).topic);
  } catch (error) {
    showStatus(error.message, true);
  }
}

document.querySelector('#alerts-setup').addEventListener('click', async event => {
  const button = event.target.closest('[data-alerts]');
  if (!button) return;
  const alertsStatus = document.querySelector('#alerts-status');
  alertsStatus.className = 'status';
  alertsStatus.textContent = '';
  try {
    if (button.dataset.alerts === 'on') renderAlerts((await request('/api/admin/alerts', { method: 'POST' })).topic);
    if (button.dataset.alerts === 'off' && confirm('Turn off phone alerts?')) {
      await request('/api/admin/alerts', { method: 'DELETE' });
      renderAlerts(null);
    }
    if (button.dataset.alerts === 'test') {
      await request('/api/admin/alerts/test', { method: 'POST' });
      alertsStatus.textContent = 'Test alert sent. Check your phone ✦';
    }
  } catch (error) {
    alertsStatus.textContent = error.message;
    alertsStatus.className = 'status error';
  }
});

document.querySelector('#voice-password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const passwordStatus = document.querySelector('#voice-password-status');
  try {
    await request('/api/admin/voice/password', {
      method: 'PUT',
      body: JSON.stringify({ password: document.querySelector('#voice-password-input').value })
    });
    event.target.reset();
    passwordStatus.textContent = 'Her password is saved. Let her know the new one ✦';
    passwordStatus.className = 'status';
    document.querySelector('#voice-setup-hint').hidden = true;
  } catch (error) {
    passwordStatus.textContent = error.message;
    passwordStatus.className = 'status error';
  }
});
document.querySelector('#voice-refresh').addEventListener('click', loadVoiceThread);

async function loadData() {
  const [dashboard, settings, loadedCategories, loadedQuotes, announcement, bunny, flowerSecret] = await Promise.all([
    request('/api/admin/dashboard'), request('/api/admin/settings'),
    request('/api/admin/categories'), request('/api/admin/quotes'), request('/api/admin/announcement'),
    request('/api/admin/bunny'), request('/api/admin/flower')
  ]);
  renderAnnouncement(announcement);
  document.querySelector('#bunny-enabled').checked = bunny.enabled;
  document.querySelector('#bunny-lines').value = bunny.lines.join('\n');
  document.querySelector('#flower-enabled').checked = flowerSecret.enabled;
  document.querySelector('#flower-message').value = flowerSecret.message;
  categories = loadedCategories;
  quotes = loadedQuotes;
  popupSettings = settings;
  document.querySelector('#stat-quotes').textContent = dashboard.quotes.total;
  document.querySelector('#stat-active-quotes').textContent = dashboard.quotes.active || 0;
  document.querySelector('#stat-categories').textContent = dashboard.categories.total;
  document.querySelector('#stat-active-categories').textContent = dashboard.categories.active || 0;
  document.querySelector('#stat-events').textContent = dashboard.events.total;
  document.querySelector('#top-categories').innerHTML = dashboard.topCategories.length
    ? dashboard.topCategories.map(item => `<li><strong>${escapeHtml(item.name)}</strong> <span>${item.interactions}</span></li>`).join('')
    : '<li>No interactions yet.</li>';
  document.querySelector('#top-quotes').innerHTML = dashboard.topQuotes.length
    ? dashboard.topQuotes.map(item => `<li><strong>${escapeHtml(item.text)}</strong><small>${escapeHtml(item.category_name)} · ${item.views} views</small></li>`).join('')
    : '<li>No quote views yet.</li>';
  document.querySelector('#popup-enabled').checked = settings.enabled;
  document.querySelector('#popup-delay').value = settings.delay;
  document.querySelector('#popup-frequency').value = settings.frequency;
  document.querySelector('#popup-mode').value = settings.mode;
  document.querySelector('#popup-pool').innerHTML = categories
    .filter(category => !category.private)
    .map(category => `<option value="${category.id}">${escapeHtml(category.name)} (${category.quote_count} quote${category.quote_count === 1 ? '' : 's'}${category.active ? '' : ', inactive'})</option>`).join('');
  document.querySelector('#popup-pool').value = String(settings.poolCategoryId);
  document.querySelector('#popup-pinned-until').value = settings.pinnedUntil;
  document.querySelector('#voice-setup-hint').hidden = settings.voicePasswordConfigured;
  showVoiceBadge(dashboard.voiceUnread);
  renderPopupSettings();
  renderCategoryOptions();
  renderQuotes();
  renderCategories();
}

async function enterAdmin() {
  loginPanel.hidden = true;
  adminContent.hidden = false;
  logoutButton.hidden = false;
  await loadData();
  // Phone alerts link straight to /admin/#voice.
  if (window.location.hash === '#voice') activateTab('voice');
  if (window.location.hash === '#status') activateTab('status');
}

document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: document.querySelector('#password').value }) });
    await enterAdmin();
    showStatus('Signed in.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector('#quote-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const payload = {
      text: document.querySelector('#quote-text').value,
      categoryId: document.querySelector('#quote-category').value,
      author: document.querySelector('#quote-author').value,
      displayOrder: document.querySelector('#quote-order').value,
      status: document.querySelector('#quote-status').value,
      active: document.querySelector('#quote-status').value === 'active',
      isMainQuote: document.querySelector('#quote-main').checked
    };
    if (payload.isMainQuote) payload.pinnedUntil = document.querySelector('#quote-pin-until').value;
    await request(editingQuoteId ? `/api/admin/quotes/${editingQuoteId}` : '/api/admin/quotes', { method: editingQuoteId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    resetQuoteForm();
    await loadData();
    if (!payload.isMainQuote) showStatus('Quote saved.');
    else if (payload.status !== 'active') showStatus('Quote saved and pinned, but it is not Active yet, so the popup keeps rotating until you set its status to Active.', true);
    else showStatus(`Quote saved and pinned as the popup${payload.pinnedUntil ? ` until the end of ${payload.pinnedUntil}` : ''}.`);
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector('#category-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const wasEditing = Boolean(editingCategoryId);
    const payload = {
      name: document.querySelector('#category-name').value,
      slug: document.querySelector('#category-slug').value,
      cardTitle: document.querySelector('#category-card-title').value,
      description: document.querySelector('#category-description').value,
      color: document.querySelector('#category-color').value,
      active: editingCategoryId ? Boolean(categories.find(item => item.id === editingCategoryId)?.active) : true,
      private: document.querySelector('#category-private').checked
    };
    await request(editingCategoryId ? `/api/admin/categories/${editingCategoryId}` : '/api/admin/categories', {
      method: editingCategoryId ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    editingCategoryId = null;
    event.target.reset();
    document.querySelector('#category-submit').textContent = 'Add category';
    document.querySelector('#category-cancel').hidden = true;
    await loadData();
    showStatus(wasEditing ? 'Category updated.' : 'Category added.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector('#quotes').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  const quote = quotes.find(item => item.id === Number(button.dataset.id));
  try {
    if (button.dataset.action === 'edit-quote') {
      editingQuoteId = quote.id;
      document.querySelector('#quote-text').value = quote.text;
      document.querySelector('#quote-category').value = quote.category_id;
      document.querySelector('#quote-author').value = quote.author || '';
      document.querySelector('#quote-order').value = quote.display_order;
      document.querySelector('#quote-status').value = quote.status || (quote.active ? 'active' : 'archived');
      document.querySelector('#quote-main').checked = Boolean(quote.is_main_quote);
      document.querySelector('#quote-pin-until').value = quote.is_main_quote ? popupSettings?.pinnedUntil || '' : '';
      renderPinUntilField();
      document.querySelector('#quote-submit').textContent = 'Save changes';
      document.querySelector('#quote-cancel').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (button.dataset.action === 'delete-quote' && confirm('Delete this quote?')) await request(`/api/admin/quotes/${quote.id}`, { method: 'DELETE' });
    if (button.dataset.action === 'toggle-quote') {
      const nextStatus = quote.status === 'active' ? 'archived' : 'active';
      await request(`/api/admin/quotes/${quote.id}`, { method: 'PUT', body: JSON.stringify({ ...quote, categoryId: quote.category_id, status: nextStatus, active: nextStatus === 'active', isMainQuote: quote.is_main_quote }) });
    }
    await loadData();
    showStatus('Quote updated.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector('#categories').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  const category = categories.find(item => item.id === Number(button.dataset.id));
  try {
    if (button.dataset.action === 'add-quote') {
      resetQuoteForm();
      document.querySelector('#quote-category').value = String(category.id);
      activateTab('quotes');
      document.querySelector('#quote-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (button.dataset.action === 'edit-category') {
      editingCategoryId = category.id;
      document.querySelector('#category-name').value = category.name;
      document.querySelector('#category-slug').value = category.slug;
      document.querySelector('#category-card-title').value = category.card_title || '';
      document.querySelector('#category-description').value = category.description || '';
      document.querySelector('#category-color').value = category.color || '';
      document.querySelector('#category-private').checked = Boolean(category.private);
      document.querySelector('#category-submit').textContent = 'Save changes';
      document.querySelector('#category-cancel').hidden = false;
      window.scrollTo({ top: document.querySelector('#category-form').offsetTop, behavior: 'smooth' });
      return;
    }
    if (button.dataset.action === 'delete-category' && confirm('Delete this category?')) await request(`/api/admin/categories/${category.id}`, { method: 'DELETE' });
    if (button.dataset.action === 'toggle-category') await request(`/api/admin/categories/${category.id}`, { method: 'PUT', body: JSON.stringify({ ...category, cardTitle: category.card_title, active: !category.active }) });
    await loadData();
    showStatus('Category updated.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector('#quote-search').addEventListener('input', renderQuotes);
document.querySelector('#quote-category-filter').addEventListener('change', renderQuotes);
document.querySelectorAll('.admin-tab').forEach(button => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});
document.querySelector('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request('/api/admin/settings', { method: 'PUT', body: JSON.stringify({
      enabled: document.querySelector('#popup-enabled').checked,
      delay: Number(document.querySelector('#popup-delay').value),
      frequency: document.querySelector('#popup-frequency').value,
      mode: document.querySelector('#popup-mode').value,
      poolCategoryId: Number(document.querySelector('#popup-pool').value),
      pinnedUntil: document.querySelector('#popup-pinned-until').value
    }) });
    await loadData();
    showStatus('Popup settings saved.');
  } catch (error) {
    showStatus(error.message, true);
  }
});
// ---- My status for her: what she sees, manual buttons, and the iPhone key ----
const statusWordsShown = { home: 'free · at home', school: 'at school', 'free-school': 'free · at school', work: 'at work', free: 'free', chat: 'busy, can chat', busy: 'busy', driving: 'driving' };

async function loadMyStatus() {
  try {
    const { status, keyConfigured } = await request('/api/admin/status');
    document.querySelector('#admin-status-now').textContent = status
      ? `She sees: ${statusWordsShown[status.key]} · until ${new Date(status.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'She sees: not sure ♡ just ask';
    document.querySelector('#status-key-state').textContent = keyConfigured
      ? 'Your iPhone key is on. Making a new one stops the old one straight away.'
      : 'No key yet. Create one, then paste it into the "Ayesha status" shortcut.';
    document.querySelector('#status-key-create').textContent = keyConfigured ? 'Make a new key' : 'Create a key';
    document.querySelector('#status-key-off').hidden = !keyConfigured;
    document.querySelectorAll('.status-url').forEach(element => { element.textContent = `${window.location.origin}/api/status`; });
  } catch (error) {
    showStatus(error.message, true);
  }
}

document.querySelector('#status-buttons').addEventListener('click', async event => {
  const button = event.target.closest('[data-set]');
  if (!button) return;
  try {
    await request('/api/status', { method: 'POST', body: JSON.stringify({ set: button.dataset.set }) });
    await loadMyStatus();
    showStatus('Status updated.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector('#status-key-create').addEventListener('click', async () => {
  if (document.querySelector('#status-key-off').hidden === false && !confirm('Make a new key? The old one stops working, so you will need to paste the new one into your shortcut.')) return;
  try {
    const { key } = await request('/api/admin/status/key', { method: 'POST' });
    document.querySelector('#status-key-value').textContent = key;
    document.querySelector('#status-key-box').hidden = false;
    await loadMyStatus();
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector('#status-key-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.querySelector('#status-key-value').textContent);
    showStatus('Key copied.');
  } catch (error) {
    showStatus('Select the key and copy it by hand.', true);
  }
});

document.querySelector('#status-key-off').addEventListener('click', async () => {
  if (!confirm('Switch the key off? Your iPhone shortcuts will stop changing your status.')) return;
  try {
    await request('/api/admin/status/key', { method: 'DELETE' });
    document.querySelector('#status-key-box').hidden = true;
    await loadMyStatus();
    showStatus('Key switched off.');
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.querySelector('#category-cancel').addEventListener('click', () => {
  editingCategoryId = null;
  document.querySelector('#category-form').reset();
  document.querySelector('#category-submit').textContent = 'Add category';
  document.querySelector('#category-cancel').hidden = true;
});
document.querySelector('#announcement-link-type').addEventListener('change', renderAnnouncementLinkFields);
document.querySelector('#announcement-form').addEventListener('submit', async event => {
  event.preventDefault();
  const asNew = event.submitter?.dataset.mode === 'new';
  const enabled = document.querySelector('#announcement-enabled').checked;
  try {
    await request('/api/admin/announcement', { method: 'PUT', body: JSON.stringify({
      enabled,
      asNew,
      text: document.querySelector('#announcement-text').value,
      linkType: document.querySelector('#announcement-link-type').value,
      linkLabel: document.querySelector('#announcement-link-label').value,
      linkUrl: document.querySelector('#announcement-link-url').value,
      until: document.querySelector('#announcement-until').value
    }) });
    await loadData();
    if (!enabled) showStatus('Saved. The announcement bar is hidden.');
    else if (asNew) showStatus('Published. She will see it on her next visit ✦');
    else showStatus('Saved. Anyone who already closed it will not see it again.');
  } catch (error) {
    showStatus(error.message, true);
  }
});
document.querySelector('#bunny-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request('/api/admin/bunny', { method: 'PUT', body: JSON.stringify({
      enabled: document.querySelector('#bunny-enabled').checked,
      lines: document.querySelector('#bunny-lines').value.split('\n')
    }) });
    await loadData();
    showStatus('Bunny saved ✦');
  } catch (error) {
    showStatus(error.message, true);
  }
});
document.querySelector('#flower-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request('/api/admin/flower', { method: 'PUT', body: JSON.stringify({
      enabled: document.querySelector('#flower-enabled').checked,
      message: document.querySelector('#flower-message').value
    }) });
    await loadData();
    showStatus('Flower secret saved ✿');
  } catch (error) {
    showStatus(error.message, true);
  }
});
document.querySelector('#quote-cancel').addEventListener('click', resetQuoteForm);
document.querySelector('#quote-main').addEventListener('change', renderPinUntilField);
['#popup-mode', '#popup-pool', '#popup-pinned-until'].forEach(selector => {
  document.querySelector(selector).addEventListener('change', renderPopupSettings);
});
function showQuotePreview() {
  const quoteText = document.querySelector('#quote-text').value.trim();
  if (!quoteText) return showStatus('Enter quote text before previewing.', true);
  document.querySelector('#preview-text').textContent = quoteText;
  document.querySelector('#preview-author').textContent = document.querySelector('#quote-author').value.trim();
  document.querySelector('#preview-modal').hidden = false;
}
document.querySelector('#quote-preview').addEventListener('click', showQuotePreview);
['preview-close', 'preview-dismiss'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => {
  document.querySelector('#preview-modal').hidden = true;
}));
logoutButton.addEventListener('click', async () => {
  await request('/api/admin/logout', { method: 'POST' });
  window.location.reload();
});

request('/api/admin/session').then(enterAdmin).catch(() => {});
