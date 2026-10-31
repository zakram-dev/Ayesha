require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const db = require('./database');

const app = express();
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const adminLoginAttempts = new Map();
const adminSessionMs = 8 * 60 * 60 * 1000;
const adminLoginWindowMs = 15 * 60 * 1000;
const adminLoginMaxFailures = 5;
const voiceUnlockAttempts = new Map();
const ayeshaSendTimes = [];
const voiceSessionMs = 30 * 24 * 60 * 60 * 1000;
const maxVoiceNoteMs = 125 * 1000;
const voiceAudioTypes = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' };
// The bunny stickers either of them can send (ids match public/bunny-stickers.js); the words are kept as the message text.
const bunnyStickers = { wave: 'a waving bunny', heart: 'a bunny holding a heart', blush: 'a shy, blushing bunny', sleepy: 'a sleepy bunny', yay: 'a happy bunny', hug: 'a bunny hug' };
// She can take back a message for this long after sending it.
const unsendMinutes = 5;
// The emoji either of them can react with (the same list is in public/voice-kit.js).
const chatReactions = ['❤️', '😂', '🥰', '🥺', '😮', '😢'];
const reactionAlertTimes = new Map();
// Voice notes live next to the database (inside the mounted data folder), never under public/.
const voiceDir = path.join(path.dirname(db.name), 'voice');
const ntfyServer = process.env.NTFY_SERVER || 'https://ntfy.sh';
fs.mkdirSync(voiceDir, { recursive: true });

if (!adminPassword || !sessionSecret) {
  throw new Error('ADMIN_PASSWORD and SESSION_SECRET must be configured before starting the server.');
}

// Browser security headers on every response. The pages only run their own scripts and styles (plus Google Fonts and
// the visitor-stats beacon Cloudflare adds to the page), can't be shown inside another site, and only this site may
// use the microphone (for the mailbox voice notes).
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self' https://cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=31536000'
  });
  next();
});

app.use(express.json({ limit: '32kb' }));
// Only files inside public/ are reachable; source, .git, .env and data stay private.
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, revision: process.env.APP_REVISION || null });
});

app.post('/api/events', (req, res) => {
  const eventType = typeof req.body?.eventType === 'string' ? req.body.eventType.trim() : '';
  const allowedEventTypes = new Set(['click', 'message-viewed', 'main-quote-seen']);
  if (!allowedEventTypes.has(eventType)) return res.status(400).json({ error: 'Event type is invalid.' });

  const quoteId = Number.isInteger(req.body?.quoteId) ? req.body.quoteId : null;
  const categoryId = Number.isInteger(req.body?.categoryId) ? req.body.categoryId : null;
  const sessionId = typeof req.body?.sessionId === 'string' && req.body.sessionId.length <= 100
    ? req.body.sessionId
    : null;
  if (quoteId !== null && !db.prepare('SELECT id FROM quotes WHERE id = ?').get(quoteId)) {
    return res.status(400).json({ error: 'Quote not found.' });
  }
  if (categoryId !== null && !db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)) {
    return res.status(400).json({ error: 'Category not found.' });
  }

  db.prepare(`
    INSERT INTO events (event_type, quote_id, category_id, session_id)
    VALUES (?, ?, ?, ?)
  `).run(eventType, quoteId, categoryId, sessionId);
  res.status(204).end();
});

// Private categories show on the page as sealed cards for everyone; their quotes only go to her mailbox login or the admin.
function canSeePrivate(req) {
  return hasSession(req, 'ayesha_voice', 'voice') || hasSession(req, 'ayesha_admin', 'admin');
}

// Sealed notes she has not opened yet, for the "✦ 2 new" on her card.
function unopenedCount(categoryId) {
  return db.prepare(`
    SELECT COUNT(*) AS count FROM quotes
    WHERE category_id = ? AND active = 1 AND status = 'active' AND opened_at IS NULL
  `).get(categoryId).count;
}

// Only her own mailbox login opens notes for real; when Zohaib looks while signed in to admin, nothing is marked.
function isHer(req) {
  return hasSession(req, 'ayesha_voice', 'voice') && !hasSession(req, 'ayesha_admin', 'admin');
}

app.get('/api/categories', (req, res) => {
  const unlocked = canSeePrivate(req);
  const categories = db.prepare(`
    SELECT id, name, slug,
      COALESCE(NULLIF(TRIM(card_title), ''), 'A little ' || LOWER(name)) AS card_title,
      description, color, private
    FROM categories
    WHERE active = 1
    ORDER BY id
  `).all().map(category => ({
    ...category,
    private: Boolean(category.private),
    sealed: Boolean(category.private) && !unlocked,
    ...(category.private && unlocked ? { newCount: unopenedCount(category.id) } : {})
  }));

  // Whether a card is sealed depends on who is asking, so no shared cache may keep this.
  res.set('Cache-Control', 'private, no-store');
  res.json(categories);
});

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHex] = String(storedHash || '').split(':');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function readCookie(req, name) {
  return req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Sessions live in SQLite so they survive restarts and are shared while two containers overlap during a deploy.
function createSession(kind, durationMs) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO auth_sessions (token_hash, kind, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), kind, now + durationMs);
  return token;
}

function hasSession(req, cookieName, kind) {
  const token = readCookie(req, cookieName);
  if (!token) return false;
  return Boolean(db.prepare('SELECT 1 FROM auth_sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?')
    .get(hashToken(token), kind, Date.now()));
}

function safeCompare(left, right) {
  // Hashing first keeps the comparison constant-time without revealing the password length.
  const leftHash = crypto.createHash('sha256').update(left).digest();
  const rightHash = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function requireAdmin(req, res, next) {
  if (!hasSession(req, 'ayesha_admin', 'admin')) {
    return res.status(401).json({ error: 'Admin authentication required.' });
  }
  next();
}

function cleanText(value, fieldName, { required = true, maxLength = 5000 } = {}) {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return null;
    throw new Error(`${fieldName} must be text.`);
  }
  const text = value.trim();
  if (required && !text) throw new Error(`${fieldName} is required.`);
  if (text.length > maxLength) throw new Error(`${fieldName} is too long.`);
  return text || null;
}

function parseBoolean(value, fallback = false) {
  return value === undefined ? fallback : Boolean(value);
}

