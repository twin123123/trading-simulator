require('dotenv').config()

const crypto = require('crypto')
const express = require('express')
const cors = require('cors')
const { initDb, query, dbPath } = require('./database')
const adminRouter = require('./admin')

const {
  sendTradingStartedNotification,
  sendTradingCompletedReceipt,
} = require('./telegram')

const app = express()

const PORT = process.env.PORT || 4000

const FINAL_BALANCE = 20000

// Сейчас 60 секунд для теста.
// Потом поменяем на 60 * 60 * 1000, чтобы было 60 минут.
const SIMULATION_DURATION_MS = 60 * 1000

const MIN_FIRST_TRADE_DELAY_MS = 3000

const activeSimulationTimers = new Map()

app.use(cors())
app.use(express.json())
app.use('/api/admin', adminRouter)

function makeId() {
  return crypto.randomUUID()
}

function makeInternalId() {
  const randomId = Math.floor(100000 + Math.random() * 900000)

  return `TRD-${randomId}`
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function normalizeAmount(value) {
  if (typeof value === 'string') {
    return Number(value.replace(',', '.'))
  }

  return Number(value)
}

function createTrades() {
  const tradesCount = getRandomInt(12, 16)

  const weights = Array.from({ length: tradesCount }, () => Math.random() + 0.2)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)

  const amounts = weights.map((weight) =>
    Math.floor((weight / totalWeight) * FINAL_BALANCE),
  )

  const sumWithoutLastTrade = amounts
    .slice(0, -1)
    .reduce((sum, amount) => sum + amount, 0)

  amounts[tradesCount - 1] = FINAL_BALANCE - sumWithoutLastTrade

  const delays = Array.from({ length: tradesCount }, () =>
    Math.round(
      MIN_FIRST_TRADE_DELAY_MS +
        Math.random() * (SIMULATION_DURATION_MS - MIN_FIRST_TRADE_DELAY_MS),
    ),
  ).sort((a, b) => a - b)

  return amounts.map((amount, index) => ({
    index,
    amount,
    delay: delays[index],
  }))
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

function mapTransaction(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amount: Number(row.amount || 0),
    status: row.status,
    createdAt: row.created_at,
  }
}

