import { useEffect, useState, type FormEvent } from 'react'
import './AdminPanel.css'

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

type WithdrawalRequest = {
  id: string
  userId: string
  amount: number
  accountNumber: string
  iban: string
  status: string
  createdAt: string
  updatedAt: string
  user?: {
    internalId: string
    fullName: string
    telegramId: string
    username: string | null
  }
}

type TradingSession = {
  id: string
  userId: string
  tradesCount: number
  completedTrades: number
  startedAt: string
  finishedAt: string | null
  status: string
}

type UserProfile = {
  user: User
  transactions: Transaction[]
  withdrawalRequests: WithdrawalRequest[]
  tradingSessions: TradingSession[]
}

type BalanceOperation = 'add' | 'set'

const API_BASE_URL = 'https://trading-simulator-backend-gad1.onrender.com'

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
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

function getWithdrawalStatusLabel(status: string) {
  if (status === 'in_process') {
    return '🟡 в процессе'
  }

  if (status === 'completed') {
    return '🟢 выполнено'
  }

  if (status === 'rejected') {
    return '🔴 отклонено'
  }

  return status
}

async function adminRequest<T>(
  path: string,
  password: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
      ...(options?.headers || {}),
    },
    ...options,
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message = data?.error || data?.details || 'Admin API error'
    throw new ApiError(response.status, message)
  }

  return data as T
}

