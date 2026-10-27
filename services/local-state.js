const config = require('../config/services')

const prefix = `tf:${config.containerEnvId}:${config.tenantId}`
const profileKey = `${prefix}:profile`
const bookingKey = `${prefix}:booking-reference`

function read(key, fallback) {
  try {
    return wx.getStorageSync(key) || fallback
  } catch (error) {
    return fallback
  }
}

function write(key, data) {
  try {
    wx.setStorageSync(key, data)
  } catch (error) {
    // 本机回填失败不影响后端已完成的预约操作。
  }
}

function getBookingReference() {
  const value = read(bookingKey, null)
  return value && value.id !== undefined && value.id !== null && /^1\d{10}$/.test(value.phone || '') ? value : null
}

function clearBookingReference(id) {
  const current = getBookingReference()
  if (current && String(current.id) === String(id)) write(bookingKey, null)
}

module.exports = {
  profileKey, bookingKey,
  getProfile: () => read(profileKey, {}),
  saveProfile: (profile) => write(profileKey, profile),
  getBookingReference,
  saveBookingReference: (reservation) => write(bookingKey, { id: reservation.id, phone: reservation.phone }),
  clearBookingReference
}
