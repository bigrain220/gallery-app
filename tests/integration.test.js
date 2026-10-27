const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const config = require('../config/services')
const { request } = require('../services/request')
const api = require('../services/tf')
const localState = require('../services/local-state')
const venue = require('../config/venue')
const { getVenueLocation } = require('../services/location')

let pageDefinition
global.Page = (definition) => { pageDefinition = definition }
require('../pages/index/index')
const createPage = require('../services/booking-page')
let calls, notices, app, storage, respond
let pageStack, pageLoads
const activity = { name: 'Test event', startDate: [2099, 12, 20], endDate: [2100, 1, 10], openTime: [11, 0], closeTime: [20, 0] }
const booking = { id: '9007199254740993', bookingNo: 'TF-TEST', userName: '测试预约', userPhone: '13800138000', openid: 'test-openid', bookingDate: [2099, 12, 20], slotStartTime: [13, 0], slotEndTime: [14, 0], status: 0, createTime: [2099, 10, 27, 9, 30, 0] }
const slots = [{ id: '9007199254740995', startTime: [13, 0], endTime: [14, 0], status: 0 }]

function ok(data) { return { statusCode: 200, data: { code: 0, data, msg: '' } } }
function event(dataset) { return { currentTarget: { dataset } } }
function page() {
  const instance = mountPage('main')
  pageStack = [instance]
  return instance
}
function mountPage(type) {
  const definition = createPage(type)
  return { ...definition, data: structuredClone(definition.data), setData(data) { Object.assign(this.data, data) } }
}
function activePage() { return pageStack.at(-1) }
async function settlePages() {
  while (pageLoads.length) await Promise.all(pageLoads.splice(0))
}
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
function readyForm() {
  const instance = page()
  instance.setData({ view: 'main', name: ' 测试预约 ', phone: '13800138000', dateValue: '2099-12-20', selectedSlotId: slots[0].id, selectedTime: '13:00-14:00', consented: true })
  return instance
}

beforeEach(() => {
  calls = []
  notices = []
  app = { globalData: { user: null, reservation: null } }
  storage = new Map()
  pageStack = []
  pageLoads = []
  global.getApp = () => app
  global.getCurrentPages = () => pageStack
  respond = async (options) => {
    const pathname = options.path.split('?')[0]
    if (pathname.endsWith('/activity/get')) return ok(activity)
    if (pathname.endsWith('/get-by-openid')) return ok(null)
    if (pathname.endsWith('/slot-list')) return ok(slots)
    if (pathname.endsWith('/create')) return ok(booking.id)
    if (pathname.endsWith('/booking/get')) return ok(booking)
    if (pathname.endsWith('/list-by-phone')) return ok([booking])
    if (pathname.endsWith('/cancel')) return ok(true)
    if (pathname.endsWith('/month-status')) return ok([])
    throw new Error(`Unexpected request: ${options.path}`)
  }
  global.wx = {
    cloud: {
      callContainer: async (options) => { calls.push(structuredClone(options)); return respond(options) }
    },
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, data) => storage.set(key, data),
    showToast: (options) => notices.push(options.title),
    showLoading() {}, hideLoading() {}, showModal() {},
    setNavigationBarTitle() {},
    navigateTo(options) {
      activePage().onHide()
      const type = options.url.split('/').at(-1)
      const child = mountPage(type)
      const listeners = {...options.events}
      const channel = {
        on(name, callback) { listeners[name] = callback },
        emit(name, value) {
          const result = listeners[name](structuredClone(value))
          if (result && typeof result.then === 'function') pageLoads.push(result)
        }
      }
      child.getOpenerEventChannel = () => channel
      pageStack.push(child)
      child.onLoad()
      child.onShow()
      options.success({eventChannel: channel})
    },
    navigateBack() {
      if (pageStack.length > 1) {
        pageStack.pop().onUnload()
        const result = activePage().onShow()
        if (result && typeof result.then === 'function') pageLoads.push(result)
      }
    },
    reLaunch(options) {
      notices.push(options.url)
      for (const previous of pageStack) { previous.onHide(); previous.onUnload() }
      const type = options.url.split('/').at(-1)
      const root = mountPage(type === 'index' ? 'main' : type)
      pageStack = [root]
      const loading = root.onLoad()
      if (loading && typeof loading.then === 'function') pageLoads.push(loading)
      const showing = root.onShow()
      if (showing && typeof showing.then === 'function') pageLoads.push(showing)
      if (options.success) options.success()
    },
    getWindowInfo: () => ({ statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ top: 30, height: 32 })
  }
})

test('all 8 TF endpoints use the provided container, tenant, methods and payloads', async () => {
  assert.equal((await api.getActivity()).startDate, '2099-12-20')
  await api.getMonthStatus('2099-12')
  await api.getSlots('2099-12-20')
  const payload = { name: booking.userName, phone: booking.userPhone, date: '2099-12-20', slotId: slots[0].id, openid: 'test-openid' }
  assert.equal(await api.createBooking(payload), booking.id)
  const detail = await api.getBooking(booking.id, booking.userPhone)
  assert.equal(detail.date, '2099-12-20')
  assert.equal(detail.time, '13:00-14:00')
  assert.equal(detail.createTime, '2099-10-27 09:30:00')
  assert.equal(await api.getActiveBooking('test-openid'), null)
  assert.equal((await api.listBookings(booking.userPhone)).length, 1)
  assert.equal(await api.cancelBooking(booking.id, booking.userPhone), true)
  assert.equal(calls.length, 8)
  for (const options of calls) {
    assert.deepEqual(options.config, { env: 'prod-d3giey1bt59348a38' })
    assert.equal(options.header['X-WX-SERVICE'], 'tf')
    assert.equal(options.header['tenant-id'], '1')
    assert.equal(options.timeout, 15000)
    assert.ok(options.path.startsWith('/app-api/tf/'))
    if (options.method === 'GET') assert.ok(!Object.hasOwn(options, 'data'))
  }
  assert.deepEqual(calls[3].data, payload)
  assert.equal(calls[3].method, 'POST')
  assert.deepEqual(calls[7].data, { id: booking.id, phone: booking.userPhone })
  assert.equal(calls[7].method, 'POST')
})

