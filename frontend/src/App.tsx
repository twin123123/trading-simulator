import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import './App.css'
import AdminPanel from './AdminPanel'

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready?: () => void
        expand?: () => void
        initDataUnsafe?: {
          user?: {
            id?: number
            username?: string
            first_name?: string
            last_name?: string
          }
        }
      }
    }
  }
}

type User = {
  id: string
  telegramId: string
  username: string | null
  internalId: string
  fullName: string
  accountNumber: string
  iban: string
  balance: number
  blockedAmount: number
  tradingStatus: string
  createdAt: string
  updatedAt: string
}

type Transaction = {
  id: string
  userId: string
  type: string
  amount: number
  status: string
  createdAt: string
}

type TradingSession = {
  id: string
  userId: string
  tradesCount: number
  plannedTrades: {
    index: number
    amount: number
    delay: number
  }[]
  completedTrades: number
  startedAt: string
  finishedAt: string | null
  status: string
}

type WithdrawalRequest = {
  id: string
  userId: string
  amount: number
  accountNumber: string
  iban: string
  status: string
  createdAt: string
  updatedAt: string
}

type DashboardResponse = {
  user: User
  transactions: Transaction[]
  tradingSession: TradingSession | null
  withdrawalRequests: WithdrawalRequest[]
}

type RegisterResponse = {
  created: boolean
  message: string
  user: User
}

type TradingStartResponse = {
  message: string
  dashboard: DashboardResponse
}

type WithdrawalCreateResponse = {
  message: string
  withdrawalRequest: WithdrawalRequest
  dashboard: DashboardResponse
}

type WalletScreen = 'wallet' | 'withdraw'

type TelegramProfile = {
  telegramId: string
  username: string | null
}

const API_BASE_URL = 'https://trading-simulator-backend-gad1.onrender.com'

const MANAGER_LINK = 'https://t.me/username'

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function getTelegramProfile(): TelegramProfile {
  const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user

  if (telegramUser?.id) {
    return {
      telegramId: String(telegramUser.id),
      username: telegramUser.username || null,
    }
  }

  let demoTelegramId = localStorage.getItem('demoTelegramId')

  if (!demoTelegramId) {
    demoTelegramId = `demo-${Math.floor(100000 + Math.random() * 900000)}`
    localStorage.setItem('demoTelegramId', demoTelegramId)
  }

  return {
    telegramId: demoTelegramId,
    username: 'local_demo_user',
  }
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message = data?.error || data?.details || 'API request failed'
    throw new ApiError(response.status, message)
  }

  return data as T
}

function formatAmount(value: number) {
  return value.toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
  })
}

function formatDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('ru-RU')
}

