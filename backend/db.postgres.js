const { Pool } = require('pg')

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing')
}

const isLocalDatabase =
  databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  query_timeout: 60000,
  statement_timeout: 60000,
  idleTimeoutMillis: 30000,
})

async function query(text, params = []) {
  const startedAt = Date.now()

  try {
    const result = await pool.query(text, params)
    console.log(`Postgres query ok: ${Date.now() - startedAt}ms`)
    return result
  } catch (error) {
    console.error(`Postgres query failed after ${Date.now() - startedAt}ms`)
    throw error
  }
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      username TEXT,
      internal_id TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      iban TEXT NOT NULL,
      balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
      blocked_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
      trading_status TEXT NOT NULL DEFAULT 'not_started',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount NUMERIC(14, 2) NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(14, 2) NOT NULL,
      account_number TEXT NOT NULL,
      iban TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_process',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trading_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trades_count INTEGER NOT NULL,
      planned_trades TEXT NOT NULL DEFAULT '[]',
      completed_trades INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user_id
      ON transactions(user_id);

    CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_id
      ON withdrawal_requests(user_id);

    CREATE INDEX IF NOT EXISTS idx_trading_sessions_user_id
      ON trading_sessions(user_id);
  `)
}

module.exports = {
  query,
  initDb,
  dbPath: 'postgres',
}