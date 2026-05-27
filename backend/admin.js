const express = require('express')
const crypto = require('crypto')
const { query } = require('./db')

const router = express.Router()

function makeId() {
  return crypto.randomUUID()
}

function normalizeAmount(value) {
  if (typeof value === 'string') {
    return Number(value.replace(',', '.'))
  }

  return Number(value)
}

function getHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}

function requireAdmin(req, res, next) {
  const expectedPassword = process.env.ADMIN_PASSWORD
  const providedPassword = getHeaderValue(req.headers['x-admin-password'])

  if (!expectedPassword) {
    return res.status(500).json({
      error: 'ADMIN_PASSWORD is missing in backend/.env',
    })
  }

  if (!providedPassword || providedPassword !== expectedPassword) {
    return res.status(401).json({
      error: 'Unauthorized admin request',
    })
  }

  next()
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

function mapAdminWithdrawal(row) {
  return {
    ...mapWithdrawalRequest(row),
    user: {
      internalId: row.user_internal_id,
      fullName: row.user_full_name,
      telegramId: row.user_telegram_id,
      username: row.user_username,
    },
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

async function getUserRawById(userId) {
  const result = await query(
    `
      SELECT *
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  )

  if (result.rows.length === 0) {
    return null
  }

  return result.rows[0]
}

async function getAdminUserProfile(userId) {
  const userRow = await getUserRawById(userId)

  if (!userRow) {
    return null
  }

  const [transactionsResult, withdrawalsResult, sessionsResult] =
    await Promise.all([
      query(
        `
          SELECT *
          FROM transactions
          WHERE user_id = $1
          ORDER BY created_at DESC
        `,
        [userId],
      ),
      query(
        `
          SELECT *
          FROM withdrawal_requests
          WHERE user_id = $1
          ORDER BY created_at DESC
        `,
        [userId],
      ),
      query(
        `
          SELECT *
          FROM trading_sessions
          WHERE user_id = $1
          ORDER BY started_at DESC
        `,
        [userId],
      ),
    ])

  return {
    user: mapUser(userRow),
    transactions: transactionsResult.rows.map(mapTransaction),
    withdrawalRequests: withdrawalsResult.rows.map(mapWithdrawalRequest),
    tradingSessions: sessionsResult.rows.map(mapTradingSession),
  }
}

async function getWithdrawalRawById(withdrawalId) {
  const result = await query(
    `
      SELECT *
      FROM withdrawal_requests
      WHERE id = $1
      LIMIT 1
    `,
    [withdrawalId],
  )

  if (result.rows.length === 0) {
    return null
  }

  return result.rows[0]
}

router.use(requireAdmin)

router.get('/users', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim()

    if (search) {
      const pattern = `%${search}%`

      const result = await query(
        `
          SELECT *
          FROM users
          WHERE
            internal_id LIKE $1 OR
            full_name LIKE $1 OR
            telegram_id LIKE $1 OR
            username LIKE $1
          ORDER BY created_at DESC
        `,
        [pattern],
      )

      return res.json(result.rows.map(mapUser))
    }

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

router.get('/users/:userId', async (req, res, next) => {
  try {
    const profile = await getAdminUserProfile(req.params.userId)

    if (!profile) {
      return res.status(404).json({
        error: 'User not found',
      })
    }

    res.json(profile)
  } catch (error) {
    next(error)
  }
})

router.patch('/users/:userId/balance', async (req, res, next) => {
  try {
    const { operation = 'add', amount } = req.body

    const normalizedAmount = normalizeAmount(amount)

    if (!Number.isFinite(normalizedAmount)) {
      return res.status(400).json({
        error: 'Correct amount is required',
      })
    }

    if (!['add', 'set'].includes(operation)) {
      return res.status(400).json({
        error: 'operation must be add or set',
      })
    }

    const userRow = await getUserRawById(req.params.userId)

    if (!userRow) {
      return res.status(404).json({
        error: 'User not found',
      })
    }

    const currentBalance = Number(userRow.balance || 0)

    const nextBalance =
      operation === 'set'
        ? normalizedAmount
        : currentBalance + normalizedAmount

    if (nextBalance < 0) {
      return res.status(400).json({
        error: 'Balance cannot be negative',
      })
    }

    const transactionAmount =
      operation === 'set'
        ? nextBalance - currentBalance
        : normalizedAmount

    await query(
      `
        UPDATE users
        SET
          balance = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [nextBalance, req.params.userId],
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
        req.params.userId,
        'изменение баланса админом',
        transactionAmount,
        '🟢 выполнено',
      ],
    )

    const profile = await getAdminUserProfile(req.params.userId)

    res.json({
      message: 'Balance updated',
      profile,
    })
  } catch (error) {
    next(error)
  }
})