function mapWithdrawalRequest(row) {
  return {
    id: row.id,
    userId: row.user_id,
    amount: Number(row.amount || 0),
    accountNumber: row.account_number,
    iban: row.iban,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapTradingSession(row) {
  let plannedTrades = []

  try {
    plannedTrades = JSON.parse(row.planned_trades || '[]')
  } catch {
    plannedTrades = []
  }

  return {
    id: row.id,
    userId: row.user_id,
    tradesCount: Number(row.trades_count || 0),
    plannedTrades,
    completedTrades: Number(row.completed_trades || 0),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
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

async function getUserByTelegramId(telegramId) {
  const result = await query(
    'SELECT * FROM users WHERE telegram_id = $1 LIMIT 1',
    [String(telegramId)],
  )

  if (result.rows.length === 0) {
    return null
  }

  return mapUser(result.rows[0])
}

async function getTransactionsByUserId(userId) {
  const result = await query(
    `
      SELECT *
      FROM transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId],
  )

  return result.rows.map(mapTransaction)
}

async function getWithdrawalRequestsByUserId(userId) {
  const result = await query(
    `
      SELECT *
      FROM withdrawal_requests
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId],
  )

  return result.rows.map(mapWithdrawalRequest)
}

async function getLatestTradingSession(userId) {
  const result = await query(
    `
      SELECT *
      FROM trading_sessions
      WHERE user_id = $1
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [userId],
  )

  if (result.rows.length === 0) {
    return null
  }

  return mapTradingSession(result.rows[0])
}

async function buildDashboardByTelegramId(telegramId) {
  const user = await getUserByTelegramId(telegramId)

  if (!user) {
    return null
  }

  const [transactions, tradingSession, withdrawalRequests] = await Promise.all([
    getTransactionsByUserId(user.id),
    getLatestTradingSession(user.id),
    getWithdrawalRequestsByUserId(user.id),
  ])

  return {
    user,
    transactions,
    tradingSession,
    withdrawalRequests,
  }
}

function clearSimulationTimers(sessionId) {
  const timers = activeSimulationTimers.get(sessionId)

  if (!timers) {
    return
  }

  timers.forEach((timer) => clearTimeout(timer))
  activeSimulationTimers.delete(sessionId)
}

function scheduleTradingSession({ userId, sessionId, trades }) {
  clearSimulationTimers(sessionId)

  const timers = trades.map((trade, index) =>
    setTimeout(async () => {
      try {
        await completeTrade({
          userId,
          sessionId,
          trade,
          tradeIndex: index,
          tradesCount: trades.length,
        })
      } catch (error) {
        console.error('Failed to complete trade')
        console.error(error)
      }
    }, trade.delay),
  )

  activeSimulationTimers.set(sessionId, timers)
}

async function completeTrade({ userId, sessionId, trade, tradeIndex, tradesCount }) {
  const sessionResult = await query(
    'SELECT * FROM trading_sessions WHERE id = $1 LIMIT 1',
    [sessionId],
  )

  if (sessionResult.rows.length === 0) {
    return
  }

  const session = sessionResult.rows[0]

  if (session.status !== 'active') {
    return
  }

  const completedTrades = Number(session.completed_trades || 0)

  if (completedTrades > tradeIndex) {
    return
  }

  const isLastTrade = tradeIndex === tradesCount - 1

  await query(
    `
      INSERT INTO transactions (
        id,
        user_id,
        type,
        amount,
        status
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      makeId(),
      userId,
      'начисление (сделка)',
      trade.amount,
      '🟢 выполнено',
    ],
  )

  if (isLastTrade) {
    await query(
      `
        UPDATE users
        SET
          balance = $1,
          trading_status = 'completed',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [FINAL_BALANCE, userId],
    )

    await query(
      `
        UPDATE trading_sessions
        SET
          completed_trades = $1,
          status = 'completed',
          finished_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [tradesCount, sessionId],
    )

    const completedUserResult = await query(
        'SELECT * FROM users WHERE id = $1 LIMIT 1',
        [userId],
    )

    if (completedUserResult.rows.length > 0) {
        const completedUser = mapUser(completedUserResult.rows[0])

        sendTradingCompletedReceipt(completedUser, FINAL_BALANCE).catch((error) => {
            console.error('Failed to send trading completed receipt')
            console.error(error)
        })
    }

    clearSimulationTimers(sessionId)
  } else {
    await query(
      `
        UPDATE users
        SET
          balance = balance + $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [trade.amount, userId],
    )

    await query(
      `
        UPDATE trading_sessions
        SET completed_trades = $1
        WHERE id = $2
      `,
      [tradeIndex + 1, sessionId],
    )
  }

  console.log(
    `Trade completed: ${tradeIndex + 1}/${tradesCount}, amount: ${trade.amount}`,
  )
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

    const user = await getUserByTelegramId(telegramId)

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
      })
    }

    res.json(user)
  } catch (error) {
    next(error)
  }
})

app.get('/api/users/by-telegram/:telegramId/dashboard', async (req, res, next) => {
  try {
    const dashboard = await buildDashboardByTelegramId(req.params.telegramId)

    if (!dashboard) {
      return res.status(404).json({
        error: 'User not found',
      })
    }

    res.json(dashboard)
  } catch (error) {
    next(error)
  }
})

app.get('/api/users/:userId/transactions', async (req, res, next) => {
  try {
    const transactions = await getTransactionsByUserId(req.params.userId)

    res.json(transactions)
  } catch (error) {
    next(error)
  }
})

app.get('/api/users/:userId/withdrawals', async (req, res, next) => {
  try {
    const withdrawalRequests = await getWithdrawalRequestsByUserId(
      req.params.userId,
    )

    res.json(withdrawalRequests)
  } catch (error) {
    next(error)
  }
})

app.get('/api/withdrawals', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        withdrawal_requests.*,
        users.internal_id AS user_internal_id,
        users.full_name AS user_full_name,
        users.telegram_id AS user_telegram_id,
        users.username AS user_username
      FROM withdrawal_requests
      JOIN users ON users.id = withdrawal_requests.user_id
      ORDER BY withdrawal_requests.created_at DESC
    `)

    res.json(
      result.rows.map((row) => ({
        ...mapWithdrawalRequest(row),
        user: {
          internalId: row.user_internal_id,
          fullName: row.user_full_name,
          telegramId: row.user_telegram_id,
          username: row.user_username,
        },
      })),
    )
  } catch (error) {
    next(error)
  }
})

app.post('/api/trading/start', async (req, res, next) => {
  try {
    const { telegramId } = req.body

    if (!telegramId) {
      return res.status(400).json({
        error: 'telegramId is required',
      })
    }

    const user = await getUserByTelegramId(telegramId)

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
      })
    }

    if (user.tradingStatus === 'active') {
      const dashboard = await buildDashboardByTelegramId(telegramId)

      return res.status(409).json({
        error: 'Trading simulation is already active',
        dashboard,
      })
    }

    if (user.tradingStatus === 'completed') {
      const dashboard = await buildDashboardByTelegramId(telegramId)

      return res.status(409).json({
        error: 'Trading simulation already completed',
        dashboard,
      })
    }

    const trades = createTrades()
    const sessionId = makeId()

    await query(
      `
        INSERT INTO trading_sessions (
          id,
          user_id,
          trades_count,
          planned_trades,
          completed_trades,
          status
        )
        VALUES ($1, $2, $3, $4, 0, 'active')
      `,
      [sessionId, user.id, trades.length, JSON.stringify(trades)],
    )

    await query(
      `
        UPDATE users
        SET
          balance = 0,
          blocked_amount = 0,
          trading_status = 'active',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [user.id],
    )

    scheduleTradingSession({
      userId: user.id,
      sessionId,
      trades,
    })

    sendTradingStartedNotification(user).catch((error) => {
        console.error('Failed to send trading started notification')
        console.error(error)
    })

    const dashboard = await buildDashboardByTelegramId(telegramId)

    res.status(201).json({
      message: 'Trading simulation started',
      dashboard,
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/withdrawals', async (req, res, next) => {
  try {
    const { telegramId, amount } = req.body

    if (!telegramId) {
      return res.status(400).json({
        error: 'telegramId is required',
      })
    }

    const normalizedAmount = normalizeAmount(amount)

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      return res.status(400).json({
        error: 'Correct withdrawal amount is required',
      })
    }

    const user = await getUserByTelegramId(telegramId)

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
      })
    }

    if (user.tradingStatus === 'active') {
      return res.status(409).json({
        error: 'Withdrawal is available only after trading simulation is completed',
      })
    }

    if (normalizedAmount > user.balance) {
      return res.status(400).json({
        error: 'Withdrawal amount is greater than available balance',
      })
    }

    const withdrawalId = makeId()

    const createdWithdrawalResult = await query(
      `
        INSERT INTO withdrawal_requests (
          id,
          user_id,
          amount,
          account_number,
          iban,
          status
        )
        VALUES ($1, $2, $3, $4, $5, 'in_process')
        RETURNING *
      `,
      [
        withdrawalId,
        user.id,
        normalizedAmount,
        user.accountNumber,
        user.iban,
      ],
    )

    await query(
      `
        INSERT INTO transactions (
          id,
          user_id,
          type,
          amount,
          status
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        makeId(),
        user.id,
        'заявка на вывод',
        -normalizedAmount,
        '🟡 в процессе',
      ],
    )

    await query(
      `
        UPDATE users
        SET
          balance = balance - $1,
          blocked_amount = blocked_amount + $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [normalizedAmount, user.id],
    )

    const dashboard = await buildDashboardByTelegramId(telegramId)

    res.status(201).json({
      message: 'Withdrawal request created',
      withdrawalRequest: mapWithdrawalRequest(createdWithdrawalResult.rows[0]),
      dashboard,
    })
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