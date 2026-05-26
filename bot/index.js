require('dotenv').config()

const { Telegraf, Markup } = require('telegraf')

const botToken = process.env.BOT_TOKEN
const webAppUrl = process.env.WEB_APP_URL

if (!botToken) {
  throw new Error('BOT_TOKEN is missing in bot/.env')
}

if (!webAppUrl) {
  throw new Error('WEB_APP_URL is missing in bot/.env')
}

const bot = new Telegraf(botToken)

bot.start(async (ctx) => {
  await ctx.reply(
    'Добро пожаловать!\nДля продолжения откройте приложение.',
    Markup.inlineKeyboard([
      Markup.button.webApp('Открыть приложение', webAppUrl),
    ]),
  )
})

bot.command('app', async (ctx) => {
  await ctx.reply(
    'Откройте приложение:',
    Markup.inlineKeyboard([
      Markup.button.webApp('Открыть приложение', webAppUrl),
    ]),
  )
})

bot.launch()

console.log('Bot started')
console.log(`Mini App URL: ${webAppUrl}`)

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))