function parseIdList(value, max) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(-max);
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const popupSettingKeys = ['main_quote_enabled', 'main_quote_delay', 'main_quote_frequency', 'main_quote_mode', 'main_quote_pool_category', 'main_quote_pinned_until'];
const saveSetting = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
`);

function readPopupSettings() {
  const settings = db.prepare(`SELECT key, value FROM settings WHERE key IN (${popupSettingKeys.map(() => '?').join(',')})`)
    .all(...popupSettingKeys)
    .reduce((result, setting) => ({ ...result, [setting.key]: setting.value }), {});
  return {
    enabled: settings.main_quote_enabled === '1',
    delay: Math.max(0, Math.min(60000, Number(settings.main_quote_delay) || 700)),
    frequency: ['session', 'day', 'always'].includes(settings.main_quote_frequency) ? settings.main_quote_frequency : 'session',
    mode: settings.main_quote_mode === 'pinned' ? 'pinned' : 'rotate',
    poolCategoryId: Number(settings.main_quote_pool_category) || null,
    pinnedUntil: isoDate.test(settings.main_quote_pinned_until || '') ? settings.main_quote_pinned_until : ''
  };
}

function readPinnedUntil(value) {
  const pinnedUntil = typeof value === 'string' ? value.trim() : '';
  if (pinnedUntil && !isoDate.test(pinnedUntil)) throw new Error('Pinned-until must be a date like 2026-11-05.');
  return pinnedUntil;
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.get('CF-Connecting-IP') || req.ip || 'unknown';
  const now = Date.now();
  const attempt = adminLoginAttempts.get(ip);
  const windowActive = attempt && now - attempt.startedAt < adminLoginWindowMs;
  if (windowActive && attempt.failures >= adminLoginMaxFailures) {
    return res.status(429).json({ error: 'Too many failed sign-in attempts. Please try again in 15 minutes.' });
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeCompare(password, adminPassword)) {
    adminLoginAttempts.set(ip, windowActive
      ? { ...attempt, failures: attempt.failures + 1 }
      : { failures: 1, startedAt: now });
    return res.status(401).json({ error: 'Invalid password.' });
  }

  adminLoginAttempts.delete(ip);
  const token = createSession('admin', adminSessionMs);
  res.setHeader('Set-Cookie', `ayesha_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(readCookie(req, 'ayesha_admin')));
  res.setHeader('Set-Cookie', 'ayesha_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/session', requireAdmin, (req, res) => {
  res.json({ authenticated: true });
});

app.get('/api/admin/dashboard', requireAdmin, (req, res) => {
  res.json({
    quotes: db.prepare('SELECT COUNT(*) AS total, SUM(active) AS active FROM quotes').get(),
    categories: db.prepare('SELECT COUNT(*) AS total, SUM(active) AS active FROM categories').get(),
    events: db.prepare('SELECT COUNT(*) AS total FROM events').get(),
    topCategories: db.prepare(`
      SELECT c.name, COUNT(e.id) AS interactions
      FROM events e
      JOIN categories c ON c.id = e.category_id
      GROUP BY c.id
      ORDER BY interactions DESC, c.name
      LIMIT 5
    `).all(),
    topQuotes: db.prepare(`
      SELECT q.text, c.name AS category_name, COUNT(e.id) AS views
      FROM events e
      JOIN quotes q ON q.id = e.quote_id
      JOIN categories c ON c.id = q.category_id
      WHERE e.event_type IN ('message-viewed', 'main-quote-seen')
      GROUP BY q.id
      ORDER BY views DESC, q.id
      LIMIT 5
    `).all(),
    mainQuote: db.prepare('SELECT id FROM quotes WHERE is_main_quote = 1 AND active = 1 LIMIT 1').get() || null,
    voiceUnread: unreadVoiceMessages('ayesha')
  });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({
    ...readPopupSettings(),
    pinnedQuote: db.prepare('SELECT id, text, status FROM quotes WHERE is_main_quote = 1 LIMIT 1').get() || null,
    voicePasswordConfigured: Boolean(readSetting('voice_password_hash'))
  });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const delay = Number(req.body?.delay);
  const frequency = req.body?.frequency;
  const mode = req.body?.mode;
  const poolCategoryId = Number(req.body?.poolCategoryId);
  if (!Number.isInteger(delay) || delay < 0 || delay > 60000) {
    return res.status(400).json({ error: 'Popup delay must be a whole number from 0 to 60000 milliseconds.' });
  }
  if (!['session', 'day', 'always'].includes(frequency)) {
    return res.status(400).json({ error: 'Popup frequency is invalid.' });
  }
  if (!['rotate', 'pinned'].includes(mode)) {
    return res.status(400).json({ error: 'Popup quote choice is invalid.' });
  }
  if (!Number.isInteger(poolCategoryId) || !db.prepare('SELECT id FROM categories WHERE id = ? AND private = 0').get(poolCategoryId)) {
    return res.status(400).json({ error: 'Choose a category to rotate through (private categories never pop up).' });
  }
  let pinnedUntil;
  try {
    pinnedUntil = readPinnedUntil(req.body?.pinnedUntil);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const update = db.transaction(() => {
    saveSetting.run('main_quote_enabled', req.body?.enabled ? '1' : '0');
    saveSetting.run('main_quote_delay', String(delay));
    saveSetting.run('main_quote_frequency', frequency);
    saveSetting.run('main_quote_mode', mode);
    saveSetting.run('main_quote_pool_category', String(poolCategoryId));
    saveSetting.run('main_quote_pinned_until', pinnedUntil);
  });

  update();
  res.json({ ok: true });
});

app.get('/api/admin/categories', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT c.id, c.name, c.slug,
      COALESCE(NULLIF(TRIM(c.card_title), ''), 'A little ' || LOWER(c.name)) AS card_title,
      c.description, c.color, c.active, c.private,
      COUNT(q.id) AS quote_count
    FROM categories c
    LEFT JOIN quotes q ON q.category_id = c.id
    GROUP BY c.id
    ORDER BY c.id
  `).all());
});

app.post('/api/admin/categories', requireAdmin, (req, res) => {
  try {
    const name = cleanText(req.body?.name, 'Name', { maxLength: 80 });
    const slug = cleanText(req.body?.slug, 'Slug', { maxLength: 80 })
      .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) throw new Error('Slug must contain letters or numbers.');
    const cardTitle = cleanText(req.body?.cardTitle, 'Card title', { required: false, maxLength: 120 })
      || `A little ${name.toLowerCase()}`;
    const result = db.prepare(`
      INSERT INTO categories (name, slug, card_title, description, color, private)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, slug, cardTitle, cleanText(req.body?.description, 'Description', { required: false, maxLength: 300 }), cleanText(req.body?.color, 'Color', { required: false, maxLength: 40 }), parseBoolean(req.body?.private) ? 1 : 0);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(400).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'That category name or slug already exists.' : error.message });
  }
});