router.get('/withdrawals', async (req, res, next) => {
  try {
    const status = String(req.query.status || '').trim()

    if (status) {
      const result = await query(
        `
          SELECT
            withdrawal_requests.*,
            users.internal_id AS user_internal_id,
            users.full_name AS user_full_name,
            users.telegram_id AS user_telegram_id,
            users.username AS user_username
          FROM withdrawal_requests
          JOIN users ON users.id = withdrawal_requests.user_id
          WHERE withdrawal_requests.status = $1
          ORDER BY withdrawal_requests.created_at DESC
        `,
        [status],
      )

      return res.json(result.rows.map(mapAdminWithdrawal))
    }

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

    res.json(result.rows.map(mapAdminWithdrawal))
  } catch (error) {
    next(error)
  }
})

router.post('/withdrawals/:withdrawalId/approve', async (req, res, next) => {
  try {
    const withdrawal = await getWithdrawalRawById(req.params.withdrawalId)

    if (!withdrawal) {
      return res.status(404).json({
        error: 'Withdrawal request not found',
      })
    }

    if (withdrawal.status !== 'in_process') {
      return res.status(409).json({
        error: 'Withdrawal request is not in process',
      })
    }

    const amount = Number(withdrawal.amount || 0)

    await query(
      `
        UPDATE withdrawal_requests
        SET
          status = 'completed',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [withdrawal.id],
    )

    await query(
      `
        UPDATE users
        SET
          blocked_amount =
            CASE
              WHEN blocked_amount - $1 < 0 THEN 0
              ELSE blocked_amount - $1
            END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [amount, withdrawal.user_id],
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
        withdrawal.user_id,
        'успешный вывод',
        -amount,
        '🟢 выполнено',
      ],
    )

    const profile = await getAdminUserProfile(withdrawal.user_id)

    res.json({
      message: 'Withdrawal request approved',
      profile,
    })
  } catch (error) {
    next(error)
  }
})

router.post('/withdrawals/:withdrawalId/reject', async (req, res, next) => {
  try {
    const withdrawal = await getWithdrawalRawById(req.params.withdrawalId)

    if (!withdrawal) {
      return res.status(404).json({
        error: 'Withdrawal request not found',
      })
    }

    if (withdrawal.status !== 'in_process') {
      return res.status(409).json({
        error: 'Withdrawal request is not in process',
      })
    }

    const amount = Number(withdrawal.amount || 0)

    await query(
      `
        UPDATE withdrawal_requests
        SET
          status = 'rejected',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [withdrawal.id],
    )

    await query(
      `
        UPDATE users
        SET
          balance = balance + $1,
          blocked_amount =
            CASE
              WHEN blocked_amount - $1 < 0 THEN 0
              ELSE blocked_amount - $1
            END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [amount, withdrawal.user_id],
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
        withdrawal.user_id,
        'отклоненный вывод',
        amount,
        '🔴 отклонено',
      ],
    )

    const profile = await getAdminUserProfile(withdrawal.user_id)

    res.json({
      message: 'Withdrawal request rejected',
      profile,
    })
  } catch (error) {
    next(error)
  }
})

module.exports = router