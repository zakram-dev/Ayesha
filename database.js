const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const quoteSeed = require('./quotes.seed.json');

const databasePath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'ayesha.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    card_title TEXT,
    description TEXT,
    color TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    author TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    is_main_quote INTEGER NOT NULL DEFAULT 0 CHECK (is_main_quote IN (0, 1)),
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    quote_id INTEGER,
    category_id INTEGER,
    session_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (quote_id) REFERENCES quotes(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS visitor_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    private_section INTEGER NOT NULL DEFAULT 0 CHECK (private_section IN (0, 1)),
    reply TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('admin', 'private', 'voice')),
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS voice_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL CHECK (sender IN ('ayesha', 'zohaib')),
    kind TEXT NOT NULL CHECK (kind IN ('voice', 'text')),
    body TEXT,
    audio_file TEXT,
    audio_type TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT
  );
`);

// Older databases allow only admin/private sessions; rebuild the table (keeping sessions) so voice sessions fit.
const authSessionsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_sessions'").get().sql;
if (!authSessionsSql.includes("'voice'")) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE auth_sessions_new (
        token_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('admin', 'private', 'voice')),
        expires_at INTEGER NOT NULL
      );
      INSERT INTO auth_sessions_new (token_hash, kind, expires_at) SELECT token_hash, kind, expires_at FROM auth_sessions;
      DROP TABLE auth_sessions;
      ALTER TABLE auth_sessions_new RENAME TO auth_sessions;
    `);
  })();
}

const messageColumns = db.prepare('PRAGMA table_info(visitor_messages)').all();
if (!messageColumns.some(column => column.name === 'private_section')) {
  db.exec('ALTER TABLE visitor_messages ADD COLUMN private_section INTEGER NOT NULL DEFAULT 0 CHECK (private_section IN (0, 1))');
}
if (!messageColumns.some(column => column.name === 'reply')) {
  db.exec('ALTER TABLE visitor_messages ADD COLUMN reply TEXT');
}

const categoryColumns = db.prepare('PRAGMA table_info(categories)').all();
if (!categoryColumns.some(column => column.name === 'card_title')) {
  db.exec('ALTER TABLE categories ADD COLUMN card_title TEXT');
}

const quoteColumns = db.prepare('PRAGMA table_info(quotes)').all();
if (!quoteColumns.some(column => column.name === 'status')) {
  db.exec("ALTER TABLE quotes ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  db.prepare("UPDATE quotes SET status = CASE WHEN active = 1 THEN 'active' ELSE 'archived' END").run();
}

const seedCategories = db.prepare(`
  INSERT INTO categories (name, slug, card_title, description, color)
  VALUES (@name, @slug, @cardTitle, @description, @color)
  ON CONFLICT(slug) DO NOTHING
`);

const seedDefaultCategories = db.transaction(() => {
  [
    { name: 'Welcome', slug: 'welcome', cardTitle: 'A little welcome', description: 'A gentle note for any day.', color: 'peach' },
    { name: 'Sunny', slug: 'sunny', cardTitle: 'For a sunny moment', description: 'A tiny reminder to glow.', color: 'peach' },
    { name: 'Soft', slug: 'soft', cardTitle: 'For a soft moment', description: 'Something gentle for you.', color: 'pink' },
    { name: 'Brave', slug: 'brave', cardTitle: 'For a brave moment', description: 'For when you need a nudge.', color: 'lavender' },
    { name: 'Distraction', slug: 'distract', cardTitle: 'A lovely little detour', description: 'A small, lovely detour.', color: 'ink' }
  ].forEach(category => seedCategories.run(category));
});

seedDefaultCategories();

db.prepare(`
  UPDATE categories
  SET card_title = CASE slug
    WHEN 'welcome' THEN 'A little welcome'
    WHEN 'sunny' THEN 'For a sunny moment'
    WHEN 'soft' THEN 'For a soft moment'
    WHEN 'brave' THEN 'For a brave moment'
    WHEN 'distract' THEN 'A lovely little detour'
    ELSE 'A little ' || LOWER(name)
  END
  WHERE card_title IS NULL OR TRIM(card_title) = ''
`).run();

const seedQuotes = db.transaction(() => {
  const quoteCount = db.prepare('SELECT COUNT(*) AS count FROM quotes').get().count;
  if (quoteCount > 0) return;

  const categoryIds = new Map(
    db.prepare('SELECT id, slug FROM categories').all().map(category => [category.slug, category.id])
  );
  const insertQuote = db.prepare(`
    INSERT INTO quotes (text, category_id, is_main_quote, display_order)
    VALUES (@text, @categoryId, @isMainQuote, @displayOrder)
  `);

  quoteSeed.forEach((quote, index) => {
    const categoryId = categoryIds.get(quote.category);
    if (!categoryId) throw new Error(`Unknown quote category: ${quote.category}`);
    insertQuote.run({
      text: quote.text,
      categoryId,
      isMainQuote: index === 0 ? 1 : 0,
      displayOrder: index
    });
  });
});

seedQuotes();

db.prepare(`
  INSERT INTO settings (key, value)
  VALUES ('main_quote_enabled', '1'), ('main_quote_delay', '700'), ('main_quote_frequency', 'session'),
    ('main_quote_mode', 'rotate'), ('main_quote_pinned_until', '')
  ON CONFLICT(key) DO NOTHING
`).run();

// The sleepy bunny is on by default with a few things to say when tapped.
db.prepare(`
  INSERT INTO settings (key, value)
  VALUES ('bunny_enabled', '1'),
    ('bunny_lines', '["hi ayesha ♡","you''re doing great","boop!","have you had water today?","proud of you, always","you look lovely today"]')
  ON CONFLICT(key) DO NOTHING
`).run();

// The announcement bar starts switched off, with a suggested first message ready in admin.
db.prepare(`
  INSERT INTO settings (key, value)
  VALUES ('announcement_enabled', '0'), ('announcement_version', '0'),
    ('announcement_text', '✦ New: send me voice notes and little messages in our little mailbox.'),
    ('announcement_link_type', 'mailbox'), ('announcement_link_label', 'Open our mailbox'),
    ('announcement_link_url', ''), ('announcement_until', '')
  ON CONFLICT(key) DO NOTHING
`).run();

db.prepare(`
  INSERT INTO settings (key, value)
  SELECT 'main_quote_pool_category', CAST(id AS TEXT) FROM categories WHERE slug = 'welcome'
  ON CONFLICT(key) DO NOTHING
`).run();

// One-time move into "Our little mailbox": approved notes from the old "Love from kind people" corner,
// and Zohaib's replies to them, become mailbox messages with their original dates. Runs once.
const moveKindNotesToMailbox = db.transaction(() => {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'kind_notes_moved'").get()) return;
  const notes = db.prepare(`
    SELECT message, reply, created_at, reviewed_at FROM visitor_messages
    WHERE status = 'approved' AND private_section = 1
    ORDER BY created_at, id
  `).all();
  const addMessage = db.prepare("INSERT INTO voice_messages (sender, kind, body, created_at, read_at) VALUES (?, 'text', ?, ?, ?)");
  notes.forEach(note => {
    addMessage.run('ayesha', note.message, note.created_at, note.created_at);
    const repliedAt = note.reviewed_at || note.created_at;
    if (note.reply) addMessage.run('zohaib', note.reply, repliedAt, repliedAt);
  });
  db.prepare("INSERT INTO settings (key, value) VALUES ('kind_notes_moved', ?)").run(String(notes.length));
});

moveKindNotesToMailbox();

module.exports = db;
