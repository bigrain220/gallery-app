const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const users = db.collection('appointment_users')
const reservations = db.collection('reservations')
let collectionsReady = false

const ENABLED_TIME_SLOTS = new Set([
  '11:00-12:00',
  '13:00-14:00',
  '16:00-17:00',
  '17:00-18:00',
  '18:00-19:00',
  '19:00-20:00'
])

class PublicError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

async function ensureCollections() {
  if (collectionsReady) return

  // 云函数首次运行时自动初始化集合；集合已存在时 SDK 会报错，可安全忽略。
  await Promise.all([
    db.createCollection('appointment_users').catch(() => null),
    db.createCollection('reservations').catch(() => null)
  ])
  collectionsReady = true
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function isValidPhone(phone) {
  return /^1\d{10}$/.test(phone)
}

function isValidDate(date) {
  if (!/^2026-(11|12)-\d{2}$/.test(date) || date < '2026-11-01' || date > '2026-12-31') {
    return false
  }

  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day, 12))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

function formatDate(date) {
  const [year, month, day] = date.split('-').map(Number)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const weekday = weekdays[new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()]
  return `${month}月${day}日 ${weekday}`
}

function publicUser(record) {
  if (!record) return { name: '', phone: '', phoneVerified: false }
  return {
    name: record.name || '',
    phone: record.phone || '',
    phoneVerified: Boolean(record.phoneVerified)
  }
}

function publicReservation(record) {
  if (!record || record.status !== 'active') return null
  return {
    id: record._id,
    name: record.name,
    phone: record.phone,
    date: record.date,
    dateText: record.dateText || formatDate(record.date),
    time: record.time,
    status: record.status
  }
}

async function findById(collection, id) {
  const result = await collection.where({ _id: id }).limit(1).get()
  return result.data[0] || null
}

async function ensureUser(openid) {
  const existing = await findById(users, openid)
  if (existing) {
    await users.doc(openid).update({
      data: { lastSeenAt: db.serverDate() }
    })
    return existing
  }

  const user = {
    name: '',
    phone: '',
    phoneVerified: false,
    createdAt: db.serverDate(),
    lastSeenAt: db.serverDate()
  }
  await users.doc(openid).set({ data: user })
  return user
}

async function bootstrap(openid) {
  const [user, reservation] = await Promise.all([
    ensureUser(openid),
    findById(reservations, openid)
  ])

  return {
    user: publicUser(user),
    reservation: publicReservation(reservation)
  }
}

async function authorizePhone(openid, code) {
  if (typeof code !== 'string' || !code) {
    throw new PublicError('INVALID_PHONE_CODE', '手机号授权凭证无效')
  }

  let phoneInfo
  try {
    const result = await cloud.openapi.phonenumber.getPhoneNumber({ code })
    phoneInfo = result.phoneInfo
  } catch (error) {
    console.error('getPhoneNumber failed', error)
    throw new PublicError('INVALID_PHONE_CODE', '手机号授权已失效，请重新授权')
  }

  const phone = phoneInfo && phoneInfo.phoneNumber
  if (!isValidPhone(phone)) {
    throw new PublicError('INVALID_PHONE_CODE', '未能获取有效的手机号码')
  }

  const existing = await findById(users, openid)
  const update = {
    phone,
    phoneVerified: true,
    phoneCountryCode: phoneInfo.countryCode || '86',
    phonePureNumber: phoneInfo.purePhoneNumber || phone,
    phoneAuthorizedAt: db.serverDate(),
    lastSeenAt: db.serverDate()
  }

  if (existing) {
    await users.doc(openid).update({ data: update })
  } else {
    await users.doc(openid).set({
      data: {
        name: '',
        createdAt: db.serverDate(),
        ...update
      }
    })
  }

  return { phone }
}

async function submit(openid, event) {
  const name = cleanText(event.name, 30)
  const phone = cleanText(event.phone, 20)
  const date = cleanText(event.date, 10)
  const time = cleanText(event.time, 20)

  if (!name) throw new PublicError('INVALID_INPUT', '请填写姓名')
  if (!isValidPhone(phone)) throw new PublicError('INVALID_INPUT', '请填写正确的手机号码')
  if (!isValidDate(date)) throw new PublicError('INVALID_INPUT', '预约日期不在开放范围内')
  if (!ENABLED_TIME_SLOTS.has(time)) throw new PublicError('INVALID_INPUT', '该预约时段不可用')

  const existingReservation = await findById(reservations, openid)
  if (existingReservation && existingReservation.status === 'active') {
    throw new PublicError('ALREADY_RESERVED', '您已经预约过了')
  }

  const existingUser = await findById(users, openid)
  const now = db.serverDate()
  const reservation = {
    name,
    phone,
    date,
    dateText: formatDate(date),
    time,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    cancelledAt: null
  }

  await reservations.doc(openid).set({ data: reservation })

  const userUpdate = {
    name,
    phone,
    phoneVerified: Boolean(existingUser && existingUser.phoneVerified && existingUser.phone === phone),
    lastSeenAt: db.serverDate()
  }
  if (existingUser) {
    await users.doc(openid).update({ data: userUpdate })
  } else {
    await users.doc(openid).set({
      data: { ...userUpdate, createdAt: db.serverDate() }
    })
  }

  return {
    reservation: publicReservation({ _id: openid, ...reservation })
  }
}

async function cancel(openid) {
  const existing = await findById(reservations, openid)
  if (!existing || existing.status !== 'active') {
    throw new PublicError('NO_ACTIVE_RESERVATION', '当前没有可取消的预约')
  }

  await reservations.doc(openid).update({
    data: {
      status: 'cancelled',
      cancelledAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })

  return { cancelled: true }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()

  if (!OPENID) {
    return { ok: false, code: 'UNAUTHORIZED', message: '无法识别当前用户' }
  }

  try {
    await ensureCollections()

    let data
    switch (event.action) {
      case 'bootstrap':
        data = await bootstrap(OPENID)
        break
      case 'authorizePhone':
        data = await authorizePhone(OPENID, event.code)
        break
      case 'submit':
        data = await submit(OPENID, event)
        break
      case 'cancel':
        data = await cancel(OPENID)
        break
      default:
        throw new PublicError('INVALID_ACTION', '不支持的操作')
    }

    return { ok: true, data }
  } catch (error) {
    if (error instanceof PublicError) {
      return { ok: false, code: error.code, message: error.message }
    }

    console.error('reservation cloud function failed', error)
    return { ok: false, code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' }
  }
}
