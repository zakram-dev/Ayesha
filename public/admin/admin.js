const loginPanel = document.querySelector('#login-panel');
const adminContent = document.querySelector('#admin-content');
const logoutButton = document.querySelector('#logout');
const status = document.querySelector('#status');
let categories = [];
let quotes = [];
let messages = [];
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

function renderMessages() {
  const filter = document.querySelector('#message-status-filter').value;
  const visibleMessages = messages.filter(message => !filter || message.status === filter);
  document.querySelector('#messages').innerHTML = visibleMessages.length
    ? visibleMessages.map(message => `
      <article class="admin-message">
        <div><span class="message-badge ${message.status}">${message.status}</span><small>${escapeHtml(message.name || 'Anonymous')} · ${escapeHtml(message.created_at)}</small></div>
        <p>${escapeHtml(message.message)}</p>
        <label>Where should this appear?
          <select data-field="private-section" data-id="${message.id}">
            <option value="0" ${message.private_section ? '' : 'selected'}>Public notes</option>
            <option value="1" ${message.private_section ? 'selected' : ''}>Love from Kind People</option>
          </select>
        </label>
        <label>Reply (optional)
          <textarea data-field="reply" data-id="${message.id}" maxlength="500" placeholder="Write a reply from Zohaib...">${escapeHtml(message.reply || '')}</textarea>
        </label>
        <div class="message-actions">
          ${message.status !== 'approved' ? '<button class="small-button" data-action="approve-message" data-id="' + message.id + '">Approve</button>' : ''}
          ${message.status !== 'rejected' ? '<button class="small-button secondary" data-action="reject-message" data-id="' + message.id + '">Reject</button>' : ''}
          <button class="small-button secondary" data-action="save-message" data-id="${message.id}">Save note</button>
          <button class="small-button danger" data-action="delete-message" data-id="${message.id}">Delete</button>
        </div>
      </article>`).join('')
    : '<p class="empty-message">No messages in this view.</p>';
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
}

async function loadData() {
  const [dashboard, settings, loadedCategories, loadedQuotes, loadedMessages] = await Promise.all([
    request('/api/admin/dashboard'), request('/api/admin/settings'),
    request('/api/admin/categories'), request('/api/admin/quotes'), request('/api/admin/messages')
  ]);
  categories = loadedCategories;
  quotes = loadedQuotes;
  messages = loadedMessages;
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
  renderPopupSettings();
  renderCategoryOptions();
  renderQuotes();
  renderCategories();
  renderMessages();
}

async function enterAdmin() {
  loginPanel.hidden = true;
  adminContent.hidden = false;
  logoutButton.hidden = false;
  await loadData();
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
document.querySelector('#message-status-filter').addEventListener('change', renderMessages);
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
document.querySelector('#messages').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.dataset.action === 'delete-message' && !confirm('Delete this message?')) return;
    if (button.dataset.action === 'delete-message') {
      await request(`/api/admin/messages/${button.dataset.id}`, { method: 'DELETE' });
    } else if (button.dataset.action === 'save-message') {
      const card = button.closest('.admin-message');
      await request(`/api/admin/messages/${button.dataset.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: messages.find(message => String(message.id) === button.dataset.id).status,
          privateSection: card.querySelector('[data-field="private-section"]').value === '1',
          reply: card.querySelector('[data-field="reply"]').value
        })
      });
    } else {
      const nextStatus = button.dataset.action === 'approve-message' ? 'approved' : 'rejected';
      const card = button.closest('.admin-message');
      await request(`/api/admin/messages/${button.dataset.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: nextStatus,
          privateSection: card.querySelector('[data-field="private-section"]').value === '1',
          reply: card.querySelector('[data-field="reply"]').value
        })
      });
    }
    await loadData();
    showStatus('Message updated.');
  } catch (error) {
    showStatus(error.message, true);
  }
});
document.querySelector('#private-password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const passwordStatus = document.querySelector('#private-password-status');
  try {
    await request('/api/admin/private-section/password', {
      method: 'PUT',
      body: JSON.stringify({ password: document.querySelector('#private-section-password').value })
    });
    event.target.reset();
    passwordStatus.textContent = 'Private section password saved.';
    passwordStatus.className = 'status';
    showStatus('Private section password updated.');
  } catch (error) {
    passwordStatus.textContent = error.message;
    passwordStatus.className = 'status error';
  }
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
