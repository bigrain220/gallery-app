const venue = require('../config/venue')

function coordinate(value, limit) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null
}

function getVenueLocation(activity = {}) {
  const address = typeof activity.address === 'string' && activity.address.trim() || venue.address
  const latitude = coordinate(activity.latitude, 90)
  const longitude = coordinate(activity.longitude, 180)
  const streetAddress = address.replace(/\s/g, '').replace(/^(上海市?)?(静安区)?/, '')
  const isDefaultVenue = streetAddress.startsWith(venue.streetAddress)
  const hasCoordinates = latitude !== null && longitude !== null && (latitude !== 0 || longitude !== 0)

  return {
    address,
    location: hasCoordinates
      ? { latitude, longitude, address, name: activity.storeName || activity.name || address }
      : isDefaultVenue
        ? { latitude: venue.latitude, longitude: venue.longitude, address, name: activity.storeName || venue.name }
        : null
  }
}

module.exports = { getVenueLocation }
