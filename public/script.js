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

// ---- Seasonal outfits: the bunny dresses up on special days, by her own calendar. ----
// Add ?season=halloween to the address to preview a costume early (or ?season=none to hide it).
const seasonalBunnyLines = {
  halloween: {
    day: ['boo! ♡', 'trick or treat?', 'happy halloween, ayesha', 'i dressed up just for you'],
    night: ['zzz… boo…', 'dreaming of pumpkins…', 'shh… the bats are out']
  }
};

function seasonFor(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if ((month === 10 && day >= 30) || (month === 11 && day === 1)) return 'halloween';
  return '';
}

const previewSeason = new URLSearchParams(window.location.search).get('season');
const season = previewSeason === 'none' ? '' : (seasonalBunnyLines[previewSeason] ? previewSeason : seasonFor(new Date()));
if (season) document.documentElement.dataset.season = season;

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
  const night = document.documentElement.dataset.theme === 'night';
  const seasonal = seasonalBunnyLines[season]?.[night ? 'night' : 'day'] || [];
  const lines = [...(night ? sleepyBunnyLines : [...bunnyLines, ...flowerHintLines()]), ...seasonal];
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

// The bunny says something in its bubble for a few seconds (never over a waiting letter).
function bunnySay(line, ms = 3600) {
  if (bunny.hidden || bunnyHasMail) return;
  bunnyBubble.classList.remove('mail');
  bunnyBubble.textContent = line;
  bunnyBubble.hidden = false;
  replayClass(bunnyBubble, 'pop');
  window.clearTimeout(bunnyBubbleTimer);
  bunnyBubbleTimer = window.setTimeout(() => { bunnyBubble.hidden = true; }, ms);
}

bunny.addEventListener('click', () => {
  if (bunnyHasMail) return openMailboxFromBunny();
  replayClass(bunny, 'hop');
  bunnySay(nextBunnyLine(), 2800);
});
bunnyBubble.addEventListener('click', () => { if (bunnyHasMail) openMailboxFromBunny(); });

fetch('/api/bunny').then(response => (response.ok ? response.json() : null)).then(settings => {
  if (!settings?.enabled || !settings.lines.length) return;
  bunnyLines = settings.lines;
  bunny.hidden = false;
  showBunnyMail();
  refreshWardrobe();
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12 && document.documentElement.dataset.theme !== 'night') {
    window.setTimeout(() => { if (!bunnyHasMail) replayClass(bunny, 'waving'); }, 900);
  }
}).catch(error => console.warn('Unable to load the bunny.', error));

// ---- Tap the flower: each tap blooms it a little more and drifts petals down; 7 quick taps reveal a secret. ----
const flower = document.querySelector('#flower');
const petalFall = document.querySelector('#petal-fall');
const flowerSecret = document.querySelector('#flower-secret');
const flowerSecretFoundKey = 'ayesha-flower-secret-found';
const tapsForSecret = 7;
const tapSeriesGapMs = 2500;
let flowerSettings = { enabled: false, message: '' };
let flowerTaps = 0;
let lastFlowerTap = 0;
let flowerRestTimer = null;
let flowerSecretTimer = null;

function flowerSecretFound() {
  try {
    return localStorage.getItem(flowerSecretFoundKey) === 'yes';
  } catch (error) {
    return false;
  }
}

// Until she finds the secret, the bunny sometimes gives a hint.
function flowerHintLines() {
  return flowerSettings.enabled && !flowerSecretFound() ? ['psst… tap the big flower ✿'] : [];
}

// Petals start around the middle of the flower and drift down past the bottom of the arch, each a bit different.
function dropPetals(count) {
  if (reducedMotion.matches) return;
  const art = flower.parentElement.getBoundingClientRect();
  const bloom = flower.getBoundingClientRect();
  const originX = bloom.left + bloom.width / 2 - art.left;
  const originY = bloom.top + bloom.height / 2 - art.top;
  for (let index = 0; index < count && petalFall.childElementCount < 45; index += 1) {
    const petal = document.createElement('span');
    const size = 9 + Math.random() * 7;
    petal.className = 'falling-petal';
    petal.style.cssText = `left:${(originX + (Math.random() - 0.5) * 140).toFixed(1)}px;top:${(originY + (Math.random() - 0.5) * 70).toFixed(1)}px;`
      + `width:${size.toFixed(1)}px;height:${(size * 1.35).toFixed(1)}px;`
      + `--dx:${Math.round((Math.random() - 0.5) * 240)}px;--dy:${Math.round(art.height - originY + 30)}px;--spin:${Math.round((Math.random() - 0.5) * 540)}deg;`
      + `animation-duration:${(1.8 + Math.random() * 1.4).toFixed(2)}s;animation-delay:${(Math.random() * 0.15).toFixed(2)}s`;
    petal.addEventListener('animationend', () => petal.remove());
    petalFall.append(petal);
  }
}

