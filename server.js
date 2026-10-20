require('dotenv').config();

const crypto = require('node:crypto');
const express = require('express');
const db = require('./database');

const app = express();
const port = Number(process.env.PORT) || 8080;
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const sessions = new Map();
const messageSubmissionTimes = new Map();
const privateAccessSessions = new Map();
const privateUnlockAttempts = new Map();

if (!adminPassword || !sessionSecret) {
  throw new Error('ADMIN_PASSWORD and SESSION_SECRET must be configured before starting the server.');
}

app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  const blockedPath = /^\/(?:data|node_modules)(?:\/|$)/.test(req.path)
    || /^\/(?:server|database|package(?:-lock)?)\.(?:js|json)$/.test(req.path);

  if (blockedPath) return res.sendStatus(404);
  next();
});
app.use(express.static(__dirname));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
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

app.get('/api/categories', (req, res) => {
  const categories = db.prepare(`
    SELECT id, name, slug,
      COALESCE(NULLIF(TRIM(card_title), ''), 'A little ' || LOWER(name)) AS card_title,
      description, color
    FROM categories
    WHERE active = 1
    ORDER BY id
  `).all();

  res.json(categories);
});

app.get('/api/messages', (req, res) => {
  res.json(db.prepare(`
    SELECT id, name, message, created_at
    FROM visitor_messages
    WHERE status = 'approved' AND private_section = 0
    ORDER BY created_at DESC, id DESC
    LIMIT 12
  `).all());
});

function hashPrivatePassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPrivatePassword(password, storedHash) {
  const [salt, expectedHex] = String(storedHash || '').split(':');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function privatePasswordHash() {
  return db.prepare("SELECT value FROM settings WHERE key = 'private_section_password_hash'").get()?.value || '';
}

function hasPrivateAccess(req) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)ayesha_private=([^;]+)/)?.[1];
  const expiresAt = token && privateAccessSessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) privateAccessSessions.delete(token);
    return false;
  }
  return true;
}

app.post('/api/private-section/unlock', (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ip = req.get('CF-Connecting-IP') || req.ip || 'unknown';
  const now = Date.now();
  const attempt = privateUnlockAttempts.get(ip) || { count: 0, startedAt: now };
  if (now - attempt.startedAt >= 60 * 1000) {
    attempt.count = 0;
    attempt.startedAt = now;
  }
  if (attempt.count >= 5) return res.status(429).json({ error: 'Too many attempts. Please try again in a minute.' });
  attempt.count += 1;
  privateUnlockAttempts.set(ip, attempt);
  if (!verifyPrivatePassword(password, privatePasswordHash())) {
    return res.status(401).json({ error: 'That password is not correct.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  privateAccessSessions.set(token, now + 30 * 60 * 1000);
  res.setHeader('Set-Cookie', `ayesha_private=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800`);
  res.json({ ok: true });
});

app.get('/api/private-section/messages', (req, res) => {
  if (!hasPrivateAccess(req)) return res.status(401).json({ error: 'Private section access is required.' });
  res.json(db.prepare(`
    SELECT id, name, message, reply, created_at
    FROM visitor_messages
    WHERE status = 'approved' AND private_section = 1
    ORDER BY created_at DESC, id DESC
    LIMIT 50
  `).all());
});

app.post('/api/messages', (req, res) => {
  const honeypot = typeof req.body?.website === 'string' ? req.body.website.trim() : '';
  if (honeypot) return res.status(204).end();

  const forwardedIp = req.get('CF-Connecting-IP') || req.ip || 'unknown';
  const now = Date.now();
  const lastSubmission = messageSubmissionTimes.get(forwardedIp) || 0;
  if (now - lastSubmission < 60 * 1000) {
    return res.status(429).json({ error: 'Please wait a minute before sending another note.' });
  }

  try {
    const message = cleanText(req.body?.message, 'Message', { maxLength: 500 });
    const name = cleanText(req.body?.name ?? '', 'Name', { maxLength: 80 });
    db.prepare('INSERT INTO visitor_messages (name, message) VALUES (?, ?)').run(name, message);
    messageSubmissionTimes.set(forwardedIp, now);
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
  return token;
}

function requireAdmin(req, res, next) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)ayesha_admin=([^;]+)/)?.[1];
  const expiresAt = token && sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) sessions.delete(token);
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

app.post('/api/admin/login', (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeCompare(password, adminPassword)) return res.status(401).json({ error: 'Invalid password.' });

  const token = createSession();
  res.setHeader('Set-Cookie', `ayesha_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = req.headers.cookie?.match(/(?:^|;\s*)ayesha_admin=([^;]+)/)?.[1];
  sessions.delete(token);
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
    mainQuote: db.prepare('SELECT id FROM quotes WHERE is_main_quote = 1 AND active = 1 LIMIT 1').get() || null
  });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const settings = db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)').all(
    'main_quote_enabled', 'main_quote_delay', 'main_quote_frequency'
  ).reduce((result, setting) => ({ ...result, [setting.key]: setting.value }), {});
  res.json({
    enabled: settings.main_quote_enabled === '1',
    delay: Math.max(0, Math.min(60000, Number(settings.main_quote_delay) || 700)),
    frequency: ['session', 'day', 'always'].includes(settings.main_quote_frequency) ? settings.main_quote_frequency : 'session',
    privatePasswordConfigured: Boolean(privatePasswordHash())
  });

});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const delay = Number(req.body?.delay);
  const frequency = req.body?.frequency;
  if (!Number.isInteger(delay) || delay < 0 || delay > 60000) {
    return res.status(400).json({ error: 'Popup delay must be a whole number from 0 to 60000 milliseconds.' });
  }
  if (!['session', 'day', 'always'].includes(frequency)) {
    return res.status(400).json({ error: 'Popup frequency is invalid.' });
  }
  const save = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  const update = db.transaction(() => {
    save.run('main_quote_enabled', req.body?.enabled ? '1' : '0');
    save.run('main_quote_delay', String(delay));
    save.run('main_quote_frequency', frequency);
  });

  update();
  res.json({ ok: true });
});

app.put('/api/admin/private-section/password', requireAdmin, (req, res) => {
  try {
    const password = cleanText(req.body?.password, 'Private section password', { maxLength: 200 });
    if (password.length < 4) throw new Error('Private section password must be at least 4 characters.');
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run('private_section_password_hash', hashPrivatePassword(password));
    privateAccessSessions.clear();
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/messages', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT id, name, message, status, private_section, reply, created_at, reviewed_at
    FROM visitor_messages
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC, id DESC
  `).all());
});

