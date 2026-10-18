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
`);

const seedCategories = db.prepare(`
  INSERT INTO categories (name, slug, description, color)
  VALUES (@name, @slug, @description, @color)
  ON CONFLICT(slug) DO NOTHING
`);

const seedDefaultCategories = db.transaction(() => {
  [
    { name: 'Welcome', slug: 'welcome', description: 'A gentle note for any day.', color: 'peach' },
    { name: 'Sunny', slug: 'sunny', description: 'A tiny reminder to glow.', color: 'peach' },
    { name: 'Soft', slug: 'soft', description: 'Something gentle for you.', color: 'pink' },
    { name: 'Brave', slug: 'brave', description: 'For when you need a nudge.', color: 'lavender' },
    { name: 'Distraction', slug: 'distract', description: 'A small, lovely detour.', color: 'ink' }
  ].forEach(category => seedCategories.run(category));
});

seedDefaultCategories();

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
  VALUES ('main_quote_enabled', '1'), ('main_quote_delay', '700'), ('main_quote_frequency', 'session')
  ON CONFLICT(key) DO NOTHING
`).run();

module.exports = db;