test('request handles JSON text, null, false, query encoding, HTTP errors and business errors', async () => {
  respond = async () => ({ statusCode: 200, data: '{"code":0,"data":false}' })
  assert.equal(await request('/test', { data: { openid: 'o+&?', ignored: null } }), false)
  assert.equal(calls[0].path, '/app-api/test?openid=o%2B%26%3F')
  respond = async () => ({ statusCode: 200, data: { code: 1011001, msg: '该手机号已经预约' } })
  await assert.rejects(request('/test'), { code: 1011001, message: '该手机号已经预约' })
  respond = async () => ({ statusCode: 429, data: {} })
  await assert.rejects(request('/test'), /操作过于频繁/)
  respond = async () => ({ statusCode: 503, data: {} })
  await assert.rejects(request('/test'), { statusCode: 503 })
  respond = async () => ({ statusCode: 200, data: '<html>error</html>' })
  await assert.rejects(request('/test'), { code: 'INVALID_RESPONSE' })
  respond = async () => { throw new Error('timeout') }
  await assert.rejects(request('/test'), { code: 'NETWORK_ERROR' })
})

test('date/time conversions support Java arrays and ISO strings, cancelled/verified/expired bookings', () => {
  assert.equal(api.toDateStr([2026, 1, 2]), '2026-01-02')
  assert.equal(api.toDateStr('2026-11-20'), '2026-11-20')
  assert.equal(api.toTimeStr([9, 5, 0]), '09:05')
  assert.equal(api.toTimeStr('13:00:00'), '13:00')
  assert.equal(api.toDateTimeStr([2026, 1, 2, 9, 5]), '2026-01-02 09:05:00')
  assert.equal(api.normalizeBooking({ ...booking, status: 1 }).canCancel, false)
  assert.equal(api.normalizeBooking({ ...booking, status: 2 }).canCancel, false)
  assert.equal(api.normalizeBooking({ ...booking, bookingDate: [2020, 1, 1] }).canCancel, false)
})

test('startup replaces home with the booking root when a valid booking exists', async () => {
  storage.set(localState.profileKey, { name: '本地姓名', phone: '13800138000' })
  const original = respond
  respond = async options => options.path.includes('/list-by-phone') ? ok([]) : original(options)
  const instance = page()
  await instance.initialize()
  await settlePages()
  assert.equal(instance.data.view, 'main')
  assert.equal(instance.data.name, '')
  assert.equal(instance.data.phone, '')
  assert.equal(app.globalData.user.name, '本地姓名')
  assert.deepEqual(instance.data.months.map((month) => month.key), ['2099-12', '2100-01'])
  assert.ok(calls.some((options) => options.path === '/app-api/tf/booking/get-by-openid'))
  assert.ok(calls.every((options) => !Object.hasOwn(options.header, 'X-WX-OPENID')))
  respond = async (options) => options.path.includes('/get-by-openid') ? ok(booking) : original(options)
  await instance.initialize()
  await settlePages()
  assert.equal(instance.destroyed, true)
  assert.equal(activePage().pageType, 'reservation')
  assert.equal(activePage().data.view, 'bookings')
  assert.equal(activePage().data.isBookingRoot, true)
  assert.equal(activePage().data.reservation.id, booking.id)
  assert.equal(pageStack.length, 1)
  const root = activePage()
  wx.navigateBack()
  assert.equal(activePage(), root)
})

test('startup failure shows retry state and can recover', async () => {
  const original = respond
  respond = async () => { throw new Error('network unavailable') }
  const instance = page()
  await instance.initialize()
  await settlePages()
  assert.equal(instance.data.view, 'error')
  assert.match(instance.data.errorMessage, /无法连接预约服务/)
  respond = original
  await instance.retryInitialize()
  assert.equal(instance.data.view, 'main')
})

test('home waits for booking status and never allows submission while the result is pending', async () => {
  const pending = deferred()
  const original = respond
  respond = options => options.path.endsWith('/get-by-openid') ? pending.promise : original(options)
  const instance = page()
  const initializing = instance.initialize()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(instance.data.view, 'loading')
  assert.equal(instance.data.isCheckingBooking, true)
  await instance.submitReservation()
  assert.equal(notices.at(-1), '请先确认预约状态')
  assert.equal(calls.some(options => options.path.includes('/slot-list') || options.path.endsWith('/create')), false)
  pending.resolve(ok(booking))
  await initializing
  await settlePages()
  assert.equal(activePage().data.isBookingRoot, true)
  assert.equal(activePage().data.reservation.id, booking.id)
  assert.equal(pageStack.length, 1)
})

test('home finds active bookings from saved phone even without a booking reference', async () => {
  storage.set(localState.profileKey, {phone: booking.userPhone})
  const instance = page()
  await instance.initialize()
  assert.equal(instance.data.activeReservation.id, booking.id)
  assert.ok(calls.some(options => options.path.endsWith('/list-by-phone?phone=' + booking.userPhone)))
  assert.equal(instance.data.name, '')
  assert.equal(instance.data.phone, '')
})

test('returning to foreground during the first lookup refreshes status instead of revealing an unchecked form', async () => {
  const pending = deferred()
  const original = respond
  let identityCalls = 0
  respond = options => options.path.endsWith('/get-by-openid')
    ? (++identityCalls === 1 ? pending.promise : Promise.resolve(ok(booking))) : original(options)
  const home = page()
  const initializing = home.initialize()
  await new Promise(resolve => setImmediate(resolve))
  home.onHide()
  await home.onShow()
  assert.equal(home.data.activeReservation.id, booking.id)
  pending.resolve(ok(null))
  await initializing
  assert.equal(home.data.activeReservation.id, booking.id)
  assert.equal(home.data.isCheckingBooking, false)
})

test('cancelled, checked-in and expired history does not replace the booking form', async () => {
  const original = respond
  for (const record of [{...booking, status: 1}, {...booking, status: 2}, {...booking, bookingDate: [2020, 1, 1]}]) {
    storage.clear()
    app.globalData.reservation = null
    storage.set(localState.profileKey, {phone: booking.userPhone})
    respond = async options => options.path.endsWith('/get-by-openid') ? ok(record)
      : options.path.includes('/list-by-phone') ? ok([record]) : original(options)
    const instance = page()
    await instance.initialize()
    assert.equal(instance.data.activeReservation, null)
    assert.equal(instance.data.bookingLookupError, '')
    assert.equal(instance.data.isCheckingBooking, false)
  }
})

