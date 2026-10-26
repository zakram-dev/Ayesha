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

function renderQuotes() {
  const search = document.querySelector('#quote-search').value.toLowerCase();
  const categoryFilter = document.querySelector('#quote-category-filter').value;
  document.querySelector('#quotes').innerHTML = quotes
    .filter(quote => (!categoryFilter || String(quote.category_id) === categoryFilter)
      && (quote.text.toLowerCase().includes(search) || quote.category_name.toLowerCase().includes(search)))
    .map(quote => `<tr><td>${escapeHtml(quote.text)}${quote.is_main_quote ? '<b class="badge">pinned</b>' : ''}</td><td>${escapeHtml(quote.category_name)}</td><td>${escapeHtml(quote.status || (quote.active ? 'active' : 'archived'))}</td><td><button class="small-button" data-action="edit-quote" data-id="${quote.id}">Edit</button> <button class="small-button" data-action="toggle-quote" data-id="${quote.id}">${quote.status === 'active' ? 'Archive' : 'Activate'}</button> <button class="small-button danger" data-action="delete-quote" data-id="${quote.id}">Delete</button></td></tr>`).join('');
}

function renderCategories() {
  document.querySelector('#categories').innerHTML = categories.map(category => `<tr><td>${escapeHtml(category.name)}<small class="category-card-title">${escapeHtml(category.card_title || '')}</small></td><td>${escapeHtml(category.slug)}</td><td>${category.quote_count}</td><td>${category.active ? 'Active' : 'Inactive'}</td><td><button class="small-button" data-action="edit-category" data-id="${category.id}">Edit</button> <button class="small-button" data-action="add-quote" data-id="${category.id}">Add quote</button> <button class="small-button" data-action="toggle-category" data-id="${category.id}">${category.active ? 'Deactivate' : 'Activate'}</button> <button class="small-button danger" data-action="delete-category" data-id="${category.id}">Delete</button></td></tr>`).join('');
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
  if (tabName === 'voice') {
    loadVoiceThread();
    loadAlerts();
    voicePollTimer = window.setInterval(loadVoiceThread, 20000);
  } else {
    voicePlayer.stop();
  }
}

// ---- Voice notes with Ayesha ----
const voiceThread = document.querySelector('#admin-voice-thread');
const voicePlayer = window.VoiceKit.attachPlayer(voiceThread);
let voicePollTimer = null;

function showVoiceBadge(unread) {
  const badge = document.querySelector('#voice-tab-badge');
  badge.hidden = !unread;
  badge.textContent = unread || '';
}

async function loadVoiceThread() {
  try {
    const messages = await request('/api/admin/voice/messages');
    window.VoiceKit.renderThread(voiceThread, messages, {
      me: 'zohaib',
      names: { ayesha: 'Ayesha', zohaib: 'You' },
      canDelete: () => true
    });
    showVoiceBadge(0);
  } catch (error) {
    showStatus(error.message, true);
  }
}

window.VoiceKit.mountComposer(document.querySelector('#admin-voice-composer'), {
  placeholder: 'or type a little message to Ayesha…',
  async sendVoice(recording) {
    await window.VoiceKit.uploadVoice('/api/admin/voice/messages/audio', recording);
    await loadVoiceThread();
  },
  async sendText(text) {
    await request('/api/admin/voice/messages', { method: 'POST', body: JSON.stringify({ text }) });
    await loadVoiceThread();
  }
});

voiceThread.addEventListener('click', async event => {
  const button = event.target.closest('.voice-delete');
  if (!button || !confirm('Delete this message for both of you?')) return;
  try {
    await request(`/api/admin/voice/messages/${button.dataset.id}`, { method: 'DELETE' });
    await loadVoiceThread();
  } catch (error) {
    showStatus(error.message, true);
  }
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
  const [dashboard, settings, loadedCategories, loadedQuotes] = await Promise.all([
    request('/api/admin/dashboard'), request('/api/admin/settings'),
    request('/api/admin/categories'), request('/api/admin/quotes')
  ]);
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
      active: document.querySelector('#category-active')?.checked ?? true
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
      document.querySelector('#category-submit').textContent = 'Save changes';
      document.querySelector('#category-cancel').hidden = false;
      window.scrollTo({ top: document.querySelector('#category-form').offsetTop, behavior: 'smooth' });
      return;
    }
    if (button.dataset.action === 'delete-category' && confirm('Delete this category?')) await request(`/api/admin/categories/${category.id}`, { method: 'DELETE' });
    if (button.dataset.action === 'toggle-category') await request(`/api/admin/categories/${category.id}`, { method: 'PUT', body: JSON.stringify({ ...category, active: !category.active }) });
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
document.querySelector('#category-cancel').addEventListener('click', () => {
  editingCategoryId = null;
  document.querySelector('#category-form').reset();
  document.querySelector('#category-submit').textContent = 'Add category';
  document.querySelector('#category-cancel').hidden = true;
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
