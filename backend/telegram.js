const sharp = require('sharp')

function formatAmount(value) {
  return Number(value || 0).toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
  })
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function isRealTelegramUserId(value) {
  return /^\d+$/.test(String(value || ''))
}

async function telegramRequest(method, formData) {
  const botToken = process.env.BOT_TOKEN

  if (!botToken) {
    console.log('Telegram notification skipped: BOT_TOKEN is missing')
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      },
    )

    const data = await response.json().catch(() => null)

    if (!response.ok || !data?.ok) {
      console.error(`Telegram ${method} failed`)
      console.error(data)
      return null
    }

    return data
  } catch (error) {
    console.error(`Telegram ${method} request failed`)
    console.error(error.message)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function sendTelegramMessage(telegramId, text) {
  if (!isRealTelegramUserId(telegramId)) {
    console.log(`Telegram message skipped: invalid telegramId ${telegramId}`)
    return null
  }

  const formData = new FormData()

  formData.append('chat_id', String(telegramId))
  formData.append('text', text)
  formData.append('parse_mode', 'HTML')

  return telegramRequest('sendMessage', formData)
}

async function sendTelegramPhoto(telegramId, imageBuffer, caption) {
  if (!isRealTelegramUserId(telegramId)) {
    console.log(`Telegram photo skipped: invalid telegramId ${telegramId}`)
    return null
  }

  const formData = new FormData()
  const blob = new Blob([imageBuffer], {
    type: 'image/png',
  })

  formData.append('chat_id', String(telegramId))
  formData.append('photo', blob, 'demo-trading-check.png')

  if (caption) {
    formData.append('caption', caption)
    formData.append('parse_mode', 'HTML')
  }

  return telegramRequest('sendPhoto', formData)
}

async function createTradingReceiptImage({ fullName, internalId, amount }) {
  const safeName = escapeXml(fullName || 'Пользователь')
  const safeInternalId = escapeXml(internalId || 'DEMO')
  const amountText = escapeXml(`${formatAmount(amount)} DEMO USDT`)
  const dateText = escapeXml(new Date().toLocaleString('ru-RU'))

  const svg = `
    <svg width="1200" height="720" viewBox="0 0 1200 720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#07111f"/>
          <stop offset="100%" stop-color="#050914"/>
        </linearGradient>

        <linearGradient id="blue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#33c1ff"/>
          <stop offset="100%" stop-color="#0088cc"/>
        </linearGradient>

        <linearGradient id="green" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#22c55e"/>
          <stop offset="100%" stop-color="#16a34a"/>
        </linearGradient>

        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="24" stdDeviation="28" flood-color="#000000" flood-opacity="0.45"/>
        </filter>
      </defs>

      <rect width="1200" height="720" fill="url(#bg)"/>

      <circle cx="1030" cy="120" r="230" fill="#33c1ff" opacity="0.18"/>
      <circle cx="110" cy="640" r="210" fill="#22c55e" opacity="0.1"/>

      <rect x="70" y="60" width="1060" height="600" rx="52" fill="#0f172a" stroke="#24344d" stroke-width="2" filter="url(#shadow)"/>

      <rect x="100" y="92" width="190" height="48" rx="24" fill="#052e16"/>
      <text x="130" y="124" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="#22c55e">DEMO CHECK</text>

      <text x="100" y="205" font-family="Arial, sans-serif" font-size="56" font-weight="900" fill="#ffffff">
        Торговля завершена
      </text>

      <text x="100" y="258" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#94a3b8">
        Результат проведенной торговли
      </text>

      <rect x="100" y="305" width="1000" height="160" rx="34" fill="url(#blue)"/>

      <text x="140" y="365" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="rgba(255,255,255,0.84)">
        Заработано с торговли
      </text>

      <text x="140" y="430" font-family="Arial, sans-serif" font-size="58" font-weight="900" fill="#ffffff">
        +${amountText}
      </text>

      <text x="100" y="525" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#94a3b8">
        Пользователь
      </text>

      <text x="100" y="565" font-family="Arial, sans-serif" font-size="32" font-weight="900" fill="#ffffff">
        ${safeName}
      </text>

      <text x="650" y="525" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#94a3b8">
        Внутренний ID
      </text>

      <text x="650" y="565" font-family="Arial, sans-serif" font-size="32" font-weight="900" fill="#ffffff">
        ${safeInternalId}
      </text>

      <text x="100" y="620" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#64748b">
        Дата: ${dateText}
      </text>

      <rect x="650" y="594" width="450" height="48" rx="24" fill="#111827" stroke="#334155"/>
      <text x="690" y="625" font-family="Arial, sans-serif" font-size="18" font-weight="800" fill="#fbbf24">
        ЛИЧНЫЙ СЧЕТ · ОПЕРАЦИИ С ДЕНЕЖНЫМИ СРЕДСТВАМИ
      </text>
    </svg>
  `

  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function sendTradingStartedNotification(user) {
  return sendTelegramMessage(
    user.telegramId,
    [
      '🚀 <b>Торговля запущена</b>',
      '',
      `ID: <b>${escapeHtml(user.internalId)}</b>`,
      'Ожидайте завершения торговой сессии.',
      '',
      'По завершении торговли, средства будут автоматически зачислены на ваш баланс',
    ].join('\n'),
  )
}

async function sendTradingCompletedReceipt(user, amount) {
  const imageBuffer = await createTradingReceiptImage({
    fullName: user.fullName,
    internalId: user.internalId,
    amount,
  })

  return sendTelegramPhoto(
    user.telegramId,
    imageBuffer,
    [
      '✅ <b>Торговля завершена</b>',
      '',
      `Заработано: <b>${formatAmount(amount)} USDT</b>`,
      'Чек прикреплен изображением.',
      '',
      'Официальный документ, подтверждающий результат торговой сессии.',
    ].join('\n'),
  )
}

async function sendWithdrawalApprovedNotification(user, amount) {
  return sendTelegramMessage(
    user.telegramId,
    [
      '✅ <b>Заявка на вывод одобрена</b>',
      '',
      `Сумма: <b>${formatAmount(amount)}  USDT</b>`,
      'Статус: выполнено.',
      '',
      'За статусом заявки обратитесь к менеджеру',
    ].join('\n'),
  )
}

async function sendWithdrawalRejectedNotification(user, amount) {
  return sendTelegramMessage(
    user.telegramId,
    [
      '❌ <b>Заявка на вывод отклонена</b>',
      '',
      `Сумма: <b>${formatAmount(amount)} USDT</b>`,
      'Сумма возвращена на ваш баланс.',
    ].join('\n'),
  )
}

async function sendBalanceChangedNotification(user, amountChange, nextBalance) {
  const isPositive = amountChange >= 0

  return sendTelegramMessage(
    user.telegramId,
    [
      isPositive
        ? '💰 <b>На ваш личный счет зачислены средства</b>'
        : '⚠️ <b>Ваш личный счет изменен</b>',
      '',
      `${isPositive ? 'Начислено' : 'Изменение'}: <b>${isPositive ? '+' : ''}${formatAmount(amountChange)} USDT</b>`,
      `Текущий баланс: <b>${formatAmount(nextBalance)} USDT</b>`,
      '',
      'Личный счет: баланс реальных средств.',
    ].join('\n'),
  )
}

module.exports = {
  sendTradingStartedNotification,
  sendTradingCompletedReceipt,
  sendWithdrawalApprovedNotification,
  sendWithdrawalRejectedNotification,
  sendBalanceChangedNotification,
}