test('successful cancellation replaces the booking root with a fresh home form', async () => {
  const original = respond
  let cancelled = false
  respond = async options => {
    if (options.path.endsWith('/cancel')) { cancelled = true; return ok(true) }
    if (options.path.endsWith('/get-by-openid')) return ok(cancelled ? null : booking)
    if (options.path.includes('/booking/get?')) return ok({...booking, status: cancelled ? 1 : 0})
    if (options.path.includes('/list-by-phone')) return ok([{...booking, status: cancelled ? 1 : 0}])
    return original(options)
  }
  const home = page()
  await home.initialize()
  await settlePages()
  const list = activePage()
  assert.equal(list.data.isBookingRoot, true)
  list.cancelReservation(event({id: booking.id}))
  await list.confirmCancelReservation()
  await settlePages()
  const fresh = activePage()
  assert.equal(list.destroyed, true)
  assert.equal(fresh.pageType, 'main')
  assert.equal(fresh.data.view, 'main')
  assert.equal(pageStack.length, 1)
  assert.equal(fresh.data.activeReservation, null)
  assert.equal(fresh.data.bookingLookupError, '')
  assert.equal(fresh.data.isCheckingBooking, false)
  assert.equal(fresh.data.name, '')
  assert.equal(fresh.data.consented, false)
})

test('foreground refresh replaces home once and ignores an older lookup result', async () => {
  const home = page()
  await home.initialize()
  const pending = deferred()
  respond = () => pending.promise
  const older = home.refreshHomeBooking()
  respond = async () => ok(booking)
  await home.onShow()
  await settlePages()
  const root = activePage()
  assert.equal(root.data.isBookingRoot, true)
  assert.equal(home.destroyed, true)
  pending.resolve(ok(null))
  await older
  assert.equal(activePage(), root)
  assert.equal(pageStack.length, 1)
})

test('failed root navigation keeps the home form hidden and can retry without reusing the bootstrap context', async () => {
  const original = respond
  respond = async options => options.path.endsWith('/get-by-openid') ? ok(booking) : original(options)
  const nativeReLaunch = wx.reLaunch
  wx.reLaunch = options => options.fail()
  const home = page()
  await home.initialize()
  assert.equal(home.data.view, 'error')
  assert.match(home.data.errorMessage, /页面暂时无法打开/)
  assert.equal(app.globalData.bookingEntry, null)
  assert.equal(home.navigating, false)
  wx.reLaunch = nativeReLaunch
  await home.retryInitialize()
  await settlePages()
  assert.equal(home.destroyed, true)
  assert.equal(activePage().data.isBookingRoot, true)
  assert.equal(app.globalData.bookingEntry, null)
})

test('failed cancellation keeps the booking root and never exposes home', async () => {
  const original = respond
  respond = async options => options.path.endsWith('/get-by-openid') ? ok(booking) : original(options)
  await page().initialize()
  await settlePages()
  const root = activePage()
  respond = async options => options.path.endsWith('/cancel') ? ok(false) : original(options)
  root.cancelReservation(event({id: booking.id}))
  await root.confirmCancelReservation()
  assert.equal(activePage(), root)
  assert.equal(root.data.showCancelDialog, true)
  assert.equal(app.globalData.reservation.id, booking.id)
  wx.navigateBack()
  assert.equal(activePage(), root)
  assert.equal(pageStack.length, 1)
})

test('the booking root checks status on foreground and restores home after cancellation elsewhere', async () => {
  const original = respond
  respond = async options => options.path.endsWith('/get-by-openid') ? ok(booking) : original(options)
  await page().initialize()
  await settlePages()
  const root = activePage()
  const pending = deferred()
  respond = () => pending.promise
  const previousCheck = root.queryBookings()
  root.onHide()
  respond = async options => options.path.endsWith('/get-by-openid') ? ok(null)
    : options.path.includes('/booking/get?') ? ok({...booking, status: 1})
    : options.path.includes('/list-by-phone') ? ok([{...booking, status: 1}]) : original(options)
  await root.onShow()
  await settlePages()
  pending.resolve(ok(booking))
  await previousCheck
  assert.equal(root.destroyed, true)
  assert.equal(activePage().pageType, 'main')
  assert.equal(activePage().data.view, 'main')
  assert.equal(pageStack.length, 1)
  assert.equal(app.globalData.reservation, null)
})

test('a hidden home lookup cannot replace the current page after its response arrives', async () => {
  const home = page()
  await home.initialize()
  const pending = deferred()
  respond = () => pending.promise
  const checking = home.refreshHomeBooking()
  home.onHide()
  pending.resolve(ok(booking))
  await checking
  assert.equal(home.data.activeReservation, null)
  assert.equal(pageStack.length, 1)
  assert.equal(activePage(), home)
})

test('returning from a picker preserves the draft without querying home booking status again', async () => {
  const original = respond
  respond = async options => options.path.includes('/month-status') ? ok([{date: [2099, 12, 20], status: 0}]) : original(options)
  const home = page()
  await home.initialize()
  home.setData({name: '访客', phone: booking.userPhone, consented: true})
  await home.openPicker(event({picker: 'date'}))
  await settlePages()
  const count = calls.length
  wx.navigateBack()
  await settlePages()
  assert.equal(activePage(), home)
  assert.equal(calls.length, count)
  assert.equal(home.data.name, '访客')
  assert.equal(home.data.consented, true)
  assert.equal(home.data.isCheckingBooking, false)
})

test('returning from my bookings restores the existing form without a loading frame or another status query', async () => {
  const original = respond
  respond = async options => options.path.includes('/list-by-phone') ? ok([{...booking, status: 1}]) : original(options)
  const home = page()
  await home.initialize()
  home.setData({name: '访客', phone: booking.userPhone, dateValue: '2099-12-20', dateText: '12月20日 周日',
    selectedSlotId: slots[0].id, selectedTime: '13:00-14:00', consented: true, mainScrollTop: 640})
  const fields = ['name', 'phone', 'dateValue', 'dateText', 'selectedSlotId', 'selectedTime', 'consented', 'mainScrollTop']
  const draft = Object.fromEntries(fields.map(key => [key, home.data[key]]))
  await home.openMyBookings()
  await settlePages()
  assert.equal(activePage().data.view, 'bookings')
  assert.equal(activePage().data.isBookingRoot, false)
  const requestCount = calls.length
  const frames = []
  const setData = home.setData.bind(home)
  home.setData = data => { setData(data); frames.push(home.data.view) }
  wx.navigateBack()
  await settlePages()
  assert.equal(activePage(), home)
  assert.equal(home.data.view, 'main')
  assert.ok(frames.length > 0)
  assert.ok(frames.every(view => view === 'main'))
  assert.equal(home.data.isCheckingBooking, false)
  assert.equal(calls.length, requestCount)
  assert.deepEqual(Object.fromEntries(fields.map(key => [key, home.data[key]])), draft)
})

