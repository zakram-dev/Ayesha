const modal = document.querySelector('#message-modal');
const label = document.querySelector('#modal-label');
const title = document.querySelector('#modal-title');
const text = document.querySelector('#modal-message');
const noteGrid = document.querySelector('.note-grid');
let activeMood = 'welcome';
let activeQuote = null;

const analyticsKey = 'ayesha-gift-insights';
const recentQuotesKey = 'ayesha-recent-quotes';
function getAnalytics() {
  try {
    return JSON.parse(localStorage.getItem(analyticsKey) || '[]');
  } catch (error) {
    console.warn('Unable to read local insights.', error);
    return [];
  }
}

function recordEvent(type, details = {}) {
  const events = getAnalytics();
  events.push({ type, ...details, timestamp: new Date().toISOString() });
  try {
    localStorage.setItem(analyticsKey, JSON.stringify(events.slice(-500)));
  } catch (error) {
    console.warn('Unable to save local insights.', error);
  }
}

async function fetchQuote(mood) {
  const recentQuotes = getRecentQuotes(mood);
  const exclude = recentQuotes.length ? `&exclude=${recentQuotes.join(',')}` : '';
  const response = await fetch(`/api/quotes/random?category=${encodeURIComponent(mood)}${exclude}`);
  if (!response.ok) throw new Error('The quote could not be loaded right now.');
  const quote = await response.json();
  rememberQuote(mood, quote.id);
  return quote;
}

function getRecentQuotes(mood) {
  try {
    const history = JSON.parse(localStorage.getItem(recentQuotesKey) || '{}');
    return Array.isArray(history[mood]) ? history[mood].filter(Number.isInteger).slice(-10) : [];
  } catch (error) {
    console.warn('Unable to read recent quote history.', error);
    return [];
  }
}

function rememberQuote(mood, quoteId) {
  try {
    const history = JSON.parse(localStorage.getItem(recentQuotesKey) || '{}');
    const recent = Array.isArray(history[mood]) ? history[mood] : [];
    history[mood] = [...recent.filter(id => id !== quoteId), quoteId].slice(-10);
    localStorage.setItem(recentQuotesKey, JSON.stringify(history));
  } catch (error) {
    console.warn('Unable to save recent quote history.', error);
  }
}

async function fetchCategories() {
  const response = await fetch('/api/categories');
  if (!response.ok) throw new Error('The categories could not be loaded right now.');
  return response.json();
}

function categoryIcon(slug) {
  return { sunny: '☼', soft: '♡', brave: '✦', calm: '◌', romantic: '♡', funny: '☻' }[slug] || '✦';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}

function categoryClass(color) {
  return ['peach', 'pink', 'lavender', 'blue', 'ink'].includes(color) ? color : 'pink';
}

function categoryDescription(category) {
  return category.description || `A little note for a ${category.name.toLowerCase()} moment.`;
}

function renderCategories(categories) {
  const visibleCategories = categories.filter(category => !['welcome', 'distract'].includes(category.slug));
  noteGrid.innerHTML = visibleCategories.length
    ? visibleCategories.map(category => `
      <button class="mood-card ${categoryClass(category.color)}" data-mood="${escapeHtml(category.slug)}" data-track="mood-${escapeHtml(category.slug)}">
        <span class="card-icon">${categoryIcon(category.slug)}</span>
        <strong>For a ${escapeHtml(category.name.toLowerCase())} moment</strong>
        <small>${escapeHtml(categoryDescription(category))}</small>
        <i>→</i>
      </button>`).join('')
    : '<p class="notes-loading">There are no feeling categories yet.</p>';

  noteGrid.querySelectorAll('.mood-card').forEach(card => card.addEventListener('click', () => {
    recordEvent('click', { target: card.dataset.track, mood: card.dataset.mood });
    showMessage(card.dataset.mood);
  }));
}

async function showMessage(mood = 'welcome') {
  activeMood = mood;
  const distract = mood === 'distract';
  label.textContent = distract ? 'a lovely little detour' : 'a small note for Ayesha';
  title.textContent = distract ? 'A pause, just for you.' : 'Here is a little something.';
  text.textContent = 'Finding a little something...';
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');

  try {
    activeQuote = await fetchQuote(mood);
    text.textContent = activeQuote.text;
    recordEvent('message-viewed', { mood, quoteId: activeQuote.id });
  } catch (error) {
    activeQuote = null;
    text.textContent = 'The notes are taking a tiny pause. Please try again in a moment.';
    console.warn('Unable to load quote.', error);
  }
}

async function showMainQuote() {
  try {
    const response = await fetch('/api/quotes/main');
    if (!response.ok) return;
    const quote = await response.json();
    if (!shouldShowMainQuote(quote.popup.frequency)) return null;
    await new Promise(resolve => window.setTimeout(resolve, quote.popup.delay));
    activeMood = quote.category.slug;
    activeQuote = quote;
    label.textContent = 'a little welcome for you';
    title.textContent = 'A thought to start with.';
    text.textContent = quote.text;
    recordEvent('main-quote-seen', { quoteId: quote.id, mood: quote.category.slug });
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    if (quote.popup.frequency === 'day') localStorage.setItem('mainQuoteShownOn', new Date().toISOString().slice(0, 10));
    if (quote.popup.frequency === 'session') sessionStorage.setItem('mainQuoteShown', 'true');
    return quote.popup;
  } catch (error) {
    console.warn('Unable to load the main quote.', error);
    return null;
  }
}

document.querySelector('#open-note').addEventListener('click', () => { recordEvent('click', { target: 'open-note' }); showMessage(); });
document.querySelector('#random-note').addEventListener('click', () => { recordEvent('click', { target: 'random-note' }); showMessage(); });
document.querySelector('#distract-me').addEventListener('click', () => { recordEvent('click', { target: 'distraction' }); showMessage('distract'); });
document.querySelector('#another-note').addEventListener('click', () => showMessage(activeMood));
document.querySelector('#close-modal').addEventListener('click', closeModal);
modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
function closeModal() { modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); }

fetchCategories().then(renderCategories).catch(error => {
  noteGrid.innerHTML = '<p class="notes-loading">The feelings are taking a tiny pause. Please try again soon.</p>';
  console.warn('Unable to load categories.', error);
});

function shouldShowMainQuote(frequency) {
  if (frequency === 'always') return true;
  if (frequency === 'day') return localStorage.getItem('mainQuoteShownOn') !== new Date().toISOString().slice(0, 10);
  return !sessionStorage.getItem('mainQuoteShown');
}

if (!sessionStorage.getItem('mainQuoteChecked')) {
  showMainQuote();
  sessionStorage.setItem('mainQuoteChecked', 'true');
}

function renderInsights() {
  const events = getAnalytics();
  const moods = events.filter(event => event.type === 'click' && event.mood).reduce((counts, event) => {
    counts[event.mood] = (counts[event.mood] || 0) + 1;
    return counts;
  }, {});
  const favoriteMood = Object.entries(moods).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  document.querySelector('#total-interactions').textContent = events.length;
  document.querySelector('#top-mood').textContent = favoriteMood;
}

if (new URLSearchParams(window.location.search).has('insights')) {
  const insights = document.querySelector('#insights');
  insights.hidden = false;
  renderInsights();
  document.querySelector('#clear-insights').addEventListener('click', () => {
    localStorage.removeItem(analyticsKey);
    renderInsights();
  });
}