function AdminPanel() {
  const [password, setPassword] = useState(() => {
    return localStorage.getItem('adminPassword') || ''
  })

  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const [users, setUsers] = useState<User[]>([])
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([])
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(
    null,
  )

  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [balanceAmount, setBalanceAmount] = useState('')
  const [balanceOperation, setBalanceOperation] =
    useState<BalanceOperation>('add')

  const inProcessWithdrawals = withdrawals.filter(
    (withdrawal) => withdrawal.status === 'in_process',
  )

  const totalBalance = users.reduce((sum, user) => sum + user.balance, 0)
  const totalBlocked = users.reduce((sum, user) => sum + user.blockedAmount, 0)

  useEffect(() => {
    if (!password) {
      return
    }

    loadAdminData(password).catch(() => {
      setIsAuthorized(false)
    })
  }, [])

  function showNotice(text: string) {
    setNotice(text)

    window.setTimeout(() => {
      setNotice('')
    }, 4000)
  }

  async function loadAdminData(currentPassword = password) {
    setIsLoading(true)

    try {
      const query = search.trim()
        ? `/api/admin/users?search=${encodeURIComponent(search.trim())}`
        : '/api/admin/users'

      const [usersData, withdrawalsData] = await Promise.all([
        adminRequest<User[]>(query, currentPassword),
        adminRequest<WithdrawalRequest[]>(
          '/api/admin/withdrawals',
          currentPassword,
        ),
      ])

      setUsers(usersData)
      setWithdrawals(withdrawalsData)
      setIsAuthorized(true)
      localStorage.setItem('adminPassword', currentPassword)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка'

      showNotice(`Ошибка админки: ${message}`)
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      await loadAdminData(password)
      showNotice('Вход выполнен')
    } catch {
      // Ошибка уже показана в loadAdminData.
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      await loadAdminData()
    } catch {
      // Ошибка уже показана.
    }
  }

  async function loadUserProfile(userId: string) {
    try {
      const profile = await adminRequest<UserProfile>(
        `/api/admin/users/${userId}`,
        password,
      )

      setSelectedProfile(profile)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка'

      showNotice(`Не удалось загрузить пользователя: ${message}`)
    }
  }

  async function approveWithdrawal(withdrawalId: string) {
    try {
      await adminRequest(
        `/api/admin/withdrawals/${withdrawalId}/approve`,
        password,
        {
          method: 'POST',
        },
      )

      showNotice('Заявка одобрена')
      await loadAdminData()

      if (selectedProfile) {
        await loadUserProfile(selectedProfile.user.id)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка'

      showNotice(`Не удалось одобрить заявку: ${message}`)
    }
  }

  async function rejectWithdrawal(withdrawalId: string) {
    try {
      await adminRequest(
        `/api/admin/withdrawals/${withdrawalId}/reject`,
        password,
        {
          method: 'POST',
        },
      )

      showNotice('Заявка отклонена, сумма возвращена на баланс')
      await loadAdminData()

      if (selectedProfile) {
        await loadUserProfile(selectedProfile.user.id)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка'

      showNotice(`Не удалось отклонить заявку: ${message}`)
    }
  }

  async function deleteUser(userId: string) {
    const confirmed = window.confirm(
        'Удалить пользователя? Все его операции, заявки и торговые сессии тоже будут удалены.',
    )

    if (!confirmed) {
        return
    }

    try {
        await adminRequest(`/api/admin/users/${userId}`, password, {
            method: 'DELETE',
        })

        showNotice('Пользователь удален')

        setSelectedProfile(null)
        await loadAdminData()
    } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка'

    showNotice(`Не удалось удалить пользователя: ${message}`)
  }
}
  
  async function updateBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedProfile) {
      showNotice('Сначала выбери пользователя')
      return
    }

    const amount = Number(balanceAmount.replace(',', '.'))

    if (!Number.isFinite(amount)) {
      showNotice('Введите корректную сумму')
      return
    }

    try {
      await adminRequest(
        `/api/admin/users/${selectedProfile.user.id}/balance`,
        password,
        {
          method: 'PATCH',
          body: JSON.stringify({
            operation: balanceOperation,
            amount,
          }),
        },
      )

      setBalanceAmount('')
      showNotice('Баланс обновлен')

      await loadAdminData()
      await loadUserProfile(selectedProfile.user.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка'

      showNotice(`Не удалось изменить баланс: ${message}`)
    }
  }

  function logout() {
    localStorage.removeItem('adminPassword')
    setPassword('')
    setIsAuthorized(false)
    setUsers([])
    setWithdrawals([])
    setSelectedProfile(null)
  }

  if (!isAuthorized) {
    return (
      <main className="admin-page">
        <section className="admin-login-card">
          <div className="admin-logo">A</div>

          <h1>Админ-панель</h1>

          <p>
            Введи пароль администратора. Для локальной разработки сейчас:
            <strong> admin123</strong>
          </p>

          {notice && <div className="admin-notice">{notice}</div>}

          <form className="admin-login-form" onSubmit={handleLogin}>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Пароль администратора"
              type="password"
              required
            />

            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Проверяем...' : 'Войти'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <section className="admin-shell">
        <header className="admin-header">
          <div>
            <p>Trading Simulator</p>
            <h1>Админ-панель</h1>
          </div>

          <button type="button" onClick={logout}>
            Выйти
          </button>
        </header>

        {notice && <div className="admin-notice">{notice}</div>}

        <section className="admin-stats">
          <div>
            <span>Пользователи</span>
            <strong>{users.length}</strong>
          </div>

          <div>
            <span>Заявки в процессе</span>
            <strong>{inProcessWithdrawals.length}</strong>
          </div>

          <div>
            <span>Баланс</span>
            <strong>{formatAmount(totalBalance)} USDT</strong>
          </div>

          <div>
            <span>Заблокировано</span>
            <strong>{formatAmount(totalBlocked)} USDT</strong>
          </div>
        </section>

        <section className="admin-grid">
          <div className="admin-card">
            <div className="admin-card-title">
              <h2>Пользователи</h2>

              <button type="button" onClick={() => loadAdminData()}>
                Обновить
              </button>
            </div>

            <form className="admin-search" onSubmit={handleSearch}>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск: ID / ФИО / Telegram"
              />

              <button type="submit">Найти</button>
            </form>

            <div className="admin-list">
              {users.map((user) => (
                <button
                  className="admin-user-row"
                  type="button"
                  key={user.id}
                  onClick={() => loadUserProfile(user.id)}
                >
                  <div>
                    <strong>{user.fullName}</strong>
                    <span>
                      {user.internalId} · @{user.username || 'no_username'}
                    </span>
                  </div>

                  <div>
                    <strong>{formatAmount(user.balance)}</strong>
                    <span>{user.tradingStatus}</span>
                  </div>
                </button>
              ))}

              {users.length === 0 && (
                <p className="admin-empty">Пользователей нет</p>
              )}
            </div>
          </div>

          <div className="admin-card">
            <div className="admin-card-title">
              <h2>Заявки на вывод</h2>
              <span>{withdrawals.length}</span>
            </div>

            <div className="admin-list">
              {withdrawals.map((withdrawal) => (
                <div className="admin-withdrawal-row" key={withdrawal.id}>
                  <div className="admin-withdrawal-main">
                    <div>
                      <strong>{formatAmount(withdrawal.amount)} USDT</strong>
                      <span>
                        {withdrawal.user?.fullName} ·{' '}
                        {withdrawal.user?.internalId}
                      </span>
                    </div>

                    <div>
                      <strong>{getWithdrawalStatusLabel(withdrawal.status)}</strong>
                      <span>{formatDate(withdrawal.createdAt)}</span>
                    </div>
                  </div>

                  {withdrawal.status === 'in_process' && (
                    <div className="admin-actions">
                      <button
                        className="approve"
                        type="button"
                        onClick={() => approveWithdrawal(withdrawal.id)}
                      >
                        Одобрить
                      </button>

                      <button
                        className="reject"
                        type="button"
                        onClick={() => rejectWithdrawal(withdrawal.id)}
                      >
                        Отклонить
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {withdrawals.length === 0 && (
                <p className="admin-empty">Заявок пока нет</p>
              )}
            </div>
          </div>
        </section>

        {selectedProfile && (
          <section className="admin-profile">
            <div className="admin-card-title">
                <h2>Профиль пользователя</h2>

                <div className="admin-profile-actions">
                    <span>{selectedProfile.user.internalId}</span>

                    <button
                        className="danger"
                        type="button"
                         onClick={() => deleteUser(selectedProfile.user.id)}
                        >
                        Удалить пользователя
                    </button>
                </div>
            </div>

            <div className="admin-profile-grid">
              <div className="admin-profile-box">
                <span>ФИО</span>
                <strong>{selectedProfile.user.fullName}</strong>
              </div>

              <div className="admin-profile-box">
                <span>Telegram ID</span>
                <strong>{selectedProfile.user.telegramId}</strong>
              </div>

              <div className="admin-profile-box">
                <span>Username</span>
                <strong>@{selectedProfile.user.username || 'no_username'}</strong>
              </div>

              <div className="admin-profile-box">
                <span>Баланс</span>
                <strong>{formatAmount(selectedProfile.user.balance)} USDT</strong>
              </div>

              <div className="admin-profile-box">
                <span>Заблокировано</span>
                <strong>
                  {formatAmount(selectedProfile.user.blockedAmount)} USDT
                </strong>
              </div>

              <div className="admin-profile-box">
                <span>Статус торговли</span>
                <strong>{selectedProfile.user.tradingStatus}</strong>
              </div>
            </div>

            <form className="admin-balance-form" onSubmit={updateBalance}>
              <select
                value={balanceOperation}
                onChange={(event) =>
                  setBalanceOperation(event.target.value as BalanceOperation)
                }
              >
                <option value="add">Добавить / списать</option>
                <option value="set">Установить баланс</option>
              </select>

              <input
                value={balanceAmount}
                onChange={(event) => setBalanceAmount(event.target.value)}
                placeholder="Например: 100 или -100"
              />

              <button type="submit">Изменить баланс</button>
            </form>

            <div className="admin-profile-columns">
              <div>
                <h3>История операций</h3>

                <div className="admin-list compact">
                  {selectedProfile.transactions.map((transaction) => (
                    <div className="admin-transaction" key={transaction.id}>
                      <div>
                        <strong>{transaction.type}</strong>
                        <span>{formatDate(transaction.createdAt)}</span>
                      </div>

                      <div>
                        <strong
                          className={
                            transaction.amount < 0 ? 'negative' : 'positive'
                          }
                        >
                          {transaction.amount > 0 ? '+' : ''}
                          {formatAmount(transaction.amount)} USDT
                        </strong>
                        <span>{transaction.status}</span>
                      </div>
                    </div>
                  ))}

                  {selectedProfile.transactions.length === 0 && (
                    <p className="admin-empty">Истории пока нет</p>
                  )}
                </div>
              </div>

              <div>
                <h3>Заявки пользователя</h3>

                <div className="admin-list compact">
                    {selectedProfile.withdrawalRequests.map((withdrawal) => (
                        <div className="admin-profile-withdrawal" key={withdrawal.id}>
                            <div className="admin-profile-withdrawal-main">
                                <div>
                                    <strong>{formatAmount(withdrawal.amount)} USDT</strong>
                                    <span>{formatDate(withdrawal.createdAt)}</span>
                                </div>

                                <div>
                                    <strong>{getWithdrawalStatusLabel(withdrawal.status)}</strong>
                                    <span>{withdrawal.iban}</span>
                                </div>
                            </div>

                            {withdrawal.status === 'in_process' && (
                                <div className="admin-actions">
                                    <button
                                        className="approve"
                                        type="button"
                                        onClick={() => approveWithdrawal(withdrawal.id)}
                                    >
                                        Одобрить
                                    </button>

                                    <button
                                        className="reject"
                                        type="button"
                                        onClick={() => rejectWithdrawal(withdrawal.id)}
                                    >
                                        Отклонить
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}

                  {selectedProfile.withdrawalRequests.length === 0 && (
                    <p className="admin-empty">Заявок пока нет</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </section>
    </main>
  )
}

export default AdminPanel