test('restored booking details return to the booking root and cannot reveal home', async () => {
  const hiddenFor = []
  wx.hideHomeButton = () => hiddenFor.push(activePage())
  const original = respond
  respond = async (options) => options.path.endsWith('/get-by-openid') ? ok(booking) : original(options)
  const instance = page()
  await instance.initialize()
  await settlePages()
  const root = activePage()
  assert.equal(root.data.isBookingRoot, true)
  assert.equal(hiddenFor.length, 1)
  assert.equal(hiddenFor[0], root)
  await root.viewBooking(event({id: booking.id}))
  await settlePages()
  assert.equal(hiddenFor.length, 1)
  assert.equal(activePage().data.view, 'success')
  assert.equal(activePage().data.reservation.time, '13:00-14:00')
  activePage().returnToForm()
  await settlePages()
  assert.equal(activePage(), root)
  assert.equal(hiddenFor.length, 2)
  assert.equal(hiddenFor[1], root)
  assert.equal(pageStack.length, 1)
  wx.navigateBack()
  assert.equal(activePage(), root)
  assert.equal(instance.data.dateValue, '')
  assert.equal(instance.data.dateText, '')
  assert.equal(instance.data.selectedTime, '')
  assert.equal(instance.data.selectedSlotId, '')
  assert.equal(instance.data.consented, false)
})

test('viewing historical booking details preserves the date, time and consent of an unfinished form', async () => {
  const form = readyForm()
  form.setData({ consented: false, dateText: api.formatDate(form.data.dateValue) })
  const keys = ['name', 'phone', 'dateValue', 'dateText', 'selectedTime', 'selectedSlotId', 'consented']
  const draft = Object.fromEntries(keys.map(key => [key, form.data[key]]))
  const historical = {...booking, id: 'historical', status: 1, bookingDate: [2099, 12, 21], slotStartTime: [17, 0], slotEndTime: [18, 0]}
  const original = respond
  respond = async options => options.path.includes('/booking/get?') ? ok(historical)
    : options.path.includes('/list-by-phone') ? ok([historical]) : original(options)
  await form.openMyBookings()
  await settlePages()
  const list = activePage()
  const records = [api.normalizeBooking(historical)]
  list.setData({bookings: records})
  await list.viewBooking(event({id: 'historical'}))
  await settlePages()
  const details = activePage()
  assert.notEqual(details, list)
  assert.equal(pageStack.length, 3)
  assert.equal(list.data.view, 'bookings')
  assert.equal(details.data.reservation.time, '17:00-18:00')
  wx.navigateBack()
  assert.equal(activePage(), list)
  assert.deepEqual(list.data.bookings, records)
  wx.navigateBack()
  assert.equal(activePage(), form)
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, form.data[key]])), draft)
})

test('calendar uses backend status, disables missing/out-of-range days, clears slot on date change', async () => {
  const form = page()
  form.setData({ view: 'main', activity: { startDate: '2099-12-20', endDate: '2100-01-10' }, dateValue: '2099-12-20', selectedSlotId: 123, selectedTime: '13:00-14:00' })
  respond = async options => ok(options.path.includes('2099-12') ? [
    { date: [2099, 12, 19], status: 0 }, { date: [2099, 12, 20], status: 0 },
    { date: [2099, 12, 21], status: 1 }, { date: [2099, 12, 22], status: 2 },
    { date: [2099, 12, 23], status: 3 }, { date: [2099, 12, 24], status: 0 }
  ] : [])
  await form.openPicker(event({picker: 'date'}))
  await settlePages()
  const picker = activePage()
  const days = picker.data.months.flatMap(month => month.days)
  assert.equal(days.find(day => day.value === '2099-12-19').disabled, true)
  assert.equal(days.find(day => day.value === '2099-12-20').disabled, false)
  for (const day of ['21', '22', '23', '25']) assert.equal(days.find(item => item.value === '2099-12-' + day).disabled, true)
  picker.selectDate(event({value: '2099-12-22'}))
  assert.equal(picker.data.draftDateValue, '2099-12-20')
  picker.selectDate(event({value: '2099-12-24'}))
  picker.confirmDate()
  assert.equal(activePage(), form)
  assert.equal(form.data.dateValue, '2099-12-24')
  assert.equal(form.data.selectedSlotId, '')
  assert.equal(form.data.selectedTime, '')
})

test('slot selection rejects disabled slots and ignores older responses', async () => {
  const first = deferred()
  const second = deferred()
  respond = options => options.path.includes('2099-12-20') ? first.promise : second.promise
  const form = readyForm()
  await form.openPicker(event({picker: 'time'}))
  const picker = activePage()
  picker.setData({dateValue: '2099-12-21'})
  form.setData({dateValue: '2099-12-21'})
  const secondLoad = picker.loadSlots()
  second.resolve(ok([{...slots[0], id: 2}, {...slots[0], id: 3, status: 2}]))
  await secondLoad
  first.resolve(ok(slots))
  await settlePages()
  assert.equal(picker.data.timeSlots[0].id, 2)
  picker.selectTime(event({id: 3}))
  assert.equal(picker.data.draftSlotId, '')
  picker.selectTime(event({id: '2'}))
  picker.confirmTime()
  assert.equal(activePage(), form)
  assert.equal(form.data.selectedSlotId, 2)
})

test('unchecked consent blocks submission before requests or existing-booking redirects', async () => {
  for (const current of [null, api.normalizeBooking(booking)]) {
    calls = []
    app.globalData.reservation = current
    const instance = readyForm()
    instance.setData({ consented: false })
    await instance.submitReservation()
  await settlePages()
    assert.equal(instance.data.view, 'main')
    assert.equal(instance.data.isSubmitting, false)
    assert.equal(instance.data.reservation, null)
    assert.equal(calls.length, 0)
    assert.equal(notices.at(-1), '请阅读并同意隐私说明')
    assert.equal(localState.getBookingReference(), null)
  }
})

test('consent is locked during submission and the cleared form is removed after success', async () => {
  const pendingSlots = deferred()
  const original = respond
  respond = (options) => options.path.includes('/slot-list') ? pendingSlots.promise : original(options)
  const instance = readyForm()
  const submitting = instance.submitReservation()
  instance.toggleConsent()
  const consentWhileSubmitting = instance.data.consented
  pendingSlots.resolve(ok(slots))
  await submitting
  await settlePages()
  assert.equal(consentWhileSubmitting, true)
  assert.equal(instance.data.consented, false)
  assert.equal(calls.filter((options) => options.path.endsWith('/create')).length, 1)
  assert.equal(instance.destroyed, true)
  assert.equal(pageStack.some(item => item.pageType === 'main'), false)
})

