const modal = document.querySelector('#message-modal');
const label = document.querySelector('#modal-label');
const title = document.querySelector('#modal-title');
const text = document.querySelector('#modal-message');
const noteGrid = document.querySelector('.note-grid');
let activeMood = 'welcome';
let activeQuote = null;

const analyticsKey = 'ayesha-gift-insights';
const recentQuotesKey = 'ayesha-recent-quotes';
const analyticsSessionKey = 'ayesha-analytics-session';
const popupSeenKey = 'ayesha-popup-seen';
function getAnalyticsSessionId() {
  let sessionId = sessionStorage.getItem(analyticsSessionKey);
  if (!sessionId) {
    sessionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(analyticsSessionKey, sessionId);
  }
  return sessionId;
}
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
  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType: type,
      quoteId: Number.isInteger(details.quoteId) ? details.quoteId : null,
      categoryId: Number.isInteger(details.categoryId) ? details.categoryId : null,
      sessionId: getAnalyticsSessionId()
    }),
    keepalive: true
  }).catch(error => console.warn('Unable to send analytics event.', error));
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
      <button class="mood-card ${categoryClass(category.color)}" data-mood="${escapeHtml(category.slug)}" data-category-id="${category.id}" data-track="mood-${escapeHtml(category.slug)}">
        <span class="card-icon">${categoryIcon(category.slug)}</span>
        <strong>${escapeHtml(category.card_title || `A little ${category.name.toLowerCase()}`)}</strong>
        <small>${escapeHtml(categoryDescription(category))}</small>
        <i>→</i>
      </button>`).join('')
    : '<p class="notes-loading">There are no feeling categories yet.</p>';

  noteGrid.querySelectorAll('.mood-card').forEach(card => card.addEventListener('click', () => {
    recordEvent('click', { target: card.dataset.track, mood: card.dataset.mood, categoryId: Number(card.dataset.categoryId) });
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
    recordEvent('message-viewed', { mood, quoteId: activeQuote.id, categoryId: activeQuote.category_id });
  } catch (error) {
    activeQuote = null;
    text.textContent = 'The notes are taking a tiny pause. Please try again in a moment.';
    console.warn('Unable to load quote.', error);
  }
}

function getSeenPopupQuotes() {
  try {
    const seen = JSON.parse(localStorage.getItem(popupSeenKey) || '[]');
    return Array.isArray(seen) ? seen.filter(Number.isInteger) : [];
  } catch (error) {
    return [];
  }
}

// Remembers rotated popup quotes so the next visit gets one she hasn't seen; the server says when the deck starts over.
function rememberPopupQuote(quote) {
  if (quote.popup.source !== 'rotation') return;
  const seen = quote.popup.deckReset ? [] : getSeenPopupQuotes();
  try {
    localStorage.setItem(popupSeenKey, JSON.stringify([...seen.filter(id => id !== quote.id), quote.id].slice(-1000)));
  } catch (error) {
    console.warn('Unable to save seen popup quotes.', error);
  }
}

async function showMainQuote() {
  try {
    const today = new Date().toLocaleDateString('en-CA');
    const response = await fetch(`/api/quotes/main?today=${today}&exclude=${getSeenPopupQuotes().join(',')}`);
    if (!response.ok) return;
    const quote = await response.json();
    if (!shouldShowMainQuote(quote.popup.frequency)) return null;
    rememberPopupQuote(quote);
    await new Promise(resolve => window.setTimeout(resolve, quote.popup.delay));
    activeMood = quote.category.slug;
    activeQuote = quote;
    label.textContent = 'a little welcome for you';
    title.textContent = 'A thought to start with.';
    text.textContent = quote.text;
    recordEvent('main-quote-seen', { quoteId: quote.id, categoryId: quote.category.id, mood: quote.category.slug });
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
function closeModal() {
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

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

// ---- Announcement bar: set in admin; closing it remembers that version so it stays hidden until a new one is published. ----
const announcementBar = document.querySelector('#announcement');
const announcementClosedKey = 'ayesha-announcement-closed';

function closedAnnouncementVersion() {
  try {
    return Number(localStorage.getItem(announcementClosedKey)) || 0;
  } catch (error) {
    return 0;
  }
}

async function showAnnouncement() {
  try {
    const response = await fetch(`/api/announcement?today=${new Date().toLocaleDateString('en-CA')}`);
    if (response.status !== 200) return;
    const announcement = await response.json();
    if (announcement.version === closedAnnouncementVersion()) return;
    document.querySelector('#announcement-text').textContent = announcement.text;
    const action = document.querySelector('#announcement-action');
    action.hidden = !announcement.link;
    if (announcement.link) {
      action.textContent = `${announcement.link.label} →`;
      action.href = announcement.link.type === 'mailbox' ? '#voice-notes' : announcement.link.url;
      action.target = /^https?:/i.test(action.getAttribute('href')) ? '_blank' : '';
      action.rel = action.target ? 'noopener' : '';
      action.onclick = announcement.link.type === 'mailbox'
        ? event => { event.preventDefault(); document.querySelector('#open-voice-notes').click(); }
        : null;
    }
    announcementBar.dataset.version = announcement.version;
    announcementBar.hidden = false;
  } catch (error) {
    console.warn('Unable to load the announcement.', error);
  }
}

document.querySelector('#announcement-close').addEventListener('click', () => {
  try {
    localStorage.setItem(announcementClosedKey, announcementBar.dataset.version);
  } catch (error) {
    // Without storage it simply shows again next visit.
  }
  announcementBar.classList.add('is-closing');
  const hide = () => { announcementBar.hidden = true; announcementBar.classList.remove('is-closing'); };
  if (reducedMotion.matches) hide();
  else announcementBar.addEventListener('animationend', hide, { once: true });
});

showAnnouncement();

const themeToggle = document.querySelector('#theme-toggle');
const greeting = document.querySelector('#greeting');
const artNote = document.querySelector('#art-note');
const nightSky = document.querySelector('#night-sky');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function greetingFor(hour) {
  if (hour >= 5 && hour < 12) return 'good morning, ayesha';
  if (hour >= 12 && hour < 17) return 'a little afternoon hello';
  if (hour >= 17 && hour < 19) return 'good evening, ayesha';
  return 'a soft corner for late nights';
}

function renderTheme(theme) {
  const night = theme === 'night';
  themeToggle.textContent = night ? '☼' : '☾';
  themeToggle.setAttribute('aria-label', night ? 'Switch to day mode' : 'Switch to night mode');
  themeToggle.setAttribute('aria-pressed', String(night));
  greeting.textContent = greetingFor(new Date().getHours());
  artNote.innerHTML = night ? 'some things<br /><em>glow</em> at night' : 'some things are<br /><em>lovely</em> just because';
}

function scatterStars(count = 70) {
  const stars = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const star = document.createElement('span');
    const size = [1.5, 2, 2, 3][Math.floor(Math.random() * 4)];
    star.className = 'star';
    star.style.cssText = `top:${(Math.random() * 100).toFixed(2)}%;left:${(Math.random() * 100).toFixed(2)}%;`
      + `width:${size}px;height:${size}px;animation-delay:${(Math.random() * 5).toFixed(2)}s;animation-duration:${(3 + Math.random() * 4).toFixed(2)}s`;
    stars.append(star);
  }
  nightSky.append(stars);
}

themeToggle.addEventListener('click', () => {
  const switchTheme = () => renderTheme(window.ayeshaTheme.toggle());
  if (document.startViewTransition && !reducedMotion.matches) document.startViewTransition(switchTheme);
  else switchTheme();
});

scatterStars();
renderTheme(window.ayeshaTheme.current());
// Follow the clock while the page stays open, e.g. turn to night at 7pm.
window.setInterval(() => renderTheme(window.ayeshaTheme.apply()), 60 * 1000);

// ---- Sleepy bunny: its pose follows the day/night theme in CSS; tapping it hops and says something sweet. ----
const bunny = document.querySelector('#bunny');
const bunnyBubble = document.querySelector('#bunny-bubble');
const sleepyBunnyLines = ['zzz…', 'five more minutes…', 'sweet dreams, ayesha ♡', 'shh… dreaming'];
let bunnyLines = [];
let lastBunnyLine = '';
let bunnyBubbleTimer = null;

// Removing and re-adding a class restarts its animation, so every tap gets a fresh hop.
function replayClass(element, className) {
  element.classList.remove(className);
  void element.getBoundingClientRect();
  element.classList.add(className);
}

function nextBunnyLine() {
  const lines = document.documentElement.dataset.theme === 'night' ? sleepyBunnyLines : bunnyLines;
  const choices = lines.length > 1 ? lines.filter(line => line !== lastBunnyLine) : lines;
  lastBunnyLine = choices[Math.floor(Math.random() * choices.length)];
  return lastBunnyLine;
}

// The bunny brings the mail: while Zohaib's replies are unread, it holds a letter and tapping it opens the mailbox.
// voice-notes.js reports the unread count (only her signed-in browser can know it).
let mailboxUnread = 0;
let bunnyHasMail = false;

function bunnyMailLine() {
  return document.documentElement.dataset.theme === 'night' ? 'zzz… a letter came for you ♡' : 'psst… you have mail ♡';
}

function showBunnyMail() {
  if (bunny.hidden) return;
  const hadMail = bunnyHasMail;
  bunnyHasMail = mailboxUnread > 0;
  bunny.classList.toggle('has-mail', bunnyHasMail);
  bunny.setAttribute('aria-label', bunnyHasMail ? 'You have mail. Open our mailbox' : 'Say hi to the bunny');
  window.clearTimeout(bunnyBubbleTimer);
  if (bunnyHasMail) {
    bunnyBubble.textContent = bunnyMailLine();
    bunnyBubble.classList.add('mail');
    bunnyBubble.hidden = false;
    if (!hadMail) {
      replayClass(bunny, 'hop');
      replayClass(bunnyBubble, 'pop');
    }
  } else if (hadMail) {
    bunnyBubble.classList.remove('mail');
    bunnyBubble.hidden = true;
  }
}

function openMailboxFromBunny() {
  document.querySelector('#open-voice-notes').click();
}

window.addEventListener('mailbox:unread', event => {
  mailboxUnread = event.detail.unread;
  showBunnyMail();
});
// Keep the bubble's wording in step with day and night while a letter is waiting.
new MutationObserver(() => { if (bunnyHasMail) bunnyBubble.textContent = bunnyMailLine(); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

bunny.addEventListener('click', () => {
  if (bunnyHasMail) return openMailboxFromBunny();
  replayClass(bunny, 'hop');
  bunnyBubble.classList.remove('mail');
  bunnyBubble.textContent = nextBunnyLine();
  bunnyBubble.hidden = false;
  replayClass(bunnyBubble, 'pop');
  window.clearTimeout(bunnyBubbleTimer);
  bunnyBubbleTimer = window.setTimeout(() => { bunnyBubble.hidden = true; }, 2800);
});
bunnyBubble.addEventListener('click', () => { if (bunnyHasMail) openMailboxFromBunny(); });

fetch('/api/bunny').then(response => (response.ok ? response.json() : null)).then(settings => {
  if (!settings?.enabled || !settings.lines.length) return;
  bunnyLines = settings.lines;
  bunny.hidden = false;
  showBunnyMail();
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12 && document.documentElement.dataset.theme !== 'night') {
    window.setTimeout(() => { if (!bunnyHasMail) replayClass(bunny, 'waving'); }, 900);
  }
}).catch(error => console.warn('Unable to load the bunny.', error));

if (new URLSearchParams(window.location.search).has('insights')) {
  const insights = document.querySelector('#insights');
  insights.hidden = false;
  renderInsights();
  document.querySelector('#clear-insights').addEventListener('click', () => {
    localStorage.removeItem(analyticsKey);
    renderInsights();
  });
}