function hideFlowerSecret() {
  window.clearTimeout(flowerSecretTimer);
  flowerSecret.hidden = true;
}

function revealFlowerSecret() {
  document.querySelector('#flower-secret-text').textContent = flowerSettings.message;
  flowerSecret.hidden = false;
  replayClass(flowerSecret, 'pop');
  dropPetals(18);
  try {
    localStorage.setItem(flowerSecretFoundKey, 'yes');
  } catch (error) {
    // Without storage the bunny just keeps hinting; nothing else changes.
  }
  window.clearTimeout(flowerSecretTimer);
  flowerSecretTimer = window.setTimeout(hideFlowerSecret, 9000);
  // Finding the secret unlocks the bunny's star clip; let her read the card first.
  window.setTimeout(refreshWardrobe, 2500);
}

flower.addEventListener('click', () => {
  const now = Date.now();
  // Taps count as one series while they come within 2.5 seconds of each other.
  flowerTaps = now - lastFlowerTap > tapSeriesGapMs ? 1 : flowerTaps + 1;
  lastFlowerTap = now;
  flower.style.setProperty('--grow', String(1 + Math.min(flowerTaps, tapsForSecret) * 0.025));
  replayClass(flower, 'tapped');
  dropPetals(4);
  if (flowerTaps >= tapsForSecret && flowerSettings.enabled && flowerSettings.message) {
    flowerTaps = 0;
    revealFlowerSecret();
  }
  // Settle back to its normal size once the taps stop.
  window.clearTimeout(flowerRestTimer);
  flowerRestTimer = window.setTimeout(() => flower.style.setProperty('--grow', '1'), tapSeriesGapMs);
});
document.querySelector('#flower-secret-close').addEventListener('click', hideFlowerSecret);

fetch('/api/flower').then(response => (response.ok ? response.json() : null)).then(settings => {
  if (settings) flowerSettings = settings;
}).catch(error => console.warn('Unable to load the flower secret.', error));

// ---- Bunny wardrobe: she dresses the bunny up; some pieces unlock with visits or the flower secret. ----
// All of it lives in her own browser: the outfit, how many days she has visited, and which pieces she has seen.
const wardrobeItems = [
  { id: 'bow', slot: 'head', icon: '🎀', name: 'pink bow' },
  { id: 'glasses', slot: 'face', icon: '👓', name: 'round glasses' },
  { id: 'scarf', slot: 'neck', icon: '🧣', name: 'cozy scarf' },
  { id: 'flowers', slot: 'head', icon: '🌸', name: 'flower crown', days: 3 },
  { id: 'crown', slot: 'head', icon: '👑', name: 'little crown', days: 7 },
  { id: 'star', slot: 'ear', icon: '⭐', name: 'star clip', secret: true }
];
const wardrobeSlots = ['head', 'ear', 'face', 'neck'];
const outfitKey = 'ayesha-bunny-outfit';
const visitDaysKey = 'ayesha-bunny-visit-days';
const seenItemsKey = 'ayesha-bunny-seen-items';
const wardrobe = document.querySelector('#wardrobe');
const wardrobeToggle = document.querySelector('#wardrobe-toggle');
const wardrobeNote = document.querySelector('#wardrobe-note');

function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Without storage the bunny simply forgets between visits.
  }
}

// Counts the different days she has visited, by her own calendar.
function countVisitDay() {
  const today = new Date().toLocaleDateString('en-CA');
  const record = readStored(visitDaysKey, { count: 0, last: '' });
  if (record.last !== today) {
    record.count = (Number(record.count) || 0) + 1;
    record.last = today;
    writeStored(visitDaysKey, record);
  }
  return record.count;
}

const visitDays = countVisitDay();

function isUnlocked(item) {
  if (item.days) return visitDays >= item.days;
  if (item.secret) return flowerSecretFound();
  return true;
}

function unlockHint(item) {
  if (item.days) return `unlocks after visiting on ${item.days} different days (${Math.min(visitDays, item.days)} so far) ♡`;
  return "unlocks when you find the flower's secret ✿";
}