test('confirmed submission clears all form values and details or restart cannot refill them', async () => {
  const instance = readyForm()
  instance.setData({ dateText: api.formatDate(instance.data.dateValue), draftDateValue: instance.data.dateValue,
    draftSlotId: slots[0].id, timeSlots: [{ id: slots[0].id, value: instance.data.selectedTime }], mainScrollTop: 800 })
  instance.formScrollTop = 800
  instance.currentScrollTop = 800
  const assertEmpty = (target) => {
    for (const key of ['name', 'phone', 'dateValue', 'dateText', 'selectedTime', 'selectedSlotId', 'draftDateValue', 'draftSlotId']) {
      assert.equal(target.data[key], '', key)
    }
    assert.equal(target.data.consented, false)
    assert.deepEqual(target.data.timeSlots, [])
    assert.equal(target.data.mainScrollTop, 0)
  }
  await instance.submitReservation()
  await settlePages()
  assert.equal(activePage().data.view, 'success')
  assert.equal(activePage().data.reservation.phone, booking.userPhone)
  assert.equal(activePage().data.reservation.time, '13:00-14:00')
  assertEmpty(instance)
  activePage().returnToForm()
  await settlePages()
  assertEmpty(instance)
  assert.equal(activePage().data.isBookingRoot, true)
  assert.equal(activePage().data.bookings.length, 1)
  await activePage().viewBooking(event({ id: booking.id }))
  await settlePages()
  activePage().returnToForm()
  await settlePages()
  assertEmpty(instance)
  assert.equal(localState.getBookingReference().id, booking.id)
  assert.equal(localState.getProfile().phone, booking.userPhone)
  const restarted = page()
  await restarted.initialize()
  await settlePages()
  assert.equal(activePage().data.isBookingRoot, true)
  assert.equal(activePage().data.reservation.id, booking.id)
  assertEmpty(restarted)
})

test('failed submission keeps the completed form available for retry', async () => {
  const instance = readyForm()
  instance.setData({ dateText: api.formatDate(instance.data.dateValue), draftDateValue: instance.data.dateValue, draftSlotId: slots[0].id })
  const fields = ['name', 'phone', 'dateValue', 'dateText', 'selectedTime', 'selectedSlotId', 'draftDateValue', 'draftSlotId', 'consented']
  const draft = Object.fromEntries(fields.map(key => [key, instance.data[key]]))
  const original = respond
  respond = async (options) => {
    if (options.path.endsWith('/create')) return { statusCode: 200, data: { code: 500, msg: '暂时无法提交' } }
    if (options.path.includes('/list-by-phone')) return ok([])
    return original(options)
  }
  await instance.submitReservation()
  await settlePages()
  assert.equal(instance.data.view, 'main')
  assert.deepEqual(Object.fromEntries(fields.map(key => [key, instance.data[key]])), draft)
  assert.equal(localState.getBookingReference(), null)
})

test('submit sends documented required fields and fetches detail, while double tap creates once', async () => {
  const instance = readyForm()
  await Promise.all([instance.submitReservation(), instance.submitReservation()])
  await settlePages()
  const creates = calls.filter((options) => options.path.endsWith('/create'))
  assert.equal(creates.length, 1)
  assert.deepEqual(creates[0].data, { name: '测试预约', phone: '13800138000', date: '2099-12-20', slotId: slots[0].id })
  assert.equal(activePage().data.view, 'success')
  assert.equal(activePage().data.reservation.bookingNo, booking.bookingNo)
  assert.ok(calls.some((options) => options.path.includes(`/booking/get?id=${booking.id}&phone=${booking.userPhone}`)))
})

test('detail failure after successful create retains success and prevents a second create', async () => {
  const original = respond
  respond = async (options) => {
    if (options.path.includes('/booking/get?')) throw new Error('timeout')
    return original(options)
  }
  const instance = readyForm()
  await instance.submitReservation()
  await settlePages()
  assert.equal(activePage().data.view, 'success')
  assert.ok(activePage().data.detailError)
  assert.equal(activePage().data.reservation.id, booking.id)
  assert.equal(instance.data.name, '')
  assert.equal(instance.data.phone, '')
  assert.equal(instance.data.selectedSlotId, '')
  assert.equal(instance.data.consented, false)
  await instance.submitReservation()
  await settlePages()
  assert.equal(calls.filter((options) => options.path.endsWith('/create')).length, 1)
})

test('create timeout recovers actual active booking; newly full slot is never submitted', async () => {
  const original = respond
  respond = async (options) => {
    if (options.path.endsWith('/create')) throw new Error('timeout after commit')
    if (options.path.includes('/get-by-openid')) return ok(booking)
    return original(options)
  }
  const instance = readyForm()
  await instance.submitReservation()
  await settlePages()
  assert.equal(activePage().data.view, 'success')
  assert.equal(instance.data.name, '')
  assert.equal(instance.data.phone, '')
  assert.equal(instance.data.dateValue, '')
  assert.equal(instance.data.selectedTime, '')
  assert.equal(instance.data.consented, false)
  calls = []
  app.globalData.reservation = null
  respond = async (options) => options.path.includes('/slot-list') ? ok([{ ...slots[0], status: 2 }]) : ok(null)
  const full = readyForm()
  await full.submitReservation()
  assert.equal(full.data.selectedSlotId, '')
  assert.equal(calls.filter((options) => options.path.endsWith('/create')).length, 0)
  assert.match(notices.at(-1), /不可预约/)
})

test('backend duplicate error is preserved when no active booking is recovered', async () => {
  const original = respond
  respond = async (options) => {
    if (options.path.endsWith('/create')) return { statusCode: 200, data: { code: 1011002, msg: '该手机号已经预约' } }
    if (options.path.includes('/list-by-phone')) return ok([])
    return original(options)
  }
  const instance = readyForm()
  await instance.submitReservation()
  await settlePages()
  assert.equal(instance.data.view, 'main')
  assert.equal(notices.at(-1), '该手机号已经预约')
})

test('cancel uses stored booking id and phone, clears only after backend true', async () => {
  const instance = readyForm()
  instance.applyReservation(api.normalizeBooking(booking))
  instance.setData({ view: 'success', phone: '13900139000' })
  instance.cancelReservation()
  await Promise.all([instance.confirmCancelReservation(), instance.confirmCancelReservation()])
  const cancels = calls.filter((options) => options.path.endsWith('/cancel'))
  assert.equal(cancels.length, 1)
  assert.deepEqual(cancels[0].data, { id: booking.id, phone: booking.userPhone })
  assert.equal(instance.data.view, 'main')
  assert.equal(instance.data.selectedSlotId, '')
  assert.equal(app.globalData.reservation, null)
  assert.equal(storage.get(localState.profileKey).phone, booking.userPhone)
  assert.equal(localState.getBookingReference(), null)
})

