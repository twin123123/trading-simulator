const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const dataDir = path.join(__dirname, 'data')

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'database.sqlite')

const database = new DatabaseSync(dbPath, {
  enableForeignKeyConstraints: true,
})

database.exec('PRAGMA foreign_keys = ON;')

function convertPostgresQueryToSqlite(text, params = []) {
  const values = []

  const sql = text.trim().replace(/\$(\d+)/g, (_, indexText) => {
    const paramIndex = Number(indexText) - 1

    values.push(params[paramIndex])

    return '?'
  })

  return {
    sql,
    values,
  }
}

async function query(text, params = []) {
  const startedAt = Date.now()

  try {
    const { sql, values } = convertPostgresQueryToSqlite(text, params)

    const isReadQuery = /^\s*(SELECT|WITH|PRAGMA)/i.test(sql)
    const hasReturning = /\bRETURNING\b/i.test(sql)

    if (!isReadQuery && !hasReturning && values.length === 0 && sql.includes(';')) {
      database.exec(sql)

      console.log(`DB query ok: ${Date.now() - startedAt}ms`)

      return {
        rows: [],
      }
    }

    const statement = database.prepare(sql)

    if (isReadQuery || hasReturning) {
      const rows = values.length > 0 ? statement.all(...values) : statement.all()

      console.log(`DB query ok: ${Date.now() - startedAt}ms`)

      return {
        rows,
      }
    }

    const result = values.length > 0 ? statement.run(...values) : statement.run()

    console.log(`DB query ok: ${Date.now() - startedAt}ms`)

    return {
      rows: [],
      rowCount: Number(result.changes),
    }
  } catch (error) {
    console.error(`DB query failed after ${Date.now() - startedAt}ms`)
    throw error
  }
}

async function initDb() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      username TEXT,
      internal_id TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      iban TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      blocked_amount REAL NOT NULL DEFAULT 0,
      trading_status TEXT NOT NULL DEFAULT 'not_started',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      account_number TEXT NOT NULL,
      iban TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_process',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trading_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trades_count INTEGER NOT NULL,
      planned_trades TEXT NOT NULL DEFAULT '[]',
      completed_trades INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
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
  dbPath,
}