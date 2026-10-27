const { request, serviceError } = require('./request')

function pad(value) {
  return String(value).padStart(2, '0')
}

function toDateStr(value) {
  if (Array.isArray(value) && value.length >= 3) return `${value[0]}-${pad(value[1])}-${pad(value[2])}`
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function toTimeStr(value) {
  if (Array.isArray(value) && value.length >= 2) return `${pad(value[0])}:${pad(value[1])}`
  return typeof value === 'string' ? value.slice(0, 5) : ''
}

function toDateTimeStr(value) {
  if (Array.isArray(value) && value.length >= 5) {
    return `${toDateStr(value)} ${toTimeStr(value.slice(3))}:${pad(value[5] || 0)}`
  }
  return typeof value === 'string' ? value.replace('T', ' ') : ''
}

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return ''
  const [year, month, day] = value.split('-').map(Number)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${month}月${day}日 ${weekdays[new Date(year, month - 1, day).getDay()]}`
}

function todayInShanghai() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function normalizeBooking(record) {
  if (!record) return null
  const date = toDateStr(record.bookingDate)
  const startTime = toTimeStr(record.slotStartTime)
  const endTime = toTimeStr(record.slotEndTime)
  const status = Number(record.status)
  return {
    ...record,
    name: record.userName || '',
    phone: record.userPhone || '',
    date,
    dateText: formatDate(date),
    time: startTime && endTime ? `${startTime}-${endTime}` : '',
    status,
    statusText: ['已预约', '已取消', '已核销'][status] || '状态未知',
    createTime: toDateTimeStr(record.createTime),
    canCancel: status === 0 && date >= todayInShanghai()
  }
}

function asList(data) {
  if (!Array.isArray(data)) throw serviceError('预约服务返回列表格式异常，请稍后重试。', 'INVALID_RESPONSE')
  return data
}

async function getActivity() {
  const record = await request('/tf/activity/get')
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw serviceError('活动尚未配置，请稍后重试。', 'INVALID_ACTIVITY')
  }
  return {
    ...record,
    wechat: typeof record.wechat === 'string' ? record.wechat.trim() : '',
    redbook: typeof record.redbook === 'string' ? record.redbook.trim() : '',
    email: typeof record.email === 'string' ? record.email.trim() : '',
    startDate: toDateStr(record.startDate),
    endDate: toDateStr(record.endDate),
    openTime: toTimeStr(record.openTime),
    closeTime: toTimeStr(record.closeTime)
  }
}

async function getMonthStatus(month) {
  return asList(await request('/tf/booking/month-status', { data: { month } })).map((day) => ({
    ...day, date: toDateStr(day.date), status: Number(day.status)
  }))
}

async function getSlots(date) {
  return asList(await request('/tf/booking/slot-list', { data: { date } })).map((slot) => ({
    ...slot,
    value: `${toTimeStr(slot.startTime)}-${toTimeStr(slot.endTime)}`,
    status: Number(slot.status),
    statusText: ['可预约', '不可预约', '已约满', '已截止'][Number(slot.status)] || '不可预约',
    disabled: Number(slot.status) !== 0 || slot.id === undefined || slot.id === null
  }))
}

async function getActiveBooking() {
  // 微信身份由云托管注入请求头，后端据此查询；只有 null 表示没有有效预约。
  const record = await request('/tf/booking/get-by-openid')
  if (record === null) return null
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw serviceError('预约服务返回数据格式异常，请稍后重试。', 'INVALID_RESPONSE')
  }
  const reservation = normalizeBooking(record)
  if (reservation.id === undefined || reservation.id === null || reservation.id === '' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(reservation.date) || record.status === undefined || record.status === null ||
      record.status === '' || ![0, 1, 2].includes(reservation.status)) {
    throw serviceError('预约服务返回数据格式异常，请稍后重试。', 'INVALID_RESPONSE')
  }
  return reservation
}

module.exports = {
  toDateStr, toTimeStr, toDateTimeStr, formatDate, todayInShanghai, normalizeBooking,
  getActivity, getMonthStatus, getSlots, getActiveBooking,
  createBooking: (data) => request('/tf/booking/create', { method: 'POST', data }),
  getBooking: async (id, phone) => normalizeBooking(await request('/tf/booking/get', { data: { id, phone } })),
  listBookings: async (phone) => asList(await request('/tf/booking/list-by-phone', { data: { phone } })).map(normalizeBooking),
  cancelBooking: (id, phone) => request('/tf/booking/cancel', { method: 'POST', data: { id, phone } })
}
