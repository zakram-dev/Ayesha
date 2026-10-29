const modal = document.querySelector('#message-modal');
const label = document.querySelector('#modal-label');
const title = document.querySelector('#modal-title');
const text = document.querySelector('#modal-message');
const noteGrid = document.querySelector('.note-grid');
const anotherNote = document.querySelector('#another-note');
const modalStar = modal.querySelector('.modal-star');
const sealForm = document.querySelector('#seal-form');
const sealPassword = document.querySelector('#seal-password');
const sealStatus = document.querySelector('#seal-status');
const noteReact = document.querySelector('#note-react');
const noteIcons = document.querySelector('#note-icons');
const noteLike = document.querySelector('#note-like');
const noteCommentOpen = document.querySelector('#note-comment-open');
const noteComment = document.querySelector('#note-comment');
const noteCommentText = document.querySelector('#note-comment-text');
const noteCommentList = document.querySelector('#note-comments');
const noteStatus = document.querySelector('#note-status');
let noteComments = [];
const privateMoods = new Set();
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
  if (!response.ok) {
    const error = new Error('The quote could not be loaded right now.');
    error.sealed = response.status === 401;
    error.empty = response.status === 404;
    throw error;
  }
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

// Private ("only for you") categories show as a sealed letter with a wax seal. Its notes only come from the server once
// she is signed in with the mailbox password, so the card itself never holds them.
function renderCategories(categories) {
  const visibleCategories = categories.filter(category => !['welcome', 'distract'].includes(category.slug));
  privateMoods.clear();
  categories.filter(category => category.private).forEach(category => privateMoods.add(category.slug));
  noteGrid.innerHTML = visibleCategories.length
    ? visibleCategories.map(category => `
      <button class="mood-card ${category.private ? 'sealed-card' : categoryClass(category.color)}${category.sealed ? ' is-sealed' : ''}" data-mood="${escapeHtml(category.slug)}" data-category-id="${category.id}" data-track="mood-${escapeHtml(category.slug)}">
        <span class="card-icon">${category.private ? '<span class="wax-seal" aria-hidden="true">♥</span>' : categoryIcon(category.slug)}</span>
        <strong>${escapeHtml(category.card_title || `A little ${category.name.toLowerCase()}`)}</strong>
        <small>${escapeHtml(categoryDescription(category))}</small>
        ${category.private ? `<em class="seal-note">${category.sealed ? '🔒 sealed, just for Ayesha' : '♡ open it'}</em>` : ''}
        <i>→</i>
      </button>`).join('')
    : '<p class="notes-loading">There are no feeling categories yet.</p>';

  noteGrid.querySelectorAll('.mood-card').forEach(card => card.addEventListener('click', () => {
    recordEvent('click', { target: card.dataset.track, mood: card.dataset.mood, categoryId: Number(card.dataset.categoryId) });
    showMessage(card.dataset.mood);
  }));
}

// The message card turns into a velvet letter for private notes.
function setModalLook(isPrivate) {
  modal.classList.toggle('is-private', isPrivate);
  modalStar.textContent = isPrivate ? '♥' : '✦';
  sealForm.hidden = true;
  anotherNote.hidden = false;
  showReactions(null);
}

// On a sealed note she (signed in) can ♡ it or write about it. What she has written stays inside the comment
// panel (the speech bubble), so the note itself stays clean.
function showReactions(reactions) {
  noteIcons.hidden = !reactions;
  noteReact.hidden = !reactions;
  noteComment.hidden = true;
  noteCommentOpen.setAttribute('aria-expanded', 'false');
  noteStatus.textContent = '';
  if (!reactions) return;
  setLiked(reactions.liked);
  noteComments = reactions.comments || [];
}

function renderNoteComments() {
  noteCommentList.replaceChildren(...noteComments.map(comment => {
    const item = document.createElement('li');
    const words = document.createElement('p');
    const when = document.createElement('small');
    words.textContent = comment.text;
    when.textContent = window.VoiceKit?.formatWhen ? window.VoiceKit.formatWhen(comment.createdAt) : '';
    item.append(words, when);
    return item;
  }));
  noteCommentList.scrollTop = noteCommentList.scrollHeight;
}

function setLiked(liked) {
  noteLike.setAttribute('aria-pressed', String(liked));
  noteLike.setAttribute('aria-label', liked ? 'You love this note (tap to undo)' : 'Love this note');
  noteLike.textContent = liked ? '♥' : '♡';
}

noteLike.addEventListener('click', async () => {
  if (!activeQuote) return;
  const liked = noteLike.getAttribute('aria-pressed') !== 'true';
  setLiked(liked);
  if (liked) replayClass(noteLike, 'pop');
  try {
    const response = await fetch(`/api/notes/${activeQuote.id}/like`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked })
    });
    if (!response.ok) throw new Error('not saved');
    noteStatus.textContent = '';
  } catch (error) {
    setLiked(!liked);
    noteStatus.textContent = 'That heart did not save. Please try again.';
  }
});

function toggleCommentBox(open) {
  noteComment.hidden = !open;
  noteCommentOpen.setAttribute('aria-expanded', String(open));
  noteStatus.textContent = '';
  if (!open) return;
  renderNoteComments();
  noteCommentText.focus();
}

noteCommentOpen.addEventListener('click', () => toggleCommentBox(noteComment.hidden));
document.querySelector('#note-comment-cancel').addEventListener('click', () => toggleCommentBox(false));