function WalletApp() {
  const [telegramProfile] = useState<TelegramProfile>(() => getTelegramProfile())

  const [user, setUser] = useState<User | null>(null)

  const [form, setForm] = useState({
    fullName: '',
    accountNumber: '',
    iban: '',
  })

  const [screen, setScreen] = useState<WalletScreen>('wallet')

  const [balance, setBalance] = useState(0)
  const [blockedAmount, setBlockedAmount] = useState(0)
  const [withdrawAmount, setWithdrawAmount] = useState('')

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [tradingSession, setTradingSession] = useState<TradingSession | null>(
    null,
  )

  const [showHistory, setShowHistory] = useState(false)
  const [notice, setNotice] = useState('')
  const [backendError, setBackendError] = useState('')

  const [isLoadingUser, setIsLoadingUser] = useState(true)
  const [isRegistering, setIsRegistering] = useState(false)
  const [isStartingTrading, setIsStartingTrading] = useState(false)
  const [isCreatingWithdrawal, setIsCreatingWithdrawal] = useState(false)

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.()
    window.Telegram?.WebApp?.expand?.()
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadExistingUser() {
      try {
        setIsLoadingUser(true)
        setBackendError('')

        const dashboard = await apiRequest<DashboardResponse>(
          `/api/users/by-telegram/${telegramProfile.telegramId}/dashboard`,
        )

        if (!isMounted) {
          return
        }

        applyDashboard(dashboard)
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return
        }

        const message =
          error instanceof Error ? error.message : 'Неизвестная ошибка'

        setBackendError(
          `Backend недоступен или вернул ошибку: ${message}. Проверь, что backend запущен на localhost:4000.`,
        )
      } finally {
        if (isMounted) {
          setIsLoadingUser(false)
        }
      }
    }

    loadExistingUser()

    return () => {
      isMounted = false
    }
  }, [telegramProfile.telegramId])

  useEffect(() => {
    if (!user || user.tradingStatus !== 'active') {
      return
    }

    const timer = window.setInterval(async () => {
      try {
        await loadDashboardFromBackend()
      } catch (error) {
        console.error(error)
      }
    }, 3000)

    return () => {
      window.clearInterval(timer)
    }
  }, [user?.tradingStatus, telegramProfile.telegramId])

  function showNotice(text: string) {
    setNotice(text)

    window.setTimeout(() => {
      setNotice('')
    }, 3500)
  }

  function applyDashboard(dashboard: DashboardResponse) {
    setUser(dashboard.user)
    setBalance(dashboard.user.balance)
    setBlockedAmount(dashboard.user.blockedAmount)
    setTransactions(dashboard.transactions)
    setTradingSession(dashboard.tradingSession)
  }

  async function loadDashboardFromBackend() {
    const dashboard = await apiRequest<DashboardResponse>(
      `/api/users/by-telegram/${telegramProfile.telegramId}/dashboard`,
    )

    applyDashboard(dashboard)

    return dashboard
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target

    setForm({
      ...form,
      [name]: value,
    })
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      setIsRegistering(true)
      setBackendError('')

      const response = await apiRequest<RegisterResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName: form.fullName,
          accountNumber: form.accountNumber,
          iban: form.iban,
          telegramId: telegramProfile.telegramId,
          username: telegramProfile.username,
        }),
      })

      setUser(response.user)
      setBalance(response.user.balance)
      setBlockedAmount(response.user.blockedAmount)
      setTransactions([])
      setTradingSession(null)

      showNotice(
        response.created
          ? 'Демо-аккаунт создан и сохранен в БД'
          : 'Аккаунт уже существует, данные загружены из БД',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка'

      setBackendError(`Не удалось зарегистрироваться: ${message}`)
    } finally {
      setIsRegistering(false)
    }
  }

  async function startTradingSimulation() {
    try {
      setIsStartingTrading(true)
      setBackendError('')

      const response = await apiRequest<TradingStartResponse>(
        '/api/trading/start',
        {
          method: 'POST',
          body: JSON.stringify({
            telegramId: telegramProfile.telegramId,
          }),
        },
      )

      applyDashboard(response.dashboard)
      setShowHistory(true)
      showNotice('Симуляция торговли запущена')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка'

      showNotice(`Не удалось запустить торговлю: ${message}`)

      try {
        await loadDashboardFromBackend()
      } catch {
        // Игнорируем дополнительную ошибку обновления.
      }
    } finally {
      setIsStartingTrading(false)
    }
  }

  function openWithdrawScreen() {
    if (user?.tradingStatus === 'active') {
      showNotice('Вывод доступен после завершения симуляции')
      return
    }

    if (balance <= 0) {
      showNotice('На балансе пока нет средств для демо-заявки')
      return
    }

    setWithdrawAmount('')
    setScreen('withdraw')
  }

  async function handleCreateWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedAmount = withdrawAmount.replace(',', '.')
    const amount = Number(normalizedAmount)

    if (!Number.isFinite(amount) || amount <= 0) {
      showNotice('Введите корректную сумму')
      return
    }

    if (amount > balance) {
      showNotice('Сумма вывода больше доступного баланса')
      return
    }

    try {
      setIsCreatingWithdrawal(true)
      setBackendError('')

      const response = await apiRequest<WithdrawalCreateResponse>(
        '/api/withdrawals',
        {
          method: 'POST',
          body: JSON.stringify({
            telegramId: telegramProfile.telegramId,
            amount,
          }),
        },
      )

      applyDashboard(response.dashboard)

      setWithdrawAmount('')
      setScreen('wallet')
      setShowHistory(true)

      showNotice('Заявка на вывод создана и сохранена в БД')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка'

      showNotice(`Не удалось создать заявку: ${message}`)

      try {
        await loadDashboardFromBackend()
      } catch {
        // Игнорируем дополнительную ошибку обновления.
      }
    } finally {
      setIsCreatingWithdrawal(false)
    }
  }

  if (isLoadingUser) {
    return (
      <main className="app">
        <section className="auth-card">
          <div className="brand-row">
            <div className="brand-logo">T</div>
            <div>
              <strong>Trading Wallet</strong>
              <span>Demo Mini App</span>
            </div>
          </div>

          <h1>Загрузка аккаунта</h1>

          <p className="auth-description">
            Проверяем, есть ли пользователь в локальной БД.
          </p>
        </section>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="app">
        <section className="auth-card">
          <div className="brand-row">
            <div className="brand-logo">T</div>
            <div>
              <strong>Trading Wallet</strong>
              <span>Demo Mini App</span>
            </div>
          </div>

          <h1>Создать демо-кошелек</h1>

          <p className="auth-description">
            Виртуальный торговый счет для симуляции. Баланс и операции не
            являются реальными деньгами.
          </p>

          {backendError && <div className="notice">{backendError}</div>}

          <form className="auth-form" onSubmit={handleRegister}>
            <label>
              ФИО
              <input
                name="fullName"
                value={form.fullName}
                onChange={handleChange}
                placeholder="Иван Иванов"
                required
              />
            </label>

            <label>
              Номер счета
              <input
                name="accountNumber"
                value={form.accountNumber}
                onChange={handleChange}
                placeholder="1234567890"
                required
              />
            </label>

            <label>
              IBAN
              <input
                name="iban"
                value={form.iban}
                onChange={handleChange}
                placeholder="DEMO123456789"
                required
              />
            </label>

            <button type="submit" disabled={isRegistering}>
              {isRegistering ? 'Сохраняем...' : 'Продолжить'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  const avatarLetter = user.fullName.trim().charAt(0).toUpperCase() || 'U'

  const isTrading = user.tradingStatus === 'active'
  const tradingFinished = user.tradingStatus === 'completed'
  const tradingStarted = user.tradingStatus !== 'not_started'

  const plannedTradesCount = tradingSession?.tradesCount || 0
  const completedTradesCount = tradingSession?.completedTrades || 0

  return (
    <main className="app">
      <section className="wallet">
        <header className="wallet-header">
          <button
            className="icon-button"
            type="button"
            onClick={() => setScreen('wallet')}
          >
            {screen === 'withdraw' ? '←' : '☰'}
          </button>

          <div className="account-chip">
            <div className="mini-avatar">{avatarLetter}</div>

            <div>
              <span>
                {user.telegramId.startsWith('demo-')
                  ? 'Demo browser'
                  : `@${user.username || 'telegram_user'}`}
              </span>
              <strong>{user.internalId}</strong>
            </div>
          </div>

          <button className="icon-button" type="button">
            ⚙
          </button>
        </header>

        {notice && <div className="notice">{notice}</div>}

        {screen === 'withdraw' && (
          <section className="withdraw-card">
            <div className="withdraw-header">
              <p>Демо-заявка</p>
              <h1>Вывод средств</h1>
              <span>
                Сумма будет заблокирована и добавлена в историю со статусом “в
                процессе”.
              </span>
            </div>

            <div className="withdraw-summary">
              <div>
                <span>Доступно</span>
                <strong>{formatAmount(balance)} USDT</strong>
              </div>

              <div>
                <span>Заблокировано</span>
                <strong>{formatAmount(blockedAmount)} USDT</strong>
              </div>
            </div>

            <form className="withdraw-form" onSubmit={handleCreateWithdrawal}>
              <label>
                Сумма вывода
                <input
                  value={withdrawAmount}
                  onChange={(event) => setWithdrawAmount(event.target.value)}
                  placeholder="1000"
                  inputMode="decimal"
                  required
                />
              </label>

              <label>
                Номер счета
                <input
                  className="readonly-input"
                  value={user.accountNumber}
                  readOnly
                />
              </label>

              <label>
                IBAN
                <input className="readonly-input" value={user.iban} readOnly />
              </label>

              <div className="form-actions">
                <button type="submit" disabled={isCreatingWithdrawal}>
                  {isCreatingWithdrawal ? 'Создаем...' : 'Создать заявку'}
                </button>

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setScreen('wallet')}
                >
                  Назад
                </button>
              </div>
            </form>
          </section>
        )}

        {screen === 'wallet' && (
          <>
            <section className="hero-balance">
              <p>Демо-баланс</p>
              <h1>{formatAmount(balance)} USDT</h1>
              <span>Виртуальный счет · реальные средства не используются</span>
            </section>

            <section className="quick-actions">
              {!tradingStarted && (
                <button
                  className="round-action primary"
                  type="button"
                  onClick={startTradingSimulation}
                  disabled={isStartingTrading}
                >
                  <span>▶</span>
                  <small>{isStartingTrading ? 'Запуск...' : 'Торговля'}</small>
                </button>
              )}

              <button
                className="round-action"
                type="button"
                onClick={openWithdrawScreen}
              >
                <span>↗</span>
                <small>Вывод</small>
              </button>

              <button
                className="round-action"
                type="button"
                onClick={() => setShowHistory(!showHistory)}
              >
                <span>≡</span>
                <small>История</small>
              </button>

              <button
                className="round-action"
                type="button"
                onClick={() => window.open(MANAGER_LINK, '_blank')}
              >
                <span>💬</span>
                <small>Менеджер</small>
              </button>
            </section>

            {(isTrading || tradingFinished || tradingSession) && (
              <section className="simulation-card">
                <div className="simulation-top">
                  <div>
                    <p>
                      {isTrading
                        ? 'Симуляция запущена'
                        : 'Симуляция завершена'}
                    </p>

                    <strong>
                      Сделки: {completedTradesCount} / {plannedTradesCount}
                    </strong>
                  </div>

                  <div
                    className={isTrading ? 'status-dot pulse' : 'status-dot'}
                  />
                </div>

                <div className="progress">
                  <div
                    style={{
                      width:
                        plannedTradesCount > 0
                          ? `${
                              (completedTradesCount / plannedTradesCount) * 100
                            }%`
                          : '0%',
                    }}
                  />
                </div>

                {tradingFinished && (
                  <p className="finish-text">Итоговый баланс: 20 000 USDT</p>
                )}
              </section>
            )}

            <section className="assets-card">
              <div className="section-title">
                <h2>Активы</h2>
                <span>{blockedAmount > 0 ? 2 : 1}</span>
              </div>

              <div className="asset-row">
                <div className="asset-icon">₮</div>

                <div className="asset-info">
                  <strong>Demo USDT</strong>
                  <span>Доступный баланс</span>
                </div>

                <div className="asset-balance">
                  <strong>{formatAmount(balance)}</strong>
                  <span>USDT</span>
                </div>
              </div>

              {blockedAmount > 0 && (
                <div className="asset-row">
                  <div className="asset-icon locked">🔒</div>

                  <div className="asset-info">
                    <strong>Blocked USDT</strong>
                    <span>Заявки в процессе</span>
                  </div>

                  <div className="asset-balance">
                    <strong>{formatAmount(blockedAmount)}</strong>
                    <span>USDT</span>
                  </div>
                </div>
              )}
            </section>

            {showHistory && (
              <section className="history-panel">
                <div className="section-title">
                  <h2>История</h2>
                  <span>{transactions.length}</span>
                </div>

                {transactions.length === 0 && (
                  <p className="empty">Пока нет операций</p>
                )}

                {transactions.map((transaction) => {
                  const isNegative = transaction.amount < 0
                  const amountText = `${isNegative ? '-' : '+'}${formatAmount(
                    Math.abs(transaction.amount),
                  )} USDT`

                  return (
                    <div className="transaction" key={transaction.id}>
                      <div>
                        <strong>{transaction.type}</strong>
                        <span>{formatDate(transaction.createdAt)}</span>
                      </div>

                      <div className="transaction-right">
                        <strong className={isNegative ? 'negative' : ''}>
                          {amountText}
                        </strong>
                        <span>{transaction.status}</span>
                      </div>
                    </div>
                  )
                })}
              </section>
            )}
          </>
        )}

        <nav className="bottom-nav">
          <button
            className={screen === 'wallet' ? 'active' : ''}
            type="button"
            onClick={() => setScreen('wallet')}
          >
            <span>●</span>
            Кошелек
          </button>

          <button type="button" onClick={openWithdrawScreen}>
            <span>↗</span>
            Вывод
          </button>

          <button
            type="button"
            onClick={() => {
              setScreen('wallet')
              setShowHistory(true)
            }}
          >
            <span>≡</span>
            История
          </button>
        </nav>
      </section>
    </main>
  )
}

function App() {
  const isAdminPage =
    window.location.pathname.includes('/admin') ||
    window.location.hash === '#/admin'

  if (isAdminPage) {
    return <AdminPanel />
  }

  return <WalletApp />
}

export default App