test('failed cancellation keeps the reservation and permits retry', async () => {
  respond = async () => ok(false)
  const instance = readyForm()
  instance.applyReservation(api.normalizeBooking(booking))
  instance.setData({ view: 'success' })
  instance.cancelReservation()
  await instance.confirmCancelReservation()
  assert.equal(activePage().data.view, 'success')
  assert.equal(instance.data.showCancelDialog, true)
  assert.equal(instance.data.isCancelling, false)
  assert.equal(app.globalData.reservation.id, booking.id)
})

test('discovering an active booking removes home; detail taps open one child and return to the root list', async () => {
  const form = readyForm()
  await form.openMyBookings()
  await settlePages()
  const details = activePage()
  assert.equal(details.data.view, 'bookings')
  assert.equal(details.data.isBookingRoot, true)
  assert.equal(form.destroyed, true)
  assert.equal(pageStack.length, 1)
  assert.equal(details.data.bookings.length, 1)
  await details.viewBooking(event({id: booking.id}))
  await details.viewBooking(event({id: booking.id}))
  await settlePages()
  assert.equal(pageStack.length, 2)
  assert.equal(activePage().data.view, 'success')
  assert.equal(activePage().data.reservation.id, booking.id)
  assert.equal(details.data.view, 'bookings')
  wx.navigateBack()
  await settlePages()
  assert.equal(activePage(), details)
  await details.viewBooking(event({id: booking.id}))
  await settlePages()
  assert.equal(pageStack.length, 2)
  wx.navigateBack()
  await settlePages()
  assert.equal(activePage(), details)
})

test('my bookings loads saved booking identity even when the form phone is empty or changed', async () => {
  storage.set(localState.bookingKey, {id: booking.id, phone: booking.userPhone})
  const form = page()
  form.setData({phone: '13900139000'})
  await form.openMyBookings()
  await settlePages()
  assert.equal(activePage().data.bookingPhone, booking.userPhone)
  assert.ok(calls.some(options => options.path.endsWith('/list-by-phone?phone=' + booking.userPhone)))
  wx.navigateBack()
  storage.clear()
  storage.set(localState.profileKey, {phone: booking.userPhone})
  app.globalData.reservation = null
  const fresh = page()
  await fresh.openMyBookings()
  await settlePages()
  assert.equal(activePage().data.bookings.length, 1)
  assert.equal(activePage().data.bookingPhone, booking.userPhone)
})

test('my bookings automatically discovers identity and shows an empty result for a new visitor', async () => {
  const form = page()
  await form.openMyBookings()
  await settlePages()
  assert.equal(activePage().data.hasQueriedBookings, true)
  assert.deepEqual(activePage().data.bookings, [])
  assert.equal(activePage().data.isLoadingBookings, false)
  assert.equal(activePage().data.bookingError, '')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].path.endsWith('/get-by-openid'))
  wx.navigateBack()
  const original = respond
  respond = async options => options.path.endsWith('/get-by-openid') ? ok(booking) : original(options)
  await form.openMyBookings()
  await settlePages()
  assert.equal(activePage().data.bookings.length, 1)
  assert.equal(activePage().data.bookingPhone, booking.userPhone)
})

test('my bookings distinguishes lookup failures from empty results and supports retry', async () => {
  const pending = deferred()
  respond = () => pending.promise
  const form = page()
  await form.openMyBookings()
  const details = activePage()
  assert.equal(details.data.isLoadingBookings, true)
  assert.equal(details.data.hasQueriedBookings, false)
  pending.resolve({statusCode: 503, data: {}})
  await settlePages()
  assert.ok(details.data.bookingError)
  assert.equal(details.data.hasQueriedBookings, false)
  assert.equal(details.data.isLoadingBookings, false)
  respond = async () => ok(null)
  await details.queryBookings()
  assert.equal(details.data.bookingError, '')
  assert.equal(details.data.hasQueriedBookings, true)
})

test('startup falls back to server-verified cached id/phone when backend requires query openid', async () => {
  storage.set(localState.bookingKey, { id: booking.id, phone: booking.userPhone })
  const original = respond
  respond = async (options) => options.path.endsWith('/get-by-openid')
    ? { statusCode: 400, data: { code: 400, msg: 'Required request parameter openid is not present' } }
    : original(options)
  const instance = page()
  await instance.initialize()
  await settlePages()
  assert.equal(activePage().data.isBookingRoot, true)
  assert.equal(activePage().data.reservation.id, booking.id)
  assert.ok(calls.some((options) => options.path.includes(`/booking/get?id=${booking.id}&phone=${booking.userPhone}`)))
})

test('cancelled bookings restore the form; failed booking lookups show retry state and block submission', async () => {
  storage.set(localState.bookingKey, { id: booking.id, phone: booking.userPhone })
  const original = respond
  respond = async (options) => options.path.includes('/booking/get?') ? ok({ ...booking, status: 1 })
    : options.path.includes('/list-by-phone') ? ok([{ ...booking, status: 1 }]) : original(options)
  const instance = page()
  await instance.initialize()
  await settlePages()
  assert.equal(instance.data.view, 'main')
  assert.equal(instance.data.activeReservation, null)
  assert.equal(localState.getBookingReference(), null)
  storage.set(localState.bookingKey, { id: booking.id, phone: booking.userPhone })
  respond = async (options) => {
    if (options.path.includes('/booking/get?') || options.path.includes('/list-by-phone')) throw new Error('network unavailable')
    return original(options)
  }
  await instance.initialize()
  await settlePages()
  assert.equal(instance.data.view, 'error')
  assert.match(instance.data.bookingLookupError, /无法确认预约状态/)
  assert.ok(localState.getBookingReference())
  const requestCount = calls.length
  await instance.submitReservation()
  assert.equal(calls.length, requestCount)
  assert.equal(notices.at(-1), '请先确认预约状态')
  respond = async options => options.path.endsWith('/get-by-openid') ? ok(booking) : original(options)
  await instance.refreshHomeBooking()
  assert.equal(instance.data.bookingLookupError, '')
  assert.equal(instance.data.activeReservation.id, booking.id)
})

test('viewing a historical booking preserves a different active booking reference', () => {
  const instance = readyForm()
  instance.applyReservation(api.normalizeBooking(booking))
  instance.applyReservation(api.normalizeBooking({ ...booking, id: 'history', status: 2 }))
  assert.equal(app.globalData.reservation.id, booking.id)
  assert.equal(localState.getBookingReference().id, booking.id)
})