app.put('/api/admin/categories/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new Error('Invalid category ID.');
    const name = cleanText(req.body?.name, 'Name', { maxLength: 80 });
    const slug = cleanText(req.body?.slug, 'Slug', { maxLength: 80 })
      .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) throw new Error('Slug must contain letters or numbers.');
    const cardTitle = cleanText(req.body?.cardTitle, 'Card title', { required: false, maxLength: 120 })
      || `A little ${name.toLowerCase()}`;
    const description = cleanText(req.body?.description, 'Description', { required: false, maxLength: 300 });
    const color = cleanText(req.body?.color, 'Color', { required: false, maxLength: 40 });
    const result = db.prepare(`
      UPDATE categories
      SET name = ?, slug = ?, card_title = ?, description = ?, color = ?, active = ?, private = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, slug, cardTitle, description, color, parseBoolean(req.body?.active, true) ? 1 : 0, parseBoolean(req.body?.private) ? 1 : 0, id);
    if (!result.changes) return res.status(404).json({ error: 'Category not found.' });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'That category name already exists.' : error.message });
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const quoteCount = db.prepare('SELECT COUNT(*) AS count FROM quotes WHERE category_id = ?').get(id).count;
  if (quoteCount) return res.status(409).json({ error: 'Move or delete this category’s quotes before deleting the category.' });
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Category not found.' });
  res.status(204).end();
});

app.get('/api/admin/quotes', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT q.id, q.text, q.author, q.active, q.status, q.is_main_quote, q.display_order,
      q.category_id, c.name AS category_name, c.slug AS category_slug, c.private AS category_private, q.liked_at, q.opened_at,
      (SELECT COUNT(*) FROM voice_messages m WHERE m.quote_id = q.id) AS comment_count
    FROM quotes q
    JOIN categories c ON c.id = q.category_id
    ORDER BY q.display_order, q.id
  `).all());
});

