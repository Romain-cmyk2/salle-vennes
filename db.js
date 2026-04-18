const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || 'file:data.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

const db = createClient({ url, ...(authToken ? { authToken } : {}) });

async function init() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      start_iso TEXT NOT NULL,
      end_iso TEXT NOT NULL,
      guests TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_bookings_time ON bookings(start_iso, end_iso)`);
}

module.exports = { db, init };