test('older detail responses cannot overwrite a newly selected booking', async () => {
  const first = deferred()
  const second = deferred()
  const historical = { ...booking, id: 'history', status: 2 }
  respond = (options) => options.path.includes('id=history') ? second.promise : first.promise
  const instance = readyForm()
  instance.applyReservation(api.normalizeBooking(booking))
  const firstRefresh = instance.refreshReservation()
  instance.applyReservation(api.normalizeBooking(historical))
  const secondRefresh = instance.refreshReservation()
  second.resolve(ok(historical))
  await secondRefresh
  first.resolve(ok(booking))
  await firstRefresh
  assert.equal(activePage().data.reservation.id, 'history')
  assert.equal(instance.data.isRefreshing, false)
  assert.equal(app.globalData.reservation.id, booking.id)
})

test('first-time visitors can book when the legacy openid query is required', async () => {
  const original = respond
  respond = async (options) => options.path.endsWith('/get-by-openid')
    ? { statusCode: 400, data: { code: 400, msg: 'Required request parameter openid is not present' } }
    : original(options)
  const instance = page()
  await instance.initialize()
  await settlePages()
  assert.equal(instance.data.view, 'main')
  instance.setData({ name: booking.userName, phone: booking.userPhone, dateValue: '2099-12-20', selectedSlotId: slots[0].id, selectedTime: '13:00-14:00', consented: true })
  await instance.submitReservation()
  await settlePages()
  assert.equal(activePage().data.view, 'success')
  const create = calls.find((options) => options.path.endsWith('/create'))
  assert.equal(Object.hasOwn(create.data, 'openid'), false)
})

test('address opens the default venue in the native map and prevents repeated taps until completion', () => {
  const locations = []
  wx.openLocation = (options) => locations.push(options)
  const instance = page()
  instance.openVenueLocation()
  instance.openVenueLocation()
  assert.equal(locations.length, 1)
  const { latitude, longitude, name, address, scale } = locations[0]
  assert.deepEqual({ latitude, longitude, name, address, scale }, {
    latitude: venue.latitude, longitude: venue.longitude, name: venue.name, address: venue.address, scale: 18
  })
  locations[0].complete()
  instance.openVenueLocation()
  assert.equal(locations.length, 2)
})

test('activity coordinates override the venue; a different address never uses the old venue coordinates', () => {
  const custom = { address: '上海市黄浦区测试路88号', storeName: '新场馆', latitude: '31.2304', longitude: '121.4737' }
  assert.deepEqual(getVenueLocation(custom).location, {
    address: custom.address, name: custom.storeName, latitude: 31.2304, longitude: 121.4737
  })
  assert.equal(getVenueLocation({ address: custom.address }).location, null)
})

test('invalid coordinates cannot open a different venue; same-building floor variations keep the verified point', () => {
  for (const [latitude, longitude] of [[null, null], ['', ''], [' ', ' '], [true, false], [91, 121], [31, 181], ['bad', 121], [Infinity, 121], [0, 0], [31, undefined]]) {
    assert.equal(getVenueLocation({ address: '北京市东城区测试路1号', latitude, longitude }).location, null)
  }
  const location = getVenueLocation({ address: '上海 静安区 文安路30号1楼106室' }).location
  assert.equal(location.latitude, venue.latitude)
  assert.equal(location.longitude, venue.longitude)
  assert.equal(location.address, '上海 静安区 文安路30号1楼106室')
})

test('unavailable map offers address copying only after confirmation; cancel is silent and retry remains possible', () => {
  const modals = []
  const copied = []
  wx.showModal = (options) => modals.push(options)
  wx.setClipboardData = (options) => copied.push(options.data)
  const instance = page()
  instance.setData({ activity: { address: '上海市黄浦区测试路88号' } })
  wx.openLocation = () => assert.fail('Missing coordinates must not open a map')
  instance.openVenueLocation()
  assert.equal(modals.length, 1)
  assert.equal(copied.length, 0)
  modals[0].success({ confirm: false })
  assert.equal(copied.length, 0)
  modals[0].success({ confirm: true })
  assert.deepEqual(copied, ['上海市黄浦区测试路88号'])

  instance.setData({ activity: {} })
  wx.openLocation = (options) => { options.fail({ errMsg: 'openLocation:fail cancel' }); options.complete() }
  instance.openVenueLocation()
  assert.equal(modals.length, 1)
  assert.equal(instance.openingLocation, false)
  wx.openLocation = (options) => { options.fail({ errMsg: 'openLocation:fail' }); options.complete() }
  instance.openVenueLocation()
  assert.equal(modals.length, 2)
  assert.equal(instance.openingLocation, false)
  wx.openLocation = () => { throw new Error('unsupported') }
  instance.openVenueLocation()
  assert.equal(modals.length, 3)
  assert.equal(instance.openingLocation, false)
})

test('privacy opens configured HTML or multiline text in a local dialog without changing consent', () => {
  wx.openPrivacyContract = () => assert.fail('Configured policy must remain in the local dialog')
  const instance = page()
  const html = '<p>后台隐私政策</p><p><strong>仅用于活动预约</strong></p>'
  instance.setData({ activity: { privacyPolicy: html }, consented: false })
  instance.openPrivacyPolicy()
  assert.equal(instance.data.showPolicy, true)
  assert.equal(instance.data.policyContent, html)
  assert.equal(instance.data.policyIsRichText, true)
  assert.equal(instance.data.consented, false)
  instance.closePrivacyPolicy()
  assert.equal(instance.data.showPolicy, false)
  assert.equal(instance.data.consented, false)

  instance.setData({ activity: { privacyPolicy: '第一段\n第二段' }, consented: true })
  instance.openPrivacyPolicy()
  assert.equal(instance.data.policyContent, '第一段\n第二段')
  assert.equal(instance.data.policyIsRichText, false)
  instance.closePrivacyPolicy()
  assert.equal(instance.data.consented, true)

  for (const empty of [undefined, null, '', '  ', '<p><br></p>', '<p>&nbsp;</p>']) {
    instance.setData({ activity: { privacyPolicy: empty } })
    instance.openPrivacyPolicy()
    assert.equal(instance.data.showPolicy, true)
    assert.equal(instance.data.policyContent, '')
    instance.closePrivacyPolicy()
  }
})

test('activity contacts preserve configured values and normalize missing or whitespace-only fields as absent', async () => {
  respond = async () => ok({ ...activity, wechat: '  archivismgallery  ', redbook: ' ARCHIVISM 画廊商店 ', email: ' Gallery@archivism.cn ' })
  const configured = await api.getActivity()
  assert.equal(configured.wechat, 'archivismgallery')
  assert.equal(configured.redbook, 'ARCHIVISM 画廊商店')
  assert.equal(configured.email, 'Gallery@archivism.cn')
  respond = async () => ok({ ...activity, wechat: '   ', redbook: null })
  const missing = await api.getActivity()
  assert.equal(missing.wechat, '')
  assert.equal(missing.redbook, '')
  assert.equal(missing.email, '')
})