// Her comment lands in the mailbox with the note quoted above it (and buzzes Zohaib's phone); here it joins her list.
noteComment.addEventListener('submit', async event => {
  event.preventDefault();
  const comment = noteCommentText.value.trim();
  if (!activeQuote || !comment) return;
  noteStatus.textContent = 'Sending…';
  try {
    const response = await fetch(`/api/notes/${activeQuote.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: comment })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'That did not send. Please try again.');
    noteCommentText.value = '';
    noteComments.push({ text: comment, createdAt: new Date().toISOString() });
    renderNoteComments();
    noteStatus.textContent = 'sent ♡';
  } catch (error) {
    noteStatus.textContent = error.message;
  }
});

async function showMessage(mood = 'welcome') {
  activeMood = mood;
  const distract = mood === 'distract';
  const isPrivate = privateMoods.has(mood);
  setModalLook(isPrivate);
  label.textContent = isPrivate ? 'only for you' : distract ? 'a lovely little detour' : 'a small note for Ayesha';
  title.textContent = isPrivate ? 'Sealed with love.' : distract ? 'A pause, just for you.' : 'Here is a little something.';
  text.textContent = 'Finding a little something...';
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');

  try {
    activeQuote = await fetchQuote(mood);
    text.textContent = activeQuote.text;
    if (isPrivate) replayClass(modal.querySelector('.modal-card'), 'unsealed');
    showReactions(isPrivate ? activeQuote.reactions || null : null);
    recordEvent('message-viewed', { mood, quoteId: activeQuote.id, categoryId: activeQuote.category_id });
  } catch (error) {
    activeQuote = null;
    if (error.sealed) return showSeal();
    text.textContent = error.empty && isPrivate
      ? 'Nothing sealed in here yet… soon ♡'
      : 'The notes are taking a tiny pause. Please try again in a moment.';
    console.warn('Unable to load quote.', error);
  }
}

// A sealed note asks for the mailbox password once; that also signs her in to the mailbox.
function showSeal() {
  title.textContent = 'This one is sealed ♡';
  text.textContent = 'It opens with the password to our little mailbox.';
  sealForm.hidden = false;
  anotherNote.hidden = true;
  sealStatus.textContent = '';
  sealPassword.value = '';
  sealPassword.focus({ preventScroll: true });
}

sealForm.addEventListener('submit', async event => {
  event.preventDefault();
  sealStatus.textContent = 'Checking…';
  try {
    const response = await fetch('/api/voice/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: sealPassword.value })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'That password did not open it.');
    sealPassword.value = '';
    window.dispatchEvent(new CustomEvent('mailbox:signed-in'));
    loadCategories();
    showMessage(activeMood);
  } catch (error) {
    sealStatus.textContent = error.message;
  }
});

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
    setModalLook(false);
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

function loadCategories() {
  fetchCategories().then(renderCategories).catch(error => {
    noteGrid.innerHTML = '<p class="notes-loading">The feelings are taking a tiny pause. Please try again soon.</p>';
    console.warn('Unable to load categories.', error);
  });
}

loadCategories();
// Once the mailbox knows she is signed in (on load, or after she unlocks it), any sealed card opens up.
window.addEventListener('mailbox:unread', () => { if (noteGrid.querySelector('.is-sealed')) loadCategories(); });

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
let bunnyX = 0; // how far the bunny has hopped from its home spot, in px

// The bubble sits above wherever the bunny is, kept inside the arch, with its tail pointing at the bunny.
function placeBubble() {
  if (bunnyBubble.hidden) return;
  const middle = bunny.offsetLeft + bunnyX + bunny.offsetWidth / 2;
  const width = bunnyBubble.offsetWidth;
  const left = Math.min(Math.max(middle - width / 2, 10), bunny.parentElement.clientWidth - width - 10);
  bunnyBubble.style.left = `${left.toFixed(1)}px`;
  bunnyBubble.style.setProperty('--tail-x', `${Math.min(Math.max(middle - left, 16), width - 16).toFixed(1)}px`);
}

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
    placeBubble();
    if (!hadMail) {
      replayClass(bunny, 'hop');
      replayClass(bunnyBubble, 'pop');
      // It carries the letter back home and waits there for her.
      stopEmote();
      if (bunnyIsAwake()) walkBunnyTo(0);
    }
  } else if (hadMail) {
    bunnyBubble.classList.remove('mail');
    bunnyBubble.hidden = true;
    // Once she has read the letter, mention anything it unlocked (like the balloon).
    refreshWardrobe();
  }
}

function openMailboxFromBunny() {
  // Opening a letter the bunny brought unlocks its heart balloon.
  writeStored(deliveredKey, true);
  scheduleWardrobeSave();
  document.querySelector('#open-voice-notes').click();
}

window.addEventListener('mailbox:unread', event => {
  mailboxUnread = event.detail.unread;
  showBunnyMail();
});
// Keep the bubble's wording in step with day and night while a letter is waiting.
new MutationObserver(() => {
  if (!bunnyHasMail) return;
  bunnyBubble.textContent = bunnyMailLine();
  placeBubble();
})
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// The bunny says something in its bubble for a few seconds (never over a waiting letter).
function bunnySay(line, ms = 3600) {
  if (bunny.hidden || bunnyHasMail) return;
  bunnyBubble.classList.remove('mail');
  bunnyBubble.textContent = line;
  bunnyBubble.hidden = false;
  placeBubble();
  replayClass(bunnyBubble, 'pop');
  window.clearTimeout(bunnyBubbleTimer);
  bunnyBubbleTimer = window.setTimeout(() => { bunnyBubble.hidden = true; }, ms);
}

// A tap stops it in its tracks for a little reaction; asleep, it just stirs.
bunny.addEventListener('click', () => {
  if (bunnyHasMail) return openMailboxFromBunny();
  noteBunnyAttention();
  stopWalking();
  if (bunnyIsAwake()) playEmote(tapEmote());
  else replayClass(bunny, 'hop');
  bunnySay(nextBunnyLine(), 2800);
});
bunnyBubble.addEventListener('click', () => { if (bunnyHasMail) openMailboxFromBunny(); });

fetch('/api/bunny').then(response => (response.ok ? response.json() : null)).then(settings => {
  if (!settings?.enabled || !settings.lines.length) return;
  bunnyLines = settings.lines;
  bunny.hidden = false;
  showBunnyMail();
  refreshWardrobe();
  scheduleBunnyIdle();
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
  scheduleWardrobeSave();
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

// ---- Bunny wardrobe: a wooden wardrobe (opened with 🎀) where she dresses the bunny; some pieces unlock over time. ----
// Her outfit, saved looks and progress live in her browser and, once she has opened the mailbox, on the server too, so they
// follow her to another phone. Every piece is drawn in the bunny SVG; its picture in the wardrobe is a copy of that drawing
// (view = the part of the bunny's 120×120 drawing to show). Pieces without an unlock rule are there from the start.
const wardrobeItems = [
  { id: 'bow', slot: 'head', name: 'pink bow', view: '30 33 27 19' },
  { id: 'flowers', slot: 'head', name: 'flower crown', view: '39 34 42 18', unlock: { days: 3 } },
  { id: 'crown', slot: 'head', name: 'little crown', view: '46 28 28 19', unlock: { days: 7 } },
  { id: 'sunhat', slot: 'head', name: 'sun hat', view: '31 25 58 28', unlock: { days: 10 } },
  { id: 'nightcap', slot: 'head', name: 'sleepy nightcap', view: '42 23 52 29', unlock: { nightOwl: true } },
  { id: 'heartclip', slot: 'ear', name: 'heart clip', view: '66 16.5 14 12' },
  { id: 'star', slot: 'ear', name: 'star clip', view: '66 15 14 13', unlock: { secret: true } },
  { id: 'glasses', slot: 'face', name: 'round glasses', view: '39 52 42 17' },
  { id: 'sunglasses', slot: 'face', name: 'heart sunglasses', view: '39 52 42 17', unlock: { days: 5 } },
  { id: 'scarf', slot: 'neck', name: 'cozy scarf', view: '39 73 42 30' },
  { id: 'bell', slot: 'neck', name: 'bell collar', view: '41 75 38 18' },
  { id: 'locket', slot: 'neck', name: 'heart locket', view: '41 74 38 19', unlock: { days: 14 } },
  { id: 'bouquet', slot: 'hold', name: 'flower bouquet', view: '63 82 30 31' },
  { id: 'coffee', slot: 'hold', name: 'cup of coffee', view: '61 86 23 24' },
  { id: 'book', slot: 'hold', name: 'storybook', view: '42 88 36 26', unlock: { days: 2 } },
  { id: 'icecream', slot: 'hold', name: 'ice cream', view: '60 83 24 29', unlock: { days: 4 } },
  { id: 'teddy', slot: 'hold', name: 'tiny teddy', view: '86 88 24 28', unlock: { days: 8 } },
  { id: 'umbrella', slot: 'hold', name: 'pink parasol', view: '66 28 50 84', unlock: { days: 12 } },
  { id: 'balloon', slot: 'hold', name: 'heart balloon', view: '70 54 40 56', unlock: { delivered: true } },
  { id: 'white', slot: 'fur', name: 'snowy white fur' },
  { id: 'cream', slot: 'fur', name: 'cream fur' },
  { id: 'pink', slot: 'fur', name: 'strawberry pink fur' },
  { id: 'grey', slot: 'fur', name: 'cloudy grey fur', unlock: { days: 4 } },
  { id: 'caramel', slot: 'fur', name: 'caramel fur', unlock: { days: 6 } }
];
const wardrobeSlots = ['head', 'ear', 'face', 'neck', 'hold', 'fur'];
const outfitKey = 'ayesha-bunny-outfit';
const visitDatesKey = 'ayesha-bunny-visit-dates';
const oldVisitDaysKey = 'ayesha-bunny-visit-days';
const seenItemsKey = 'ayesha-bunny-seen-items';
const nightOwlKey = 'ayesha-bunny-night-owl';
const deliveredKey = 'ayesha-bunny-delivered';
const looksKey = 'ayesha-bunny-looks';
const wardrobeUpdatedKey = 'ayesha-bunny-wardrobe-updated';
const svgNS = 'http://www.w3.org/2000/svg';
const wardrobe = document.querySelector('#wardrobe');
const cabinet = document.querySelector('#cabinet');
const wardrobeToggle = document.querySelector('#wardrobe-toggle');
const wardrobeNote = document.querySelector('#wardrobe-note');
const looksRow = document.querySelector('#looks-row');
let wardrobeClosing = false;

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

// Her visits are kept as the different days (by her own calendar) she has opened the site.
function countVisitDay() {
  const today = new Date().toLocaleDateString('en-CA');
  let dates = readStored(visitDatesKey, null);
  if (!Array.isArray(dates)) {
    // Earlier visits were only counted, not dated: keep them as placeholders so nothing she unlocked is lost.
    const old = readStored(oldVisitDaysKey, { count: 0, last: '' });
    const earlier = Math.max(0, (Number(old.count) || 0) - (old.last ? 1 : 0));
    dates = [...Array.from({ length: earlier }, (_, index) => `legacy-${index + 1}`), ...(old.last ? [old.last] : [])];
  }
  if (!dates.includes(today)) dates.push(today);
  dates = dates.slice(-400);
  writeStored(visitDatesKey, dates);
  return dates.length;
}

let visitDays = countVisitDay();
// A visit between midnight and 5am unlocks the nightcap.
if (new Date().getHours() < 5) writeStored(nightOwlKey, true);

function itemById(id) {
  return wardrobeItems.find(item => item.id === id);
}

function isUnlocked(item) {
  const unlock = item.unlock || {};
  if (unlock.days) return visitDays >= unlock.days;
  if (unlock.secret) return flowerSecretFound();
  if (unlock.nightOwl) return readStored(nightOwlKey, false) === true;
  if (unlock.delivered) return readStored(deliveredKey, false) === true;
  return true;
}

function unlockHint(item) {
  const unlock = item.unlock || {};
  if (unlock.days) return `opens after visiting on ${unlock.days} different days (${Math.min(visitDays, unlock.days)} so far) ♡`;
  if (unlock.secret) return "opens when you find the flower's secret ✿";
  if (unlock.nightOwl) return 'opens when you visit me after midnight 🌙';
  return 'opens when I bring you a letter and you read it ✉️';
}

// The few words on a wrapped present's gift tag.
function unlockTag(item) {
  const unlock = item.unlock || {};
  if (unlock.days) return `${Math.min(visitDays, unlock.days)}/${unlock.days} days`;
  if (unlock.secret) return '✿ secret';
  if (unlock.nightOwl) return '🌙 late';
  return '✉ letter';
}

// Keeps only pieces that exist and are unlocked; white fur is simply no fur colour.
function cleanOutfit(saved) {
  return Object.fromEntries(wardrobeSlots.map(slot => {
    const item = wardrobeItems.find(entry => entry.slot === slot && entry.id === saved?.[slot]);
    return [slot, item && item.id !== 'white' && isUnlocked(item) ? item.id : ''];
  }));
}

function currentOutfit() {
  return cleanOutfit(readStored(outfitKey, {}));
}

function isWorn(outfit, item) {
  return item.slot === 'fur' ? (outfit.fur || 'white') === item.id : outfit[item.slot] === item.id;
}

// A copy of the bunny for the mirror and the saved-look frames. It borrows the page bunny's gradients and flowers,
// so the copies never repeat an id.
function makeFigure(className) {
  const figure = document.createElement('span');
  figure.className = `bunny bunny-figure ${className}`;
  const art = bunny.querySelector('svg').cloneNode(true);
  art.querySelector('defs').remove();
  art.querySelectorAll('[id], [style]').forEach(node => {
    node.removeAttribute('id');
    node.removeAttribute('style');
  });
  figure.append(art);
  return figure;
}

function dressFigure(figure, outfit) {
  wardrobeSlots.forEach(slot => {
    if (outfit[slot]) figure.dataset[slot] = outfit[slot];
    else delete figure.dataset[slot];
  });
}

const mirrorBunny = makeFigure('mirror-bunny');
document.querySelector('#mirror-glass').append(mirrorBunny);
let mirrorEmoteTimer = null;

function applyOutfit(outfit) {
  dressFigure(bunny, outfit);
  dressFigure(mirrorBunny, outfit);
}

// The bunny in the mirror reacts to what she puts on.
function mirrorEmote(name) {
  window.clearTimeout(mirrorEmoteTimer);
  delete mirrorBunny.dataset.emote;
  void mirrorBunny.getBoundingClientRect();
  mirrorBunny.dataset.emote = name;
  mirrorEmoteTimer = window.setTimeout(() => delete mirrorBunny.dataset.emote, emoteMs[name] || 1500);
}

// Each piece's button shows a copy of its drawing (or a fluffy swatch for fur) and, while locked, a wrapped present.
function itemPicture(item) {
  if (item.slot === 'fur') {
    const swatch = document.createElement('span');
    swatch.className = 'fur-swatch';
    if (item.id !== 'white') swatch.dataset.fur = item.id;
    return swatch;
  }
  const picture = document.createElementNS(svgNS, 'svg');
  picture.setAttribute('class', 'wardrobe-thumb');
  picture.setAttribute('viewBox', item.view);
  picture.setAttribute('aria-hidden', 'true');
  const art = bunny.querySelector(`.item-${item.id}`).cloneNode(true);
  art.classList.remove('bunny-item', 'bunny-head-item', 'bunny-hold-item');
  picture.append(art);
  return picture;
}

wardrobe.querySelectorAll('[data-slot]').forEach(shelf => {
  shelf.replaceChildren(...wardrobeItems.filter(item => item.slot === shelf.dataset.slot).map(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wardrobe-item';
    button.dataset.item = item.id;
    button.innerHTML = '<span class="present" aria-hidden="true"><b class="present-tag"></b></span><span class="item-sparkle" aria-hidden="true">✦</span>';
    button.prepend(itemPicture(item));
    return button;
  }));
});

function unseenItems() {
  const seen = readStored(seenItemsKey, []);
  return wardrobeItems.filter(item => isUnlocked(item) && !seen.includes(item.id));
}

function renderItems() {
  const outfit = currentOutfit();
  const unseen = unseenItems().map(item => item.id);
  wardrobe.querySelectorAll('.wardrobe-item').forEach(button => {
    const item = itemById(button.dataset.item);
    const unlocked = isUnlocked(item);
    button.classList.toggle('locked', !unlocked);
    button.classList.toggle('is-new', unseen.includes(item.id));
    button.setAttribute('aria-pressed', String(unlocked && isWorn(outfit, item)));
    button.setAttribute('aria-label', unlocked ? item.name : `a wrapped present, it ${unlockHint(item)}`);
    button.title = unlocked ? item.name : 'a wrapped present';
    button.querySelector('.present-tag').textContent = unlocked ? '' : unlockTag(item);
  });
  document.querySelector('#wardrobe-new').hidden = !unseen.length;
}

function readLooks() {
  const looks = readStored(looksKey, []);
  return [0, 1, 2].map(index => (looks?.[index] && typeof looks[index] === 'object' ? looks[index] : null));
}

// Three little photo frames: an empty one saves the current outfit, a filled one puts that look back on.
function renderLooks() {
  looksRow.replaceChildren(...readLooks().map((look, index) => {
    const holder = document.createElement('div');
    const frame = document.createElement('button');
    holder.className = 'look';
    frame.type = 'button';
    frame.dataset.look = String(index);
    holder.append(frame);
    if (!look) {
      frame.className = 'look-frame empty';
      frame.setAttribute('aria-label', `Save this look in frame ${index + 1}`);
      frame.innerHTML = '<b>+</b>save';
      return holder;
    }
    frame.className = 'look-frame';
    frame.setAttribute('aria-label', `Wear saved look ${index + 1}`);
    const figure = makeFigure('look-bunny');
    dressFigure(figure, cleanOutfit(look));
    frame.append(figure);
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'look-clear';
    forget.dataset.forgetLook = String(index);
    forget.setAttribute('aria-label', `Forget saved look ${index + 1}`);
    forget.textContent = '×';
    holder.append(forget);
    return holder;
  }));
}

function wardrobeChanged() {
  writeStored(wardrobeUpdatedKey, Date.now());
  scheduleWardrobeSave();
}

function wearOutfit(outfit, emote) {
  writeStored(outfitKey, outfit);
  wardrobeChanged();
  applyOutfit(outfit);
  renderItems();
  if (emote) mirrorEmote(emote);
}

function tryOn(item, button) {
  if (!isUnlocked(item)) {
    wardrobeNote.textContent = `🎁 this present ${unlockHint(item)}`;
    replayClass(button.querySelector('.present'), 'wiggle');
    return;
  }
  const outfit = currentOutfit();
  if (item.slot === 'fur') outfit.fur = item.id === 'white' || outfit.fur === item.id ? '' : item.id;
  else outfit[item.slot] = outfit[item.slot] === item.id ? '' : item.id;
  const wearing = item.slot === 'fur' || outfit[item.slot] === item.id;
  wearOutfit(outfit, wearing ? 'love' : '');
  if (season === 'halloween' && item.slot === 'head' && outfit.head) {
    wardrobeNote.textContent = `${item.name} saved for after halloween, the witch hat is on today 🎃`;
  } else {
    wardrobeNote.textContent = item.slot === 'fur' ? `${item.name} ♡` : `${item.name} ${wearing ? 'on ♡' : 'off'}`;
  }
}

function useLook(index) {
  const looks = readLooks();
  if (!looks[index]) {
    looks[index] = currentOutfit();
    writeStored(looksKey, looks);
    wardrobeChanged();
    renderLooks();
    wardrobeNote.textContent = `saved as look ${index + 1} ♡ tap it to wear it again`;
    return;
  }
  wearOutfit(cleanOutfit(looks[index]), 'giggle');
  wardrobeNote.textContent = `look ${index + 1}, on ♡`;
}

function forgetLook(index) {
  const looks = readLooks();
  looks[index] = null;
  writeStored(looksKey, looks);
  wardrobeChanged();
  renderLooks();
  looksRow.querySelector(`[data-look="${index}"]`).focus();
  wardrobeNote.textContent = 'that frame is free again';
}

// A random outfit from what she has unlocked, a little different from the current one.
function surpriseOutfit() {
  const current = currentOutfit();
  const chance = { head: 0.8, ear: 0.4, face: 0.35, neck: 0.55, hold: 0.55, fur: 0.45 };
  let outfit = current;
  for (let tries = 0; tries < 6 && JSON.stringify(outfit) === JSON.stringify(current); tries += 1) {
    outfit = Object.fromEntries(wardrobeSlots.map(slot => {
      const choices = wardrobeItems.filter(item => item.slot === slot && isUnlocked(item));
      if (Math.random() > chance[slot]) return [slot, slot === 'fur' ? current.fur : ''];
      const pick = choices[Math.floor(Math.random() * choices.length)].id;
      return [slot, pick === 'white' ? '' : pick];
    }));
  }
  wearOutfit(outfit, 'twirl');
  wardrobeNote.textContent = '✨ how about this?';
}

function toggleDrawer(drawer, open = !drawer.classList.contains('is-open')) {
  drawer.classList.toggle('is-open', open);
  drawer.querySelector('.drawer-front').setAttribute('aria-expanded', String(open));
  drawer.querySelector('.drawer-tray').inert = !open;
}

// Runs once the bunny appears and again when something unlocks: wears her outfit and mentions new pieces once.
function refreshWardrobe() {
  if (bunny.hidden) return;
  wardrobeToggle.hidden = false;
  applyOutfit(currentOutfit());
  renderItems();
  const unseen = unseenItems();
  if (!unseen.length || wardrobe.classList.contains('is-open')) return;
  if (readStored(seenItemsKey, null) === null) bunnySay('psst… you can dress me up now 🎀');
  else if (unseen.length > 1) bunnySay(`✨ ${unseen.length} new things in my wardrobe!`);
  else bunnySay(`✨ something new in my wardrobe: ${unseen[0].name}!`);
}

function openWardrobe() {
  if (wardrobe.classList.contains('is-open')) return;
  stopWalking();
  applyOutfit(currentOutfit());
  renderItems();
  renderLooks();
  // A drawer with something new inside starts pulled out.
  wardrobe.querySelectorAll('.drawer').forEach(drawer => toggleDrawer(drawer, !!drawer.querySelector('.is-new')));
  wardrobeNote.textContent = 'tap anything to try it on ♡';
  wardrobe.classList.add('is-open');
  wardrobe.setAttribute('aria-hidden', 'false');
  wardrobeToggle.setAttribute('aria-expanded', 'true');
  if (!bunnyHasMail) bunnyBubble.hidden = true;
  // Focus moves in once the wardrobe is showing (it can't take focus while still invisible).
  window.setTimeout(() => {
    cabinet.classList.add('doors-open');
    document.querySelector('#wardrobe-done').focus({ preventScroll: true });
  }, reducedMotion.matches ? 30 : 220);
  // Everything unlocked so far counts as seen once she has looked inside (the sparkles stay until next time).
  writeStored(seenItemsKey, wardrobeItems.filter(isUnlocked).map(item => item.id));
  document.querySelector('#wardrobe-new').hidden = true;
  scheduleWardrobeSave();
}

// The doors swing shut first, then the wardrobe goes, and the bunny shows off its outfit.
function closeWardrobe() {
  if (!wardrobe.classList.contains('is-open') || wardrobeClosing) return;
  wardrobeClosing = true;
  cabinet.classList.remove('doors-open');
  window.setTimeout(() => {
    wardrobeClosing = false;
    wardrobe.classList.remove('is-open');
    wardrobe.setAttribute('aria-hidden', 'true');
    wardrobeToggle.setAttribute('aria-expanded', 'false');
    wardrobeToggle.focus({ preventScroll: true });
    if (bunnyIsAwake() && !bunnyHasMail) {
      playEmote('love');
      bunnySay('do I look cute? ♡', 2600);
    }
  }, reducedMotion.matches ? 0 : 450);
}

wardrobeToggle.addEventListener('click', () => (wardrobe.classList.contains('is-open') ? closeWardrobe() : openWardrobe()));
document.querySelector('#wardrobe-done').addEventListener('click', closeWardrobe);
document.querySelector('#wardrobe-surprise').addEventListener('click', surpriseOutfit);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && wardrobe.classList.contains('is-open')) closeWardrobe();
});

wardrobe.addEventListener('click', event => {
  if (event.target === wardrobe) return closeWardrobe();
  const item = event.target.closest('.wardrobe-item');
  if (item) return tryOn(itemById(item.dataset.item), item);
  const forget = event.target.closest('.look-clear');
  if (forget) return forgetLook(Number(forget.dataset.forgetLook));
  const frame = event.target.closest('.look-frame');
  if (frame) return useLook(Number(frame.dataset.look));
  const drawer = event.target.closest('.drawer-front');
  if (drawer) toggleDrawer(drawer.closest('.drawer'));
});

// ---- Saving the wardrobe with her mailbox login, so it follows her between phones. ----
let wardrobeSync = 'signed-out'; // 'checking' while asking the server, 'signed-in' once it accepts her mailbox session
let wardrobeSaveTimer = null;

function wardrobeSnapshot() {
  return {
    outfit: readStored(outfitKey, {}),
    looks: readLooks(),
    seen: readStored(seenItemsKey, null),
    days: readStored(visitDatesKey, []),
    secret: flowerSecretFound(),
    nightOwl: readStored(nightOwlKey, false) === true,
    delivered: readStored(deliveredKey, false) === true,
    updatedAt: Number(readStored(wardrobeUpdatedKey, 0)) || 0
  };
}

// The more recent outfit and looks win; visits, seen pieces and unlocks from both sides are all kept.
function mergeWardrobe(mine, saved) {
  const newer = (saved.updatedAt || 0) > (mine.updatedAt || 0) ? saved : mine;
  const both = (first, second) => [...new Set([...(first || []), ...(second || [])])];
  return {
    outfit: newer.outfit || {},
    looks: newer.looks || [null, null, null],
    seen: mine.seen || saved.seen ? both(mine.seen, saved.seen) : null,
    days: both(saved.days, mine.days).slice(-400),
    secret: mine.secret || saved.secret,
    nightOwl: mine.nightOwl || saved.nightOwl,
    delivered: mine.delivered || saved.delivered,
    updatedAt: Math.max(mine.updatedAt || 0, saved.updatedAt || 0)
  };
}

function restoreWardrobe(state) {
  writeStored(outfitKey, state.outfit);
  writeStored(looksKey, state.looks);
  if (state.seen) writeStored(seenItemsKey, state.seen);
  writeStored(visitDatesKey, state.days);
  if (state.nightOwl) writeStored(nightOwlKey, true);
  if (state.delivered) writeStored(deliveredKey, true);
  if (state.secret) {
    try {
      localStorage.setItem(flowerSecretFoundKey, 'yes');
    } catch (error) {
      // Without storage the server copy still remembers it.
    }
  }
  writeStored(wardrobeUpdatedKey, state.updatedAt);
  visitDays = state.days.length;
}

async function syncWardrobe() {
  wardrobeSync = 'checking';
  try {
    const response = await fetch('/api/wardrobe');
    if (!response.ok) {
      wardrobeSync = 'signed-out';
      return;
    }
    const { state: saved } = await response.json();
    wardrobeSync = 'signed-in';
    const merged = saved ? mergeWardrobe(wardrobeSnapshot(), saved) : wardrobeSnapshot();
    restoreWardrobe(merged);
    refreshWardrobe();
    if (JSON.stringify(merged) !== JSON.stringify(saved)) saveWardrobeNow();
  } catch (error) {
    // Offline or busy: her browser keeps its own copy and tries again later.
    wardrobeSync = 'signed-out';
  }
}

function saveWardrobeNow() {
  window.clearTimeout(wardrobeSaveTimer);
  fetch('/api/wardrobe', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: wardrobeSnapshot() })
  }).catch(() => {});
}

function scheduleWardrobeSave() {
  if (wardrobeSync !== 'signed-in') return;
  window.clearTimeout(wardrobeSaveTimer);
  wardrobeSaveTimer = window.setTimeout(saveWardrobeNow, 1200);
}

// voice-notes.js reports the mailbox (on load when her phone is signed in, or once she unlocks it), which means the
// server will take her wardrobe too; other visitors never ask.
window.addEventListener('mailbox:unread', () => { if (wardrobeSync === 'signed-out') syncWardrobe(); });

// ---- Bunny on the move: it hops after her cursor (or to where she taps on a phone), wanders now and then, and has little emotes. ----
// It only moves by day, never while a letter is waiting or the wardrobe is open, and stays put if she prefers less motion.
// It walks behind the big flower (a layer below it), so the flower always keeps its taps.
const heroArt = bunny.parentElement;
const bunnyBody = bunny.querySelector('.bunny-body');
const bunnyShadow = bunny.querySelector('svg > .bunny-shadow');
const walkSpeed = 120; // px per second, on average
const hopMs = 420;
const emoteMs = { love: 2200, giggle: 1600, twirl: 1000, surprised: 1500, dance: 2500, yawn: 2300, curious: 1800 };
let walkTarget = 0;
let walkFrame = 0;
let walkStart = 0;
let lastWalkFrame = 0;
let lastHopPhase = 0;
let walkArrived = false;
let emoteTimer = null;
let lastEmote = '';
let lookTimer = null;
let idleTimer = null;
let lastAttention = 0;

function bunnyIsAwake() {
  return document.documentElement.dataset.theme !== 'night';
}

function bunnyCanMove() {
  return !bunny.hidden && !bunnyHasMail && bunnyIsAwake() && !reducedMotion.matches && !wardrobe.classList.contains('is-open');
}

function noteBunnyAttention() {
  lastAttention = Date.now();
}

// How far it may go from home (in px): inside the arch and clear of the dress-up button in the corner.
function bunnyRange() {
  const width = bunny.offsetWidth;
  const home = bunny.offsetLeft;
  return {
    min: Math.min(0, 10 - width * 0.2 - home),
    max: Math.max(0, heroArt.clientWidth - 64 - width * 0.82 - home)
  };
}

function clampToRange(offset) {
  const { min, max } = bunnyRange();
  return Math.min(Math.max(offset, min), max);
}

// The offset that puts the middle of the bunny under this point on the screen.
function offsetUnder(clientX) {
  return clientX - heroArt.getBoundingClientRect().left - bunny.offsetLeft - bunny.offsetWidth / 2;
}

// It is drawn facing left; facing right mirrors the drawing.
function faceBunny(direction) {
  bunny.classList.toggle('face-right', direction === 'right');
}

function walkBunnyTo(offset) {
  walkTarget = clampToRange(offset);
  if (Math.abs(walkTarget - bunnyX) < 2) return;
  if (Math.abs(walkTarget - bunnyX) > 6) faceBunny(walkTarget > bunnyX ? 'right' : 'left');
  walkArrived = false;
  if (walkFrame) return;
  stopEmote();
  bunny.classList.add('walking');
  walkStart = performance.now();
  lastWalkFrame = walkStart;
  lastHopPhase = 0;
  walkFrame = window.requestAnimationFrame(stepWalk);
}

// Each frame it hops along: it moves mostly while in the air, squashes a little on landing, and its shadow
// shrinks mid-hop. Once there it finishes the hop it is in before stopping.
function stepWalk(now) {
  const elapsed = Math.min(now - lastWalkFrame, 50);
  lastWalkFrame = now;
  const phase = ((now - walkStart) % hopMs) / hopMs;
  const landed = phase < lastHopPhase;
  lastHopPhase = phase;
  if (walkArrived && landed) return stopWalking();
  const distance = walkTarget - bunnyX;
  const step = walkSpeed * (1 - Math.cos(2 * Math.PI * phase)) * elapsed / 1000;
  bunnyX += Math.sign(distance) * Math.min(Math.abs(distance), step);
  if (Math.abs(walkTarget - bunnyX) < 0.5) walkArrived = true;
  const lift = Math.sin(Math.PI * phase);
  const squash = 0.035 * Math.cos(2 * Math.PI * phase);
  bunny.style.translate = `${bunnyX.toFixed(1)}px 0`;
  bunnyBody.style.translate = `0 ${(-9 * lift).toFixed(2)}px`;
  bunnyBody.style.scale = `${(1 + squash).toFixed(3)} ${(1 - squash).toFixed(3)}`;
  bunnyShadow.style.scale = (1 - 0.2 * lift).toFixed(3);
  placeBubble();
  walkFrame = window.requestAnimationFrame(stepWalk);
}

function stopWalking() {
  window.cancelAnimationFrame(walkFrame);
  walkFrame = 0;
  walkTarget = bunnyX;
  bunny.classList.remove('walking');
  bunnyBody.style.translate = '';
  bunnyBody.style.scale = '';
  bunnyShadow.style.scale = '';
  // Back home it settles facing the way it always sits.
  if (Math.abs(bunnyX) < 1) faceBunny('left');
}

// Its eyes glance towards her cursor or tap for a couple of seconds.
function bunnyLookAt(clientX, clientY) {
  if (reducedMotion.matches || !bunnyIsAwake()) return;
  const box = bunny.getBoundingClientRect();
  const dx = clientX - (box.left + box.width / 2);
  const dy = clientY - (box.top + box.height / 2);
  const length = Math.hypot(dx, dy) || 1;
  const reach = Math.min(length / 120, 1) * 1.6;
  const mirror = bunny.classList.contains('face-right') ? -1 : 1;
  bunny.style.setProperty('--look-x', `${((dx / length) * reach * mirror).toFixed(2)}px`);
  bunny.style.setProperty('--look-y', `${((dy / length) * reach).toFixed(2)}px`);
  window.clearTimeout(lookTimer);
  lookTimer = window.setTimeout(bunnyLookAhead, 2500);
}

function bunnyLookAhead() {
  bunny.style.removeProperty('--look-x');
  bunny.style.removeProperty('--look-y');
}

// Emotes are drawn in the bunny SVG and switched on by data-emote (see styles.css) for a moment.
function playEmote(name) {
  if (bunny.hidden) return;
  window.clearTimeout(emoteTimer);
  // Drop a leftover hop so it doesn't replay when the emote ends.
  bunny.classList.remove('hop');
  delete bunny.dataset.emote;
  void bunny.getBoundingClientRect();
  bunny.dataset.emote = name;
  lastEmote = name;
  emoteTimer = window.setTimeout(stopEmote, emoteMs[name]);
}

function stopEmote() {
  window.clearTimeout(emoteTimer);
  delete bunny.dataset.emote;
}

// A different reaction each tap; with less motion it only changes its face.
function tapEmote() {
  const emotes = reducedMotion.matches ? ['love', 'giggle', 'surprised'] : ['love', 'giggle', 'surprised', 'twirl'];
  const choices = emotes.filter(name => name !== lastEmote);
  return choices[Math.floor(Math.random() * choices.length)];
}

// On a computer it notices her cursor coming into the arch, then hops along underneath it.
heroArt.addEventListener('pointerenter', event => {
  if (event.pointerType !== 'mouse') return;
  if (bunnyCanMove() && !walkFrame && !bunny.dataset.emote && Date.now() - lastAttention > 20000) playEmote('curious');
  noteBunnyAttention();
});

heroArt.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || bunny.hidden) return;
  noteBunnyAttention();
  bunnyLookAt(event.clientX, event.clientY);
  // It holds still while she hovers it (to tap it) and while an emote plays.
  if (!bunnyCanMove() || bunny.contains(event.target) || bunny.dataset.emote) return;
  const offset = offsetUnder(event.clientX);
  if (walkFrame || Math.abs(clampToRange(offset) - bunnyX) > 36) walkBunnyTo(offset);
});

// On a phone (or with a click) it hops to wherever she taps the empty arch; the flower, bunny and buttons keep their own taps.
heroArt.addEventListener('click', event => {
  if (event.target !== heroArt || bunny.hidden) return;
  noteBunnyAttention();
  bunnyLookAt(event.clientX, event.clientY);
  if (bunnyCanMove()) walkBunnyTo(offsetUnder(event.clientX));
});

function scheduleBunnyIdle() {
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(bunnyIdle, 12000 + Math.random() * 10000);
}

// Every so often, when she isn't playing with it: wander a little, look around, dance, yawn or twirl; left alone for a while, it heads home.
function bunnyIdle() {
  scheduleBunnyIdle();
  if (document.hidden || !bunnyCanMove() || walkFrame || bunny.dataset.emote || Date.now() - lastAttention < 6000) return;
  if (bunnyX !== 0 && Date.now() - lastAttention > 45000) return walkBunnyTo(0);
  const roll = Math.random();
  if (roll < 0.35) {
    const { min, max } = bunnyRange();
    return walkBunnyTo(min + Math.random() * (max - min));
  }
  if (roll < 0.5) {
    const box = heroArt.getBoundingClientRect();
    return bunnyLookAt(box.left + Math.random() * box.width, box.top + Math.random() * box.height * 0.7);
  }
  playEmote(roll < 0.68 ? 'dance' : roll < 0.84 ? 'yawn' : 'twirl');
}

// Falling asleep (or waking up) mid-hop: land, settle and look straight ahead. The theme is re-applied every
// minute, so only a real change counts.
new MutationObserver(records => {
  if (records.every(record => record.oldValue === document.documentElement.dataset.theme)) return;
  stopWalking();
  stopEmote();
  faceBunny('left');
  bunnyLookAhead();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'], attributeOldValue: true });

window.addEventListener('resize', () => {
  bunnyX = clampToRange(bunnyX);
  walkTarget = clampToRange(walkTarget);
  bunny.style.translate = bunnyX ? `${bunnyX.toFixed(1)}px 0` : '';
  placeBubble();
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