function currentOutfit() {
  const saved = readStored(outfitKey, {});
  return Object.fromEntries(wardrobeSlots.map(slot => {
    const item = wardrobeItems.find(entry => entry.slot === slot && entry.id === saved?.[slot]);
    return [slot, item && isUnlocked(item) ? item.id : ''];
  }));
}

function applyOutfit(outfit) {
  wardrobeSlots.forEach(slot => {
    if (outfit[slot]) bunny.dataset[slot] = outfit[slot];
    else delete bunny.dataset[slot];
  });
}

function unseenItems() {
  const seen = readStored(seenItemsKey, []);
  return wardrobeItems.filter(item => isUnlocked(item) && !seen.includes(item.id));
}

function renderWardrobe() {
  const outfit = currentOutfit();
  const unseen = unseenItems().map(item => item.id);
  document.querySelector('#wardrobe-items').innerHTML = wardrobeItems.map(item => {
    const unlocked = isUnlocked(item);
    return `<button class="wardrobe-item${unlocked ? '' : ' locked'}${unseen.includes(item.id) ? ' is-new' : ''}" type="button"
      data-item="${item.id}" aria-pressed="${outfit[item.slot] === item.id}" aria-label="${item.name}${unlocked ? '' : ' (locked)'}"
      title="${item.name}"><span>${item.icon}</span></button>`;
  }).join('');
  document.querySelector('#wardrobe-new').hidden = !unseen.length;
}

// Runs once the bunny appears and again when something unlocks: wears her outfit and mentions new pieces once.
function refreshWardrobe() {
  if (bunny.hidden) return;
  wardrobeToggle.hidden = false;
  applyOutfit(currentOutfit());
  renderWardrobe();
  const unseen = unseenItems();
  if (!unseen.length || !wardrobe.hidden) return;
  const firstTime = readStored(seenItemsKey, null) === null;
  bunnySay(firstTime ? 'psst… you can dress me up now 🎀' : `✨ new outfit for me: ${unseen[unseen.length - 1].name}!`);
}

function openWardrobe() {
  renderWardrobe();
  wardrobeNote.textContent = 'tap to put on or take off ♡';
  wardrobe.hidden = false;
  wardrobeToggle.setAttribute('aria-expanded', 'true');
  if (!bunnyHasMail) bunnyBubble.hidden = true;
  writeStored(seenItemsKey, wardrobeItems.filter(isUnlocked).map(item => item.id));
  document.querySelector('#wardrobe-new').hidden = true;
}

function closeWardrobe() {
  wardrobe.hidden = true;
  wardrobeToggle.setAttribute('aria-expanded', 'false');
}

wardrobeToggle.addEventListener('click', () => (wardrobe.hidden ? openWardrobe() : closeWardrobe()));
document.querySelector('#wardrobe-done').addEventListener('click', closeWardrobe);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !wardrobe.hidden) closeWardrobe(); });

document.querySelector('#wardrobe-items').addEventListener('click', event => {
  const button = event.target.closest('.wardrobe-item');
  if (!button) return;
  const item = wardrobeItems.find(entry => entry.id === button.dataset.item);
  if (!isUnlocked(item)) {
    wardrobeNote.textContent = `${item.icon} ${unlockHint(item)}`;
    return;
  }
  const outfit = currentOutfit();
  outfit[item.slot] = outfit[item.slot] === item.id ? '' : item.id;
  writeStored(outfitKey, outfit);
  applyOutfit(outfit);
  replayClass(bunny, 'hop');
  // Only one piece per spot: update every button so a swapped-out piece un-highlights.
  document.querySelectorAll('.wardrobe-item').forEach(other => {
    const otherItem = wardrobeItems.find(entry => entry.id === other.dataset.item);
    other.setAttribute('aria-pressed', String(outfit[otherItem.slot] === otherItem.id));
  });
  const halloweenHat = season === 'halloween' && item.slot === 'head' && outfit.head;
  wardrobeNote.textContent = halloweenHat
    ? `${item.icon} saved for after halloween, the witch hat is on today 🎃`
    : `${item.icon} ${item.name} ${outfit[item.slot] ? 'on ♡' : 'off'}`;
});

if (new URLSearchParams(window.location.search).has('insights')) {
  const insights = document.querySelector('#insights');
  insights.hidden = false;
  renderInsights();
  document.querySelector('#clear-insights').addEventListener('click', () => {
    localStorage.removeItem(analyticsKey);
    renderInsights();
  });
}