test('native back discards picker drafts and preserves the mounted form and scroll position', async () => {
  const form = readyForm()
  form.setData({activity: {startDate: '2099-12-20', endDate: '2099-12-21'}, mainScrollTop: 637})
  form.onMainScroll({detail: {scrollTop: 637}})
  const original = respond
  respond = async options => options.path.includes('/month-status')
    ? ok([{date: [2099, 12, 20], status: 0}, {date: [2099, 12, 21], status: 0}])
    : options.path.includes('/slot-list') ? ok([...slots, {...slots[0], id: 'another', startTime: [15, 0], endTime: [16, 0]}]) : original(options)
  const before = structuredClone(form.data)
  for (const type of ['date', 'time']) {
    await form.openPicker(event({picker: type}))
    await settlePages()
    const picker = activePage()
    assert.equal(picker.pageType, type)
    assert.equal(picker.data.name, '')
    assert.equal(picker.data.phone, '')
    if (type === 'date') picker.selectDate(event({value: '2099-12-21'}))
    else picker.selectTime(event({id: 'another'}))
    assert.deepEqual(form.data, before)
    wx.navigateBack()
    assert.equal(activePage(), form)
    assert.deepEqual(form.data, before)
    assert.equal(form.currentScrollTop, 637)
    assert.equal(pageStack.length, 1)
  }
})

test('confirming the existing date preserves its slot and a repeated confirmation cannot pop the form', async () => {
  const form = readyForm()
  form.setData({activity: {startDate: '2099-12-20', endDate: '2099-12-20'}})
  respond = async () => ok([{date: [2099, 12, 20], status: 0}])
  await form.openPicker(event({picker: 'date'}))
  await settlePages()
  const picker = activePage()
  picker.confirmDate()
  picker.confirmDate()
  assert.equal(activePage(), form)
  assert.equal(pageStack.length, 1)
  assert.equal(form.data.selectedSlotId, slots[0].id)
  assert.equal(form.data.selectedTime, '13:00-14:00')
})

test('time picker requires a date; native navigation rejects duplicate taps and can retry after failure', async () => {
  const form = page()
  form.setData({view: 'main', name: '访客', phone: booking.userPhone, consented: true})
  await form.openPicker(event({picker: 'time'}))
  assert.equal(notices.at(-1), '请先选择日期')
  assert.equal(pageStack.length, 1)
  const nativeNavigate = wx.navigateTo
  const navigations = []
  wx.navigateTo = options => navigations.push(options)
  const opening = form.openPicker(event({picker: 'date'}))
  form.openPicker(event({picker: 'date'}))
  assert.equal(navigations.length, 1)
  navigations[0].fail()
  await opening
  assert.equal(form.navigating, false)
  assert.equal(form.data.name, '访客')
  assert.equal(form.data.consented, true)
  wx.navigateTo = nativeNavigate
  await form.openPicker(event({picker: 'date'}))
  await settlePages()
  assert.equal(activePage().pageType, 'date')
})

test('closing a picker ignores late network responses and stale time results cannot replace a new date', async () => {
  const form = readyForm()
  form.setData({activity: {startDate: '2099-12-20', endDate: '2099-12-20'}})
  const pending = deferred()
  respond = () => pending.promise
  await form.openPicker(event({picker: 'date'}))
  const closed = activePage()
  wx.navigateBack()
  pending.resolve(ok([{date: [2099, 12, 20], status: 0}]))
  await settlePages()
  assert.equal(closed.destroyed, true)
  assert.equal(closed.data.hasAvailableDates, false)
  assert.equal(form.data.dateValue, '2099-12-20')
  respond = async () => ok(slots)
  await form.openPicker(event({picker: 'time'}))
  await settlePages()
  const picker = activePage()
  form.applyDateSelection('2099-12-21')
  picker.confirmTime()
  assert.equal(activePage(), form)
  assert.equal(form.data.dateValue, '2099-12-21')
  assert.equal(form.data.selectedSlotId, '')
})

test('subpages entered without an opener or booking bootstrap return to the booking home gate', async () => {
  for (const type of ['date', 'time', 'reservation']) {
    const child = mountPage(type)
    pageStack = [child]
    child.onLoad()
    await settlePages()
    assert.equal(notices.at(-1), '/pages/index/index')
  }
})

test('all routes use native navigation and have no duplicate custom header or navigation offset', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'))
  for (const file of ['project.config.json', 'project.private.config.json']) {
    const project = JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
    assert.equal(project.setting.ignoreDevUnusedFiles, false, file + ': native subpage templates must remain in the development package')
  }
  assert.equal(manifest.window.navigationStyle, 'default')
  assert.equal(manifest.pages.length, 4)
  for (const route of manifest.pages) {
    const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', route + '.json'), 'utf8'))
    assert.equal(settings.navigationStyle, 'default')
    const template = fs.readFileSync(path.join(__dirname, '..', route + '.wxml'), 'utf8')
    assert.doesNotMatch(template, /nav-back|topbar|navTotalHeight|subpage-controls/)
  }
})

test('project has no cloud-function SDK, database, environment or configuration dependency', () => {
  const project = JSON.parse(fs.readFileSync(path.join(__dirname, '../project.config.json'), 'utf8'))
  assert.equal(project.cloudfunctionRoot, undefined)
  assert.equal(fs.existsSync(path.join(__dirname, '../cloudfunctions')), false)
  const sourceFiles = ['app.js', 'config/services.js', 'services/request.js', 'services/tf.js', 'services/local-state.js', 'pages/index/index.js', 'services/booking-page.js', 'pages/index/index.wxml']
  for (const file of sourceFiles) {
    const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    assert.doesNotMatch(content, /callFunction|wx-server-sdk|cloud\.database|cloud1-|getPhoneNumber/)
  }
  assert.equal(config.identityEnvId, undefined)
})

test('every template event handler exists and WXML tags are balanced', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'))
  for (const route of manifest.pages) {
    const template = fs.readFileSync(path.join(__dirname, '..', route + '.wxml'), 'utf8')
    for (const match of template.matchAll(/(?:bind|catch)[\w:]*="([A-Za-z]\w*)"/g)) assert.equal(typeof pageDefinition[match[1]], 'function', match[1])
    const stack = []
    for (const match of template.matchAll(/<(\/?)([\w-]+)\b[^>]*?(\/?)>/g)) {
      const [, closing, tag, selfClosing] = match
      if (closing) assert.equal(stack.pop(), tag)
      else if (!selfClosing) stack.push(tag)
    }
    assert.deepEqual(stack, [])
  }
})