app.post('/api/admin/quotes', requireAdmin, (req, res) => {
  try {
    const text = cleanText(req.body?.text, 'Quote', { maxLength: 2000 });
    const categoryId = Number(req.body?.categoryId);
    if (!Number.isInteger(categoryId)) throw new Error('A category is required.');
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
    if (!category) throw new Error('Category not found.');
    const status = ['active', 'draft', 'archived'].includes(req.body?.status) ? req.body.status : 'active';
    const pinned = parseBoolean(req.body?.isMainQuote);
    const pinnedUntil = pinned ? readPinnedUntil(req.body?.pinnedUntil) : '';
    const addQuote = db.transaction(() => {
      if (pinned) {
        db.prepare('UPDATE quotes SET is_main_quote = 0').run();
        saveSetting.run('main_quote_mode', 'pinned');
        saveSetting.run('main_quote_pinned_until', pinnedUntil);
      }
      return db.prepare(`
        INSERT INTO quotes (text, category_id, author, active, status, is_main_quote, display_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(text, categoryId, cleanText(req.body?.author, 'Author', { required: false, maxLength: 120 }), status === 'active' ? 1 : 0, status, parseBoolean(req.body?.isMainQuote) ? 1 : 0, Number(req.body?.displayOrder) || 0);
    });
    res.status(201).json({ id: addQuote().lastInsertRowid });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/admin/quotes/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const text = cleanText(req.body?.text, 'Quote', { maxLength: 2000 });
    const categoryId = Number(req.body?.categoryId);
    if (!Number.isInteger(id) || !Number.isInteger(categoryId)) throw new Error('Invalid quote or category ID.');
    if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)) throw new Error('Category not found.');
    const status = ['active', 'draft', 'archived'].includes(req.body?.status) ? req.body.status : (parseBoolean(req.body?.active) ? 'active' : 'archived');
    const pinned = parseBoolean(req.body?.isMainQuote);
    const wasPinned = Boolean(db.prepare('SELECT is_main_quote FROM quotes WHERE id = ?').get(id)?.is_main_quote);
    // Only the quote form sends pinnedUntil; quick actions like Archive leave the popup settings alone.
    const pinnedUntil = pinned && req.body?.pinnedUntil !== undefined ? readPinnedUntil(req.body.pinnedUntil) : null;
    const updateQuote = db.transaction(() => {
      if (pinned) db.prepare('UPDATE quotes SET is_main_quote = 0').run();
      const result = db.prepare(`
        UPDATE quotes
        SET text = ?, category_id = ?, author = ?, active = ?, status = ?, is_main_quote = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(text, categoryId, cleanText(req.body?.author, 'Author', { required: false, maxLength: 120 }), status === 'active' ? 1 : 0, status, pinned ? 1 : 0, Number(req.body?.displayOrder) || 0, id);
      if (pinned && !wasPinned) {
        saveSetting.run('main_quote_mode', 'pinned');
        saveSetting.run('main_quote_pinned_until', pinnedUntil ?? '');
      } else if (pinned && pinnedUntil !== null) {
        saveSetting.run('main_quote_pinned_until', pinnedUntil);
      } else if (!pinned && wasPinned) {
        saveSetting.run('main_quote_mode', 'rotate');
      }
      return result;
    });
    if (!updateQuote().changes) return res.status(404).json({ error: 'Quote not found.' });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/admin/quotes/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const wasPinned = Boolean(db.prepare('SELECT is_main_quote FROM quotes WHERE id = ?').get(id)?.is_main_quote);
  const result = db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Quote not found.' });
  if (wasPinned) saveSetting.run('main_quote_mode', 'rotate');
  res.status(204).end();
});

app.get('/api/quotes/random', (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : 'welcome';
  const isPrivate = Boolean(db.prepare('SELECT private FROM categories WHERE slug = ?').get(category)?.private);
  if (isPrivate) {
    res.set('Cache-Control', 'private, no-store');
    if (!canSeePrivate(req)) return res.status(401).json({ error: 'This one is sealed.', sealed: true });
  }
  // Sealed notes she has never opened come first, in the order they are listed in admin; once she has read them
  // all, it is random again.
  const forHer = isPrivate && isHer(req);
  const unopened = forHer && db.prepare(`
    SELECT q.id, q.text, q.author, c.id AS category_id, c.name AS category_name, c.slug AS category_slug
    FROM quotes q
    JOIN categories c ON c.id = q.category_id
    WHERE q.active = 1 AND q.status = 'active' AND c.active = 1 AND c.slug = ? AND q.opened_at IS NULL
    ORDER BY q.display_order, q.id
    LIMIT 1
  `).get(category);
  if (unopened) db.prepare('UPDATE quotes SET opened_at = CURRENT_TIMESTAMP WHERE id = ?').run(unopened.id);

  const excludedIds = parseIdList(req.query.exclude, 10);
  const exclusionClause = excludedIds.length ? `AND q.id NOT IN (${excludedIds.map(() => '?').join(',')})` : '';
  const quote = unopened || db.prepare(`
    SELECT q.id, q.text, q.author, c.id AS category_id, c.name AS category_name, c.slug AS category_slug
    FROM quotes q
    JOIN categories c ON c.id = q.category_id
    WHERE q.active = 1 AND q.status = 'active' AND c.active = 1 AND c.slug = ? ${exclusionClause}
    ORDER BY RANDOM()
    LIMIT 1
  `).get(category, ...excludedIds);

  const fallback = quote || db.prepare(`
    SELECT q.id, q.text, q.author, c.id AS category_id, c.name AS category_name, c.slug AS category_slug
    FROM quotes q
    JOIN categories c ON c.id = q.category_id
    WHERE q.active = 1 AND q.status = 'active' AND c.active = 1 AND c.slug = ?
    ORDER BY RANDOM()
    LIMIT 1
  `).get(category);

  if (!fallback) return res.status(404).json({ error: 'No active quotes found for this category.' });
  res.json({
    id: fallback.id,
    text: fallback.text,
    author: fallback.author,
    category: { id: fallback.category_id, name: fallback.category_name, slug: fallback.category_slug },
    // Only she (signed in to the mailbox) can ♡ or comment, so only she gets these.
    ...(isPrivate && hasSession(req, 'ayesha_voice', 'voice') ? { reactions: noteReactions(fallback.id) } : {}),
    ...(forHer ? { isNew: Boolean(unopened), newLeft: unopenedCount(fallback.category_id) } : {})
  });
});

// ---- Announcement bar: one short message across the top of the site, managed in admin. ----
// Each published announcement has a version; the visitor's browser remembers the version they closed.

const announcementKeys = ['announcement_enabled', 'announcement_version', 'announcement_text', 'announcement_link_type', 'announcement_link_label', 'announcement_link_url', 'announcement_until'];

function readAnnouncement() {
  const settings = db.prepare(`SELECT key, value FROM settings WHERE key IN (${announcementKeys.map(() => '?').join(',')})`)
    .all(...announcementKeys)
    .reduce((result, setting) => ({ ...result, [setting.key]: setting.value }), {});
  return {
    enabled: settings.announcement_enabled === '1',
    version: Number(settings.announcement_version) || 0,
    text: settings.announcement_text || '',
    linkType: ['mailbox', 'link'].includes(settings.announcement_link_type) ? settings.announcement_link_type : 'none',
    linkLabel: settings.announcement_link_label || '',
    linkUrl: settings.announcement_link_url || '',
    until: isoDate.test(settings.announcement_until || '') ? settings.announcement_until : ''
  };
}

app.get('/api/announcement', (req, res) => {
  const announcement = readAnnouncement();
  const today = isoDate.test(req.query.today || '') ? req.query.today : new Date().toISOString().slice(0, 10);
  if (!announcement.enabled || !announcement.text || (announcement.until && today > announcement.until)) return res.status(204).end();
  res.json({
    version: announcement.version,
    text: announcement.text,
    link: announcement.linkType === 'none' ? null : { type: announcement.linkType, label: announcement.linkLabel, url: announcement.linkUrl }
  });
});

app.get('/api/admin/announcement', requireAdmin, (req, res) => {
  res.json(readAnnouncement());
});

// "Publish as new" bumps the version so everyone sees it again; "small edit" keeps it, so a typo fix doesn't reappear.
app.put('/api/admin/announcement', requireAdmin, (req, res) => {
  try {
    const current = readAnnouncement();
    const enabled = Boolean(req.body?.enabled);
    const text = cleanText(req.body?.text ?? '', 'Message', { required: enabled, maxLength: 200 }) || '';
    const linkType = ['none', 'mailbox', 'link'].includes(req.body?.linkType) ? req.body.linkType : 'none';
    const linkLabel = linkType === 'none' ? '' : cleanText(req.body?.linkLabel, 'Button text', { maxLength: 40 });
    const linkUrl = linkType === 'link' ? cleanText(req.body?.linkUrl, 'Link', { maxLength: 300 }) : '';
    if (linkUrl && !/^(https?:\/\/|\/|#)/i.test(linkUrl)) throw new Error('Links must start with https://, / or #.');
    const until = readPinnedUntil(req.body?.until);
    const version = req.body?.asNew || !current.version ? current.version + 1 : current.version;
    db.transaction(() => {
      saveSetting.run('announcement_enabled', enabled ? '1' : '0');
      saveSetting.run('announcement_version', String(version));
      saveSetting.run('announcement_text', text);
      saveSetting.run('announcement_link_type', linkType);
      saveSetting.run('announcement_link_label', linkLabel);
      saveSetting.run('announcement_link_url', linkUrl);
      saveSetting.run('announcement_until', until);
    })();
    res.json({ ok: true, version });
  } catch (error) {
    res.status(400).json({ error: error.message.replace('Pinned-until', 'Show until') });
  }
});

// ---- Sleepy bunny: a little companion on the flower arch; the admin sets what it says when tapped. ----

function readBunny() {
  let lines = [];
  try {
    lines = JSON.parse(readSetting('bunny_lines') || '[]');
  } catch (error) {
    lines = [];
  }
  return { enabled: readSetting('bunny_enabled') === '1', lines: Array.isArray(lines) ? lines.filter(line => typeof line === 'string') : [] };
}

app.get('/api/bunny', (req, res) => {
  res.json(readBunny());
});

app.get('/api/admin/bunny', requireAdmin, (req, res) => {
  res.json(readBunny());
});

app.put('/api/admin/bunny', requireAdmin, (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const lines = (Array.isArray(req.body?.lines) ? req.body.lines : [])
    .map(line => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean);
  if (enabled && !lines.length) return res.status(400).json({ error: 'Give the bunny at least one thing to say.' });
  if (lines.length > 12) return res.status(400).json({ error: 'The bunny can have up to 12 lines.' });
  if (lines.some(line => line.length > 60)) return res.status(400).json({ error: 'Each line can be up to 60 characters.' });
  saveSetting.run('bunny_enabled', enabled ? '1' : '0');
  saveSetting.run('bunny_lines', JSON.stringify(lines));
  res.json({ ok: true });
});

// ---- Tap the flower: seven quick taps on the big flower reveal a secret message set in admin. ----

function readFlowerSecret() {
  return { enabled: readSetting('flower_secret_enabled') === '1', message: readSetting('flower_secret_message') };
}

app.get('/api/flower', (req, res) => {
  res.json(readFlowerSecret());
});

app.get('/api/admin/flower', requireAdmin, (req, res) => {
  res.json(readFlowerSecret());
});

app.put('/api/admin/flower', requireAdmin, (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    const message = cleanText(req.body?.message ?? '', 'Secret message', { required: enabled, maxLength: 160 }) || '';
    saveSetting.run('flower_secret_enabled', enabled ? '1' : '0');
    saveSetting.run('flower_secret_message', message);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const popupQuoteQuery = `
  SELECT q.id, q.text, q.author, c.id AS category_id, c.name AS category_name, c.slug AS category_slug
  FROM quotes q
  JOIN categories c ON c.id = q.category_id
  WHERE q.active = 1 AND q.status = 'active' AND c.active = 1 AND c.private = 0
`;

app.get('/api/quotes/main', (req, res) => {
  const settings = readPopupSettings();
  if (!settings.enabled) return res.status(404).json({ error: 'Main quote popup is disabled.' });
  // The visitor's own date, so "pinned until" ends at midnight where she is.
  const today = isoDate.test(req.query.today || '') ? req.query.today : new Date().toISOString().slice(0, 10);
  let quote = null;
  let source = 'rotation';
  let deckReset = false;

  if (settings.mode === 'pinned' && (!settings.pinnedUntil || today <= settings.pinnedUntil)) {
    quote = db.prepare(`${popupQuoteQuery} AND q.is_main_quote = 1 LIMIT 1`).get();
    if (quote) source = 'pinned';
  }

  // Shuffled deck: the browser sends the popup quotes it has already seen, so every visit gets an
  // unseen one. Once the whole pool has been seen, the deck starts again (avoiding the last one shown).
  if (!quote) {
    const seenIds = parseIdList(req.query.exclude, 1000);
    const notSeen = seenIds.length ? `AND q.id NOT IN (${seenIds.map(() => '?').join(',')})` : '';
    quote = db.prepare(`${popupQuoteQuery} AND q.category_id = ? ${notSeen} ORDER BY RANDOM() LIMIT 1`)
      .get(settings.poolCategoryId, ...seenIds);
    if (!quote) {
      deckReset = true;
      quote = db.prepare(`${popupQuoteQuery} AND q.category_id = ? ORDER BY q.id = ?, RANDOM() LIMIT 1`)
        .get(settings.poolCategoryId, seenIds.at(-1) ?? 0);
    }
  }

  if (!quote) return res.status(404).json({ error: 'No popup quote is available.' });
  res.json({
    id: quote.id,
    text: quote.text,
    author: quote.author,
    category: { id: quote.category_id, name: quote.category_name, slug: quote.category_slug },
    popup: { delay: settings.delay, frequency: settings.frequency, source, deckReset }
  });
});

// ---- Our little mailbox: a private two-way thread between Ayesha and Zohaib (voice notes or short text). ----

function readSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
}

function unreadVoiceMessages(sender) {
  return db.prepare('SELECT COUNT(*) AS count FROM voice_messages WHERE sender = ? AND read_at IS NULL').get(sender).count;
}

function requireVoice(req, res, next) {
  if (!hasSession(req, 'ayesha_voice', 'voice')) return res.status(401).json({ error: 'Please enter your mailbox password.' });
  next();
}

// Opening the thread marks the other person's messages as seen.
// A short line about a message, for the quote above a reply.
function replyPreview(message) {
  if (message.sticker) return 'a bunny sticker';
  if (message.kind === 'voice') {
    const seconds = Math.round((message.duration_ms || 0) / 1000);
    return `voice note · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  const text = message.body || '';
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

function listVoiceMessages(reader) {
  db.prepare('UPDATE voice_messages SET read_at = CURRENT_TIMESTAMP WHERE sender != ? AND read_at IS NULL').run(reader);
  return db.prepare(`
    SELECT * FROM (
      SELECT m.id, m.sender, m.kind, m.body, m.duration_ms, m.created_at, m.read_at, m.quote_id, m.reply_to, m.reaction,
        m.played_at, m.sticker, q.text AS note_text, r.id AS reply_id, r.sender AS reply_sender, r.kind AS reply_kind,
        r.body AS reply_body, r.duration_ms AS reply_duration_ms, r.sticker AS reply_sticker
      FROM voice_messages m
      LEFT JOIN quotes q ON q.id = m.quote_id
      LEFT JOIN voice_messages r ON r.id = m.reply_to
      ORDER BY m.created_at DESC, m.id DESC LIMIT 200
    ) ORDER BY created_at, id
  `).all().map(message => ({
    id: message.id,
    sender: message.sender,
    kind: message.kind,
    text: message.body,
    sticker: bunnyStickers[message.sticker] ? message.sticker : null,
    note: message.quote_id ? (message.note_text || 'a note that has since been removed') : null,
    // The message it answers; if that one was unsent or deleted, the reply still says so.
    replyTo: message.reply_to
      ? (message.reply_id
        ? { id: message.reply_id, sender: message.reply_sender, preview: replyPreview({ kind: message.reply_kind, body: message.reply_body, duration_ms: message.reply_duration_ms, sticker: message.reply_sticker }) }
        : { id: null, gone: true })
      : null,
    audioUrl: message.kind === 'voice' ? `/api/voice/audio/${message.id}` : null,
    durationMs: message.duration_ms,
    createdAt: message.created_at,
    readAt: message.read_at,
    playedAt: message.played_at,
    reaction: chatReactions.includes(message.reaction) ? message.reaction : null
  }));
}

// Only messages that were actually saved count towards her 30-an-hour limit.
function limitAyeshaSending(req, res, next) {
  const now = Date.now();
  while (ayeshaSendTimes.length && now - ayeshaSendTimes[0] > 60 * 60 * 1000) ayeshaSendTimes.shift();
  if (ayeshaSendTimes.length >= 30) return res.status(429).json({ error: 'That is a lot of love for one hour. Please try again a little later.' });
  next();
}

// A reply must point at a message that is still there.
function readReplyTo(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) return null;
  return db.prepare('SELECT id FROM voice_messages WHERE id = ?').get(id) ? id : null;
}

// A typed message or a bunny sticker; returns which, for the buzz on his phone.
function addTextMessage(sender, req) {
  const replyTo = readReplyTo(req.body?.replyTo);
  if (req.body?.sticker !== undefined) {
    const sticker = String(req.body.sticker);
    if (!bunnyStickers[sticker]) throw new Error('That sticker is not one of the bunnies.');
    db.prepare("INSERT INTO voice_messages (sender, kind, body, sticker, reply_to) VALUES (?, 'text', ?, ?, ?)").run(sender, bunnyStickers[sticker], sticker, replyTo);
    return 'sticker';
  }
  const text = cleanText(req.body?.text, 'Message', { maxLength: 1000 });
  db.prepare("INSERT INTO voice_messages (sender, kind, body, reply_to) VALUES (?, 'text', ?, ?)").run(sender, text, replyTo);
  return 'text';
}

// An emoji reaction from whoever received the message (never on your own); null takes it away.
function readReaction(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!chatReactions.includes(value)) throw new Error('That reaction is not one of the emoji.');
  return value;
}

function setReaction(id, receiver, reaction) {
  const message = db.prepare('SELECT sender, reaction FROM voice_messages WHERE id = ?').get(id);
  if (!message || message.sender === receiver) return null;
  db.prepare('UPDATE voice_messages SET reaction = ? WHERE id = ?').run(reaction, id);
  return { changed: reaction !== null && reaction !== message.reaction };
}

// The first time the one who received a voice note plays it, the sender sees "listened ✓".
function markPlayed(id, listener) {
  return db.prepare("UPDATE voice_messages SET played_at = COALESCE(played_at, CURRENT_TIMESTAMP) WHERE id = ? AND kind = 'voice' AND sender != ?")
    .run(id, listener).changes > 0;
}

function addVoiceMessage(sender, req) {
  const type = (req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const extension = voiceAudioTypes[type];
  const durationMs = Number(req.get('X-Duration-Ms'));
  if (!extension || !Buffer.isBuffer(req.body) || !req.body.length) throw new Error('That voice note could not be read.');
  if (!Number.isInteger(durationMs) || durationMs < 500 || durationMs > maxVoiceNoteMs) {
    throw new Error('Voice notes can be from half a second up to 2 minutes.');
  }
  const fileName = `${crypto.randomBytes(16).toString('hex')}.${extension}`;
  fs.writeFileSync(path.join(voiceDir, fileName), req.body);
  db.prepare("INSERT INTO voice_messages (sender, kind, audio_file, audio_type, duration_ms, reply_to) VALUES (?, 'voice', ?, ?, ?, ?)")
    .run(sender, fileName, type, durationMs, readReplyTo(req.get('X-Reply-To')));
}

function deleteVoiceMessage(id, onlySender = null) {
  const message = db.prepare('SELECT sender, audio_file FROM voice_messages WHERE id = ?').get(id);
  if (!message || (onlySender && message.sender !== onlySender)) return false;
  db.prepare('DELETE FROM voice_messages WHERE id = ?').run(id);
  if (message.audio_file) fs.rmSync(path.join(voiceDir, path.basename(message.audio_file)), { force: true });
  return true;
}

// Sends a short push to Zohaib's phone through ntfy. Only says that something arrived; never the content.
function sendPhoneAlert(req, message, tag) {
  return sendAlertFor(req.get('host') || 'localhost', message, tag);
}

// The same buzz, for when there is no request to hand (her invites held back while he drives).
async function sendAlertFor(siteHost, message, tag) {
  const topic = readSetting('alerts_ntfy_topic');
  if (!topic) return false;
  const siteOrigin = /^(localhost|127\.0\.0\.1)(:|$)/.test(siteHost) ? `http://${siteHost}` : `https://${siteHost}`;
  try {
    const response = await fetch(`${ntfyServer}/${topic}`, {
      method: 'POST',
      body: message,
      headers: { Title: 'Ayesha', Tags: tag, Click: `${siteOrigin}/admin/#voice` },
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch (error) {
    console.warn('Phone alert failed:', error.message);
    return false;
  }
}

const audioUpload = express.raw({ type: req => /^audio\//i.test(req.get('Content-Type') || ''), limit: '8mb' });

app.post('/api/voice/unlock', (req, res) => {
  const passwordHash = readSetting('voice_password_hash');
  if (!passwordHash) return res.status(503).json({ error: 'The mailbox is not set up yet.' });
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ip = req.get('CF-Connecting-IP') || req.ip || 'unknown';
  const now = Date.now();
  const attempt = voiceUnlockAttempts.get(ip) || { count: 0, startedAt: now };
  if (now - attempt.startedAt >= 60 * 1000) {
    attempt.count = 0;
    attempt.startedAt = now;
  }
  if (attempt.count >= 5) return res.status(429).json({ error: 'Too many attempts. Please try again in a minute.' });
  attempt.count += 1;
  voiceUnlockAttempts.set(ip, attempt);
  if (!verifyPassword(password, passwordHash)) return res.status(401).json({ error: 'That password is not correct.' });
  voiceUnlockAttempts.delete(ip);
  const token = createSession('voice', voiceSessionMs);
  res.setHeader('Set-Cookie', `ayesha_voice=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${voiceSessionMs / 1000}`);
  res.json({ ok: true });
});

app.get('/api/voice/session', requireVoice, (req, res) => {
  res.json({ unread: unreadVoiceMessages('zohaib') });
});

// The bunny's wardrobe (her outfit, saved looks, visit days and unlocks), kept with her mailbox login so it follows her
// between phones. Only short item ids, dates and yes/no flags are stored.
const wardrobeSlotNames = ['head', 'ear', 'face', 'neck', 'hold', 'fur'];

function cleanWardrobe(input) {
  const itemId = value => (typeof value === 'string' && /^[a-z0-9-]{1,24}$/.test(value) ? value : '');
  const outfit = value => Object.fromEntries(wardrobeSlotNames.map(slot => [slot, itemId(value?.[slot])]));
  const list = (value, pattern, max) => (Array.isArray(value)
    ? [...new Set(value.filter(entry => typeof entry === 'string' && pattern.test(entry)))].slice(-max)
    : []);
  return {
    outfit: outfit(input?.outfit),
    looks: [0, 1, 2].map(index => (input?.looks?.[index] && typeof input.looks[index] === 'object' ? outfit(input.looks[index]) : null)),
    seen: input?.seen === null ? null : list(input?.seen, /^[a-z0-9-]{1,24}$/, 100),
    days: list(input?.days, /^(\d{4}-\d{2}-\d{2}|legacy-\d{1,3})$/, 400),
    secret: input?.secret === true,
    nightOwl: input?.nightOwl === true,
    delivered: input?.delivered === true,
    updatedAt: Math.max(0, Math.min(Math.floor(Number(input?.updatedAt) || 0), Date.now() + 24 * 60 * 60 * 1000))
  };
}

app.get('/api/wardrobe', requireVoice, (req, res) => {
  let state = null;
  try {
    const saved = readSetting('bunny_wardrobe');
    state = saved ? cleanWardrobe(JSON.parse(saved)) : null;
  } catch (error) {
    state = null;
  }
  res.json({ state });
});

app.put('/api/wardrobe', requireVoice, (req, res) => {
  if (!req.body?.state || typeof req.body.state !== 'object') return res.status(400).json({ error: 'Nothing to save.' });
  saveSetting.run('bunny_wardrobe', JSON.stringify(cleanWardrobe(req.body.state)));
  res.json({ ok: true });
});

app.get('/api/voice/messages', requireVoice, (req, res) => {
  res.json(listVoiceMessages('ayesha'));
});

app.post('/api/voice/messages', requireVoice, limitAyeshaSending, (req, res) => {
  let kind;
  try {
    kind = addTextMessage('ayesha', req);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  ayeshaSendTimes.push(Date.now());
  sendPhoneAlert(req, kind === 'sticker' ? 'Ayesha sent you a sticker ✦' : 'Ayesha sent you a little message ✦', 'speech_balloon');
  res.status(201).json({ ok: true });
});

app.put('/api/voice/messages/:id/reaction', requireVoice, (req, res) => {
  const id = Number(req.params.id);
  let reaction;
  try {
    reaction = readReaction(req.body?.reaction);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const result = setReaction(id, 'ayesha', reaction);
  if (!result) return res.status(404).json({ error: 'That message could not be found.' });
  // One buzz per message per hour, however many times she changes her mind.
  if (result.changed && Date.now() - (reactionAlertTimes.get(id) || 0) > 60 * 60 * 1000) {
    reactionAlertTimes.set(id, Date.now());
    sendPhoneAlert(req, `Ayesha reacted ${reaction} to your message`, 'heart');
  }
  res.json({ reaction });
});

app.post('/api/voice/messages/:id/played', requireVoice, (req, res) => {
  markPlayed(Number(req.params.id), 'ayesha');
  res.status(204).end();
});

// ---- Her ♡ and comments on the sealed "only for you" notes. A comment is a mailbox message that remembers its note,
// so it reaches Zohaib's mailbox (with a phone alert) and he replies there. Only sealed notes take these.
const likeAlertTimes = new Map();

function sealedNote(id) {
  if (!Number.isInteger(id)) return null;
  return db.prepare(`
    SELECT q.id, q.liked_at FROM quotes q
    JOIN categories c ON c.id = q.category_id
    WHERE q.id = ? AND c.private = 1
  `).get(id) || null;
}

// Her ♡ and what she has written about a note (oldest first), for the comment panel the next time it comes up.
function noteReactions(id) {
  const note = sealedNote(id);
  const comments = db.prepare(`
    SELECT body, created_at FROM voice_messages
    WHERE quote_id = ? AND sender = 'ayesha'
    ORDER BY created_at DESC, id DESC LIMIT 50
  `).all(id).reverse().map(comment => ({ text: comment.body, createdAt: comment.created_at }));
  return { liked: Boolean(note?.liked_at), comments };
}

app.post('/api/notes/:id/comments', requireVoice, limitAyeshaSending, (req, res) => {
  const note = sealedNote(Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'That note could not be found.' });
  let text;
  try {
    text = cleanText(req.body?.text, 'Comment', { maxLength: 500 });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const saved = db.prepare("INSERT INTO voice_messages (sender, kind, body, quote_id) VALUES ('ayesha', 'text', ?, ?)").run(text, note.id);
  ayeshaSendTimes.push(Date.now());
  sendPhoneAlert(req, 'Ayesha wrote back on one of your notes 💬', 'speech_balloon');
  const createdAt = db.prepare('SELECT created_at FROM voice_messages WHERE id = ?').get(saved.lastInsertRowid).created_at;
  res.status(201).json({ ok: true, comment: { text, createdAt } });
});

// ---- His status for her ("free · at home"), set by Zohaib's iPhone Shortcuts (with a secret key) or by hand in admin.
// Shortcuts send one word; each word sets a status that ends on its own, so it is never stale. Only her mailbox login
// (and the admin) can read it, and she can send a one-tap invite that buzzes his phone and lands in the mailbox.
const statusPresets = {
  home: { label: 'free', place: 'at home', tone: 'free', at: 'home', hours: 10 },
  school: { label: 'at school', place: '', tone: 'away', at: 'school', hours: 8 },
  'free-school': { label: 'free', place: 'at school', tone: 'free', at: 'school', hours: 2 },
  work: { label: 'at work', place: '', tone: 'busy', at: 'work', hours: 9 },
  free: { label: 'free', place: '', tone: 'free', at: '', hours: 2 },
  chat: { label: 'busy, can chat', place: '', tone: 'chat', at: '', hours: 3 },
  busy: { label: 'busy', place: '', tone: 'busy', at: '', hours: 3 },
  driving: { label: 'driving', place: '', tone: 'busy', at: 'driving', hours: 2 }
};
const statusWords = [...Object.keys(statusPresets), 'leave-home', 'leave-school', 'leave-work', 'leave-driving', 'clear'];
// Her buttons: what lands in the mailbox, and what buzzes his phone.
const statusInvites = {
  hey: { text: 'heyyy 👋', alert: 'Ayesha: heyyy 👋' },
  heartbeat: { text: '💓 a heartbeat', alert: '💓 a heartbeat from Ayesha' },
  find: { text: 'come find me 📍', alert: 'Ayesha: come find me 📍' },
  library: { text: 'come to library please 📚', alert: 'Ayesha: come to library please 📚' }
};
const inviteTimes = [];
const lastInviteByKind = new Map();

function savedStatus() {
  try {
    return JSON.parse(readSetting('zohaib_status') || 'null');
  } catch (error) {
    return null;
  }
}

function readStatus() {
  const saved = savedStatus();
  const preset = statusPresets[saved?.key];
  if (!preset || !(saved.expiresAt > Date.now())) return null;
  return { key: saved.key, label: preset.label, place: preset.place, tone: preset.tone, at: preset.at, setAt: saved.setAt, expiresAt: saved.expiresAt };
}

// While he is driving, her taps still land in the mailbox, but the buzz waits until the drive is over (the car's
// Bluetooth lets go, another status takes over, or "driving" runs out). They are saved, so a restart keeps them.
function heldInvites() {
  try {
    return JSON.parse(readSetting('held_invites') || '[]');
  } catch (error) {
    return [];
  }
}

function releaseHeldInvites() {
  const held = heldInvites();
  if (!held.length || readStatus()?.key === 'driving') return;
  saveSetting.run('held_invites', '');
  const sent = [...new Set(held.map(item => item.kind))].filter(kind => statusInvites[kind]).map(kind => statusInvites[kind].text);
  if (sent.length) sendAlertFor(held.at(-1).host, `While you were driving, Ayesha sent: ${sent.join(' · ')}`, 'sparkling_heart');
}

setInterval(releaseHeldInvites, 60 * 1000).unref();

// "leave-home" and friends only clear a status that came from that place, so a late "left home" can't wipe "at school".
function applyStatus(word) {
  if (word === 'clear') {
    saveSetting.run('zohaib_status', '');
  } else if (word.startsWith('leave-')) {
    if (statusPresets[savedStatus()?.key]?.at === word.slice('leave-'.length)) saveSetting.run('zohaib_status', '');
  } else {
    const now = Date.now();
    saveSetting.run('zohaib_status', JSON.stringify({ key: word, setAt: now, expiresAt: now + statusPresets[word].hours * 60 * 60 * 1000 }));
  }
  return readStatus();
}

// The iPhone's key is kept only as a hash; it can set the status and nothing else.
function hasStatusKey(req) {
  const stored = readSetting('status_key_hash');
  const given = req.get('X-Status-Key');
  if (!stored || typeof given !== 'string' || !given.trim()) return false;
  const actual = Buffer.from(hashToken(given.trim()));
  const expected = Buffer.from(stored);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

app.post('/api/status', (req, res) => {
  if (!hasStatusKey(req) && !hasSession(req, 'ayesha_admin', 'admin')) return res.status(401).json({ error: 'That status key is not right.' });
  const word = typeof req.body?.set === 'string' ? req.body.set.trim().toLowerCase() : '';
  if (!statusWords.includes(word)) return res.status(400).json({ error: `Send one of: ${statusWords.join(', ')}.` });
  const status = applyStatus(word);
  releaseHeldInvites();
  res.json({ ok: true, status });
});

app.get('/api/status', (req, res) => {
  if (!canSeePrivate(req)) return res.status(401).json({ error: 'Please enter your mailbox password.' });
  res.set('Cache-Control', 'private, no-store');
  res.json({ status: readStatus() });
});

app.post('/api/status/invite', requireVoice, (req, res) => {
  const kind = typeof req.body?.kind === 'string' ? req.body.kind : '';
  if (!statusInvites[kind]) return res.status(400).json({ error: 'That invite is not one of the buttons.' });
  const now = Date.now();
  while (inviteTimes.length && now - inviteTimes[0] > 60 * 60 * 1000) inviteTimes.shift();
  if (inviteTimes.length >= 12 || now - (lastInviteByKind.get(kind) || 0) < 2 * 60 * 1000) {
    return res.status(429).json({ error: 'already sent ♡ give it a minute' });
  }
  inviteTimes.push(now);
  lastInviteByKind.set(kind, now);
  db.prepare("INSERT INTO voice_messages (sender, kind, body) VALUES ('ayesha', 'text', ?)").run(statusInvites[kind].text);
  if (readStatus()?.key === 'driving') {
    saveSetting.run('held_invites', JSON.stringify([...heldInvites(), { kind, host: req.get('host') || 'localhost' }]));
    return res.status(201).json({ ok: true, held: true });
  }
  sendPhoneAlert(req, statusInvites[kind].alert, 'sparkling_heart');
  res.status(201).json({ ok: true });
});

app.get('/api/admin/status', requireAdmin, (req, res) => {
  res.json({ status: readStatus(), keyConfigured: Boolean(readSetting('status_key_hash')) });
});

// A new key replaces the old one (the old key stops working at once). It is shown once, here.
app.post('/api/admin/status/key', requireAdmin, (req, res) => {
  const key = crypto.randomBytes(24).toString('hex');
  saveSetting.run('status_key_hash', hashToken(key));
  res.status(201).json({ key });
});

app.delete('/api/admin/status/key', requireAdmin, (req, res) => {
  saveSetting.run('status_key_hash', '');
  res.status(204).end();
});

app.put('/api/notes/:id/like', requireVoice, (req, res) => {
  const note = sealedNote(Number(req.params.id));
  if (!note) return res.status(404).json({ error: 'That note could not be found.' });
  const liked = parseBoolean(req.body?.liked);
  db.prepare(`UPDATE quotes SET liked_at = ${liked ? 'COALESCE(liked_at, CURRENT_TIMESTAMP)' : 'NULL'} WHERE id = ?`).run(note.id);
  // One buzz per note per hour, however many times the heart is tapped.
  const lastAlert = likeAlertTimes.get(note.id) || 0;
  if (liked && !note.liked_at && Date.now() - lastAlert > 60 * 60 * 1000) {
    likeAlertTimes.set(note.id, Date.now());
    sendPhoneAlert(req, 'Ayesha ♡ one of your notes', 'heart');
  }
  res.json({ liked });
});

app.post('/api/voice/messages/audio', requireVoice, limitAyeshaSending, audioUpload, (req, res) => {
  try {
    addVoiceMessage('ayesha', req);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  ayeshaSendTimes.push(Date.now());
  sendPhoneAlert(req, 'Ayesha sent you a voice note ✦', 'microphone');
  res.status(201).json({ ok: true });
});

// She can unsend her own message for a few minutes after sending it; after that it stays.
app.delete('/api/voice/messages/:id', requireVoice, (req, res) => {
  const id = Number(req.params.id);
  const message = db.prepare("SELECT created_at >= datetime('now', ?) AS recent FROM voice_messages WHERE id = ? AND sender = 'ayesha'")
    .get(`-${unsendMinutes} minutes`, id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  if (!message.recent) return res.status(403).json({ error: `Messages can only be unsent for ${unsendMinutes} minutes.` });
  deleteVoiceMessage(id, 'ayesha');
  res.status(204).end();
});

app.get('/api/voice/audio/:id', (req, res) => {
  if (!hasSession(req, 'ayesha_voice', 'voice') && !hasSession(req, 'ayesha_admin', 'admin')) {
    return res.status(401).json({ error: 'The mailbox is private.' });
  }
  const message = db.prepare("SELECT audio_file, audio_type FROM voice_messages WHERE id = ? AND kind = 'voice'").get(Number(req.params.id));
  if (!message) return res.status(404).json({ error: 'Voice note not found.' });
  res.set({ 'Content-Type': message.audio_type, 'Cache-Control': 'private, max-age=86400' });
  res.sendFile(path.join(voiceDir, path.basename(message.audio_file)), error => {
    if (error && !res.headersSent) res.status(404).json({ error: 'Voice note not found.' });
  });
});

app.get('/api/admin/voice/messages', requireAdmin, (req, res) => {
  res.json(listVoiceMessages('zohaib'));
});

app.post('/api/admin/voice/messages', requireAdmin, (req, res) => {
  try {
    addTextMessage('zohaib', req);
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/admin/voice/messages/:id/reaction', requireAdmin, (req, res) => {
  let reaction;
  try {
    reaction = readReaction(req.body?.reaction);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (!setReaction(Number(req.params.id), 'zohaib', reaction)) return res.status(404).json({ error: 'That message could not be found.' });
  res.json({ reaction });
});

app.post('/api/admin/voice/messages/:id/played', requireAdmin, (req, res) => {
  markPlayed(Number(req.params.id), 'zohaib');
  res.status(204).end();
});

app.post('/api/admin/voice/messages/audio', requireAdmin, audioUpload, (req, res) => {
  try {
    addVoiceMessage('zohaib', req);
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/admin/voice/messages/:id', requireAdmin, (req, res) => {
  if (!deleteVoiceMessage(Number(req.params.id))) return res.status(404).json({ error: 'Message not found.' });
  res.status(204).end();
});

app.put('/api/admin/voice/password', requireAdmin, (req, res) => {
  try {
    const password = cleanText(req.body?.password, 'Mailbox password', { maxLength: 200 });
    if (password.length < 4) throw new Error('Mailbox password must be at least 4 characters.');
    saveSetting.run('voice_password_hash', hashPassword(password));
    db.prepare("DELETE FROM auth_sessions WHERE kind = 'voice'").run();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/alerts', requireAdmin, (req, res) => {
  res.json({ topic: readSetting('alerts_ntfy_topic') || null });
});

app.post('/api/admin/alerts', requireAdmin, (req, res) => {
  const topic = readSetting('alerts_ntfy_topic') || `ayesha-notes-${crypto.randomBytes(12).toString('hex')}`;
  saveSetting.run('alerts_ntfy_topic', topic);
  res.json({ topic });
});

app.delete('/api/admin/alerts', requireAdmin, (req, res) => {
  saveSetting.run('alerts_ntfy_topic', '');
  res.status(204).end();
});

app.post('/api/admin/alerts/test', requireAdmin, async (req, res) => {
  if (!readSetting('alerts_ntfy_topic')) return res.status(400).json({ error: 'Set up phone alerts first.' });
  if (!await sendPhoneAlert(req, 'Test alert: you will get a buzz like this when Ayesha sends a note ✦', 'bell')) {
    return res.status(502).json({ error: 'The test alert could not be sent. Please try again in a moment.' });
  }
  res.json({ ok: true });
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'That voice note is too big to send.' });
  next(error);
});

// On Linux, reusePort lets the next container bind the same port while the current one
// still serves, so deploy.sh can swap them without dropping requests.
const server = http.createServer(app);
const listenOptions = { port, host, reusePort: process.platform === 'linux' };
let waitingForPort = false;

server.on('listening', () => {
  console.log(`Ayesha gift server running at http://localhost:${port}`);
});
server.on('error', error => {
  if (error.code !== 'EADDRINUSE') throw error;
  if (!waitingForPort) console.log(`Port ${port} is in use; waiting for it to be released...`);
  waitingForPort = true;
  setTimeout(() => server.listen(listenOptions), 25);
});
server.listen(listenOptions);

function shutdown(signal) {
  console.log(`${signal} received; finishing open requests before exiting.`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