app.put('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const status = req.body?.status;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Message status is invalid.' });
  }
  const privateSection = req.body?.privateSection === undefined ? null : (req.body.privateSection ? 1 : 0);
  const replyProvided = req.body?.reply !== undefined;
  let reply = null;
  if (replyProvided) {
    try {
      reply = cleanText(req.body.reply, 'Reply', { required: false, maxLength: 500 });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }
  const result = db.prepare(`
    UPDATE visitor_messages
    SET status = ?,
      private_section = COALESCE(?, private_section),
    reply = CASE WHEN ? = 1 THEN ? ELSE reply END,
      reviewed_at = CASE WHEN ? = 'pending' THEN NULL ELSE CURRENT_TIMESTAMP END
    WHERE id = ?
  `).run(status, privateSection, replyProvided ? 1 : 0, reply, status, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
});

app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM visitor_messages WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Message not found.' });
  res.status(204).end();
});

app.get('/api/admin/categories', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT c.id, c.name, c.slug,
      COALESCE(NULLIF(TRIM(c.card_title), ''), 'A little ' || LOWER(c.name)) AS card_title,
      c.description, c.color, c.active,
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
      INSERT INTO categories (name, slug, card_title, description, color)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, slug, cardTitle, cleanText(req.body?.description, 'Description', { required: false, maxLength: 300 }), cleanText(req.body?.color, 'Color', { required: false, maxLength: 40 }));
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
      SET name = ?, slug = ?, card_title = ?, description = ?, color = ?, active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, slug, cardTitle, description, color, parseBoolean(req.body?.active, true) ? 1 : 0, id);
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
      q.category_id, c.name AS category_name, c.slug AS category_slug
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
    const addQuote = db.transaction(() => {
      if (parseBoolean(req.body?.isMainQuote)) db.prepare('UPDATE quotes SET is_main_quote = 0').run();
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
    const updateQuote = db.transaction(() => {
      if (parseBoolean(req.body?.isMainQuote)) db.prepare('UPDATE quotes SET is_main_quote = 0').run();
      return db.prepare(`
        UPDATE quotes
        SET text = ?, category_id = ?, author = ?, active = ?, status = ?, is_main_quote = ?, display_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(text, categoryId, cleanText(req.body?.author, 'Author', { required: false, maxLength: 120 }), status === 'active' ? 1 : 0, status, parseBoolean(req.body?.isMainQuote) ? 1 : 0, Number(req.body?.displayOrder) || 0, id);
    });
    if (!updateQuote().changes) return res.status(404).json({ error: 'Quote not found.' });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/admin/quotes/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM quotes WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Quote not found.' });
  res.status(204).end();
});

app.get('/api/quotes/random', (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : 'welcome';
  const excludedIds = typeof req.query.exclude === 'string'
    ? [...new Set(req.query.exclude.split(',').map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 10)
    : [];
  const exclusionClause = excludedIds.length ? `AND q.id NOT IN (${excludedIds.map(() => '?').join(',')})` : '';
  const quote = db.prepare(`
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
    category: { id: fallback.category_id, name: fallback.category_name, slug: fallback.category_slug }
  });
});

app.get('/api/quotes/main', (req, res) => {
  const settings = db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)').all(
    'main_quote_enabled', 'main_quote_delay', 'main_quote_frequency'
  ).reduce((result, setting) => ({ ...result, [setting.key]: setting.value }), {});
  if (settings.main_quote_enabled !== '1') return res.status(404).json({ error: 'Main quote popup is disabled.' });
  const quote = db.prepare(`
    SELECT q.id, q.text, q.author, c.id AS category_id, c.name AS category_name, c.slug AS category_slug
    FROM quotes q
    JOIN categories c ON c.id = q.category_id
    WHERE q.active = 1 AND q.status = 'active' AND q.is_main_quote = 1 AND c.active = 1
    ORDER BY q.updated_at DESC, q.id DESC
    LIMIT 1
  `).get();

  if (!quote) return res.status(404).json({ error: 'No main quote is configured.' });
  res.json({
    id: quote.id,
    text: quote.text,
    author: quote.author,
    category: { id: quote.category_id, name: quote.category_name, slug: quote.category_slug },
    popup: {
      delay: Math.max(0, Math.min(60000, Number(settings.main_quote_delay) || 700)),
      frequency: ['session', 'day', 'always'].includes(settings.main_quote_frequency) ? settings.main_quote_frequency : 'session'
    }
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Ayesha gift server running at http://localhost:${port}`);
});
