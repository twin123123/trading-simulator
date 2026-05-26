require('dotenv').config()

const crypto = require('crypto')
const express = require('express')
const cors = require('cors')
const { initDb, query, dbPath } = require('./db')

const app = express()

const PORT = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

function makeId() {
  return crypto.randomUUID()
}

function makeInternalId() {
  const randomId = Math.floor(100000 + Math.random() * 900000)

  return `TRD-${randomId}`
}

function mapUser(row) {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    username: row.username,
    internalId: row.internal_id,
    fullName: row.full_name,
    accountNumber: row.account_number,
    iban: row.iban,
    balance: Number(row.balance || 0),
    blockedAmount: Number(row.blocked_amount || 0),
    tradingStatus: row.trading_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function createUniqueInternalId() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const internalId = makeInternalId()

    const result = await query(
      'SELECT id FROM users WHERE internal_id = $1 LIMIT 1',
      [internalId],
    )

    if (result.rows.length === 0) {
      return internalId
    }
  }

  throw new Error('Failed to create unique internal ID')
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'trading-simulator-backend',
  })
})

app.get('/db/health', async (req, res, next) => {
  try {
    const result = await query("SELECT datetime('now') AS now")

    res.json({
      status: 'ok',
      database: 'connected',
      type: 'sqlite',
      path: dbPath,
      now: result.rows[0].now,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { fullName, accountNumber, iban, telegramId, username } = req.body

    if (!fullName || !accountNumber || !iban || !telegramId) {
      return res.status(400).json({
        error: 'fullName, accountNumber, iban and telegramId are required',
      })
    }

    const normalizedTelegramId = String(telegramId)
    const normalizedUsername = username ? String(username) : null

    const existingUserResult = await query(
      'SELECT * FROM users WHERE telegram_id = $1 LIMIT 1',
      [normalizedTelegramId],
    )

    if (existingUserResult.rows.length > 0) {
      return res.json({
        created: false,
        message: 'User already exists',
        user: mapUser(existingUserResult.rows[0]),
      })
    }

    const internalId = await createUniqueInternalId()

    const createdUserResult = await query(
      `
        INSERT INTO users (
          id,
          telegram_id,
          username,
          internal_id,
          full_name,
          account_number,
          iban
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        makeId(),
        normalizedTelegramId,
        normalizedUsername,
        internalId,
        fullName,
        accountNumber,
        iban,
      ],
    )

    res.status(201).json({
      created: true,
      message: 'User created',
      user: mapUser(createdUserResult.rows[0]),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/users', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT *
      FROM users
      ORDER BY created_at DESC
    `)

    res.json(result.rows.map(mapUser))
  } catch (error) {
    next(error)
  }
})

app.get('/api/users/by-telegram/:telegramId', async (req, res, next) => {
  try {
    const { telegramId } = req.params

    const result = await query(
      'SELECT * FROM users WHERE telegram_id = $1 LIMIT 1',
      [String(telegramId)],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found',
      })
    }

    res.json(mapUser(result.rows[0]))
  } catch (error) {
    next(error)
  }
})

app.use((error, req, res, next) => {
  console.error(error)

  res.status(500).json({
    error: 'Internal server error',
    details: error.message,
  })
})

async function startServer() {
  console.log('Initializing local SQLite database...')

  await initDb()

  console.log('Database tables are ready')
  console.log(`SQLite file: ${dbPath}`)

  app.listen(PORT, () => {
    console.log(`Backend started on http://localhost:${PORT}`)
  })
}

startServer().catch((error) => {
  console.error('Failed to start backend')
  console.error(error)
  process.exit(1)
})