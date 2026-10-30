const api = require('./tf')
const localState = require('./local-state')
const startupLoading = require('./startup-loading')
const loadSuccessArtwork = require('./success-artwork')
const venue = require('../config/venue')
const { getVenueLocation } = require('./location')

const PAGE_ROUTES = {
  date: '/pages/date/date',
  time: '/pages/time/time',
  success: '/pages/reservation/reservation'
}

function buildMonths(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return []
  const [startYear, startMonth] = startDate.split('-').map(Number)
  const [endYear, endMonth] = endDate.split('-').map(Number)
  const months = []
  for (let value = startYear * 12 + startMonth - 1; value <= endYear * 12 + endMonth - 1; value += 1) {
    const year = Math.floor(value / 12)
    const month = value % 12 + 1
    const key = `${year}-${String(month).padStart(2, '0')}`
    const days = []
    for (let index = 0; index < new Date(year, month - 1, 1).getDay(); index += 1) {
      days.push({ key: `${key}-blank-${index}`, placeholder: true, label: '', disabled: true })
    }
    for (let day = 1; day <= new Date(year, month, 0).getDate(); day += 1) {
      const date = `${key}-${String(day).padStart(2, '0')}`
      days.push({ key: date, value: date, label: day, disabled: true })
    }
    months.push({ key, label: `${year}年${month}月`, days })
  }
  return months
}

function sameId(left, right) {
  return left !== null && left !== undefined && right !== null && right !== undefined && String(left) === String(right)
}

function isActiveBooking(reservation) {
  return !!reservation && reservation.status === 0 && reservation.date >= api.todayInShanghai()
}

const definition = {
  data: {
    view: 'loading',
    showStartupLoading: false,
    startupLoadingFading: false,
    successArtSrc: '',
    successTitleSrc: '',
    mainScrollTop: 0,
    activity: {},
    venueAddress: venue.address,
    visitorCount: 1, visitorCountSelected: false, showVisitorOptions: false, visitorOptions: [],
    name: '',
    phone: '',
    dateValue: '',
    dateText: '',
    draftDateValue: '',
    selectedTime: '',
    selectedSlotId: '',
    draftSlotId: '',
    consented: false,
    isSubmitting: false,
    isCancelling: false,
    isLoadingDates: false,
    isLoadingSlots: false,
    isLoadingBookings: false,
    isRefreshing: false,
    isCheckingBooking: false,
    errorMessage: '',
    dateError: '',
    slotError: '',
    bookingError: '',
    detailError: '',
    bookingLookupError: '',
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    months: [],
    hasAvailableDates: false,
    timeSlots: [],
    bookingPhone: '',
    bookings: [],
    hasQueriedBookings: false,
    isBookingRoot: false,
    reservation: null,
    activeReservation: null,
    showBookingSuccess: false,
    showCancelDialog: false,
    cancelTarget: null,
    showPolicy: false,
    policyContent: '',
    policyIsRichText: false
  },

  onLoad() {
    if (this.pageType === 'main') return this.initialize()
    if (getCurrentPages().length < 2) {
      return wx.reLaunch({ url: '/pages/index/index' })
    }
    const preview = getApp().globalData.detailPreview
    if (this.pageType === 'reservation' && preview) {
      getApp().globalData.detailPreview = null
      this.setData(preview)
    }
    this.openerChannel = this.getOpenerEventChannel()
    this.openerChannel.on('initialize', (data) => {
      if (this.destroyed) return
      this.setData(data)
      this.initialized = true
      if (this.pageType === 'date') return this.loadDates()
      if (this.pageType === 'time') return this.loadSlots()
      this.updateNavigationTitle()
      return this.data.view === 'success' ? this.refreshReservation() : this.queryBookings()
    })
  },

  onShow() {
    const resuming = startupLoading.resume(this)
    const cycle = this.startupLoadingCycle || 0
    const refreshing = this.refreshVisiblePage(resuming)
    if (resuming && this.initialized) {
      return Promise.resolve(refreshing).finally(() => {
        if (cycle === (this.startupLoadingCycle || 0)) return startupLoading.finish(this)
      })
    }
    return refreshing
  },

  refreshVisiblePage(resuming = false) {
    this.navigating = false
    const openedPage = this.openedPage
    this.openedPage = null
    if (resuming && !this.initialized && this.pageType === 'main') return this.initialize()
    if (resuming && this.initialized && this.pageType === 'date') return this.loadDates()
    if (resuming && this.initialized && this.pageType === 'time') return this.loadSlots()
    if (this.initialized && this.pageType === 'main' && this.data.view === 'bookings') {
      const sameForeground = this.detailForegroundVersion === (getApp().globalData.foregroundVersion || 0)
      const confirmedBooking = openedPage === 'success' && sameForeground
        ? this.data.bookings.find(item => sameId(item.id, this.confirmedBookingId) && isActiveBooking(item) && item.canCancel) : null
      this.confirmedBookingId = null
      const returningFromDetails = openedPage === 'success'
        && sameForeground
        && !this.resumeBookingsQuery
      this.resumeBookingsQuery = false
      this.updateNavigationTitle()
      if (returningFromDetails) return
      this.setData({ showBookingSuccess: false })
      return this.queryBookings({ confirmedBooking, skipIdentityCheck: !!confirmedBooking })
    }
    if (this.initialized && this.pageType === 'main') {
      const current = getApp().globalData.reservation
      // 日期、时段子页返回时保留原表单。
      const returningToForm = openedPage === 'date' || openedPage === 'time' || openedPage === 'bookings'
      const shouldCheck = !returningToForm && !this.data.isSubmitting
      this.setData({ activeReservation: isActiveBooking(current) ? current : null,
        ...(shouldCheck ? { view: 'loading', isCheckingBooking: true } : {}) })
      if (shouldCheck) return this.refreshHomeBooking()
    }
    if (this.initialized && this.pageType === 'reservation' && this.data.view === 'success') return this.refreshReservation()
  },

  onStartupArtReady() {
    startupLoading.artReady(this)
  },

  onHomeCoverReady(event) {
    startupLoading.homeCoverReady(this, event.currentTarget.dataset.src)
  },

  onHide() {
    startupLoading.cancel(this)
    this.refreshRequestId = (this.refreshRequestId || 0) + 1
    if (this.data.isRefreshing) this.setData({ isRefreshing: false })
    if (this.data.view === 'bookings') {
      this.homeBookingRequestId = (this.homeBookingRequestId || 0) + 1
      this.bookingListRequestId = (this.bookingListRequestId || 0) + 1
      this.setData({ isLoadingBookings: false })
      return
    }
    if (this.pageType !== 'main') return
    this.homeBookingRequestId = (this.homeBookingRequestId || 0) + 1
    this.setData({ isCheckingBooking: false })
  },

  updateNavigationTitle() {
    const title = this.data.view === 'success' ? '预约详情' : this.data.view === 'bookings' ? '我的预约'
      : (this.data.activity.name || this.data.activity.nameEn || "Collector's Room 02")
    wx.setNavigationBarTitle({ title })
  },

  navigatePage(view, extra = {}, onOpened) {
    if (this.navigating || this.destroyed) return Promise.resolve(false)
    this.navigating = true
    const page = view === 'date' || view === 'time' ? view : 'reservation'
    const { activity, dateValue, dateText, selectedSlotId, selectedTime, reservation } = this.data
    const data = { activity, dateValue, dateText, selectedSlotId, selectedTime,
      ...(page === 'reservation' ? { reservation, successArtSrc: this.data.successArtSrc, successTitleSrc: this.data.successTitleSrc } : {}),
      draftDateValue: dateValue, draftSlotId: selectedSlotId, view, ...extra }
    if (view === 'success') {
      getApp().globalData.detailPreview = data
      this.detailForegroundVersion = getApp().globalData.foregroundVersion || 0
      this.resumeBookingsQuery = this.data.isLoadingBookings
    }
    return new Promise(resolve => {
      wx.navigateTo({
        url: PAGE_ROUTES[view],
        events: {
          reservationUpdated: (reservation) => {
            if (this.destroyed || !data.reservation || !sameId(data.reservation.id, reservation.id)) return
            const previous = this.data.bookings.find(item => sameId(item.id, reservation.id))
            if (!previous || JSON.stringify(previous) === JSON.stringify(reservation)) return
            this.setData({ bookings: this.data.bookings.map(item => sameId(item.id, reservation.id) ? reservation : item),
              ...(this.data.reservation && sameId(this.data.reservation.id, reservation.id) ? { reservation } : {}) })
          },
          dateConfirmed: ({ dateValue }) => { if (!this.destroyed) this.applyDateSelection(dateValue) },
          timeConfirmed: (selection) => {
            if (this.destroyed || selection.dateValue !== this.data.dateValue) return
            this.setData({ selectedSlotId: selection.id, selectedTime: selection.value, draftSlotId: selection.id })
          }
        },
        success: ({ eventChannel }) => {
          this.openedPage = view
          if (onOpened) onOpened()
          eventChannel.emit('initialize', data)
          resolve(true)
        },
        fail: () => {
          if (getApp().globalData.detailPreview === data) getApp().globalData.detailPreview = null
          this.navigating = false; this.toast('页面打开失败，请重试'); resolve(false)
        }
      })
    })
  },

  showBookingList(bookingCreated = false) {
    if (this.pageType === 'main') return this.enterBookingRoot(bookingCreated)
    this.setData({ view: 'bookings', showBookingSuccess: bookingCreated })
    this.updateNavigationTitle()
    return this.queryBookings()
  },

  async showConfirmedBooking() {
    let returnPageReady
    const opened = await this.navigatePage('success', {}, () => {
      if (this.destroyed || this.pageType !== 'main') return
      const reservation = this.data.reservation
      this.confirmedBookingId = reservation.id
      this.resumeBookingsQuery = true
      // 详情入栈后预先渲染返回目标，原生返回动画不能露出已清空的表单。
      // 此处只更新隐藏页的数据，不修改当前详情页的原生导航标题。
      returnPageReady = new Promise(resolve => this.setData({
        view: 'bookings', isBookingRoot: true, bookingPhone: reservation.phone,
        bookings: [reservation], hasQueriedBookings: true, bookingError: '',
        isLoadingBookings: false, isCheckingBooking: false, showBookingSuccess: false
      }, resolve))
    })
    // 原生页面打开失败时仍保留已确认预约，提供列表中的详情重试入口。
    if (!opened && !this.destroyed) return this.showBookingList(true)
    if (returnPageReady) await returnPageReady
    return opened
  },

  async enterBookingRoot(bookingCreated = false) {
    if (this.destroyed) return false
    const reservation = getApp().globalData.reservation
    if (!isActiveBooking(reservation)) return false
    if (this.pageType !== 'main') {
      const home = getCurrentPages().find(page => page.pageType === 'main')
      if (!home) return wx.reLaunch({ url: '/pages/index/index' })
      await home.enterBookingRoot(bookingCreated)
      if (!this.destroyed) wx.navigateBack({ delta: getCurrentPages().length - 1 })
      return true
    }
    this.setData({ view: 'bookings', isBookingRoot: true, bookingPhone: reservation.phone,
      showBookingSuccess: bookingCreated, bookings: bookingCreated ? [reservation] : [],
      hasQueriedBookings: bookingCreated })
    this.updateNavigationTitle()
    this.bookingListPromise = this.queryBookings({ confirmedBooking: bookingCreated ? reservation : null, skipIdentityCheck: true })
    if (!bookingCreated) await this.bookingListPromise
    return true
  },

  async returnToHome() {
    if (this.pageType !== 'main') {
      const home = getCurrentPages().find(page => page.pageType === 'main')
      if (!home) return wx.reLaunch({ url: '/pages/index/index' })
      await home.returnToHome()
      if (!this.destroyed) wx.navigateBack({ delta: getCurrentPages().length - 1 })
      return true
    }
    this.confirmedBookingId = null
    this.homeBookingRequestId = (this.homeBookingRequestId || 0) + 1
    this.bookingListRequestId = (this.bookingListRequestId || 0) + 1
    this.setData({ view: 'main', isBookingRoot: false, isLoadingBookings: false, isCheckingBooking: false,
      activeReservation: null, reservation: null, bookingPhone: '', bookings: [], hasQueriedBookings: false,
      bookingError: '', bookingLookupError: '', showBookingSuccess: false })
    this.clearReservationForm()
    this.updateNavigationTitle()
    await startupLoading.finish(this)
    return true
  },

  onUnload() {
    this.destroyed = true
    startupLoading.cancel(this)
    this.dateRequestId = (this.dateRequestId || 0) + 1
    this.slotRequestId = (this.slotRequestId || 0) + 1
    this.refreshRequestId = (this.refreshRequestId || 0) + 1
    this.homeBookingRequestId = (this.homeBookingRequestId || 0) + 1
  },

  async initialize() {
    if (this.initializing) return
    this.initializing = true
    if (this.startupLoadingStartedAt === undefined) this.startupLoadingStartedAt = Date.now()
    this.setData({ view: 'loading', errorMessage: '' })
    try {
      const activity = await api.getActivity()
      if (this.destroyed) return
      const user = localState.getProfile()
      this.setData({ activity, months: buildMonths(activity.startDate, activity.endDate), bookingLookupError: '' })
      this.prepareSuccessArtwork()
      this.updateNavigationTitle()
      getApp().globalData.user = user
      this.initialized = true
      this.setData({ isCheckingBooking: true })
      await this.refreshHomeBooking()
    } catch (error) {
      if (!this.destroyed) this.setData({ view: 'error', errorMessage: this.friendlyError(error, '暂时无法连接预约服务，请稍后重试。') })
    } finally {
      this.initializing = false
      if (this.data.view === 'error') await startupLoading.finish(this)
    }
  },

  retryInitialize() {
    return this.initialized ? this.refreshHomeBooking() : this.initialize()
  },

  async lookupActiveBooking(requestId) {
    const active = await api.getActiveBooking()
    if (this.destroyed || requestId !== this.homeBookingRequestId) return null
    return isActiveBooking(active) ? active : null
  },

  async refreshHomeBooking() {
    if (this.pageType !== 'main' || this.destroyed || this.data.isSubmitting) return
    const requestId = this.homeBookingRequestId = (this.homeBookingRequestId || 0) + 1
    this.setData({ view: 'loading', isCheckingBooking: true, bookingLookupError: '', errorMessage: '' })
    try {
      const reservation = await this.lookupActiveBooking(requestId)
      if (this.destroyed || requestId !== this.homeBookingRequestId) return
      if (reservation) {
        const previous = this.data.activeReservation
        this.applyReservation(reservation)
        if (!previous || !sameId(previous.id, reservation.id)) this.clearReservationForm()
        await this.enterBookingRoot()
      } else {
        getApp().globalData.reservation = null
        this.setData({ view: 'main', isBookingRoot: false, activeReservation: null, reservation: null })
        this.updateNavigationTitle()
      }
    } catch (error) {
      if (!this.destroyed && requestId === this.homeBookingRequestId) {
        const message = '暂时无法确认预约状态，请重新加载。'
        this.setData({ view: 'error', bookingLookupError: message, errorMessage: message })
      }
    } finally {
      if (!this.destroyed && requestId === this.homeBookingRequestId) {
        if (this.data.view === 'main' || this.data.view === 'error') await startupLoading.finish(this)
        if (!this.destroyed && requestId === this.homeBookingRequestId) this.setData({ isCheckingBooking: false })
      }
    }
  },

  saveProfile(name, phone) {
    const user = { name, phone }
    getApp().globalData.user = user
    localState.saveProfile(user)
  },

  prepareSuccessArtwork() {
    const key = JSON.stringify([this.data.activity.successUrl, this.data.activity.titleUrl])
    if (this.successArtworkKey === key) return this.successArtworkPromise
    this.successArtworkKey = key
    this.successArtworkPromise = loadSuccessArtwork(this.data.activity).then(artwork => {
      if (!this.destroyed && this.successArtworkKey === key) this.setData(artwork)
      return artwork
    })
    return this.successArtworkPromise
  },

  applyReservation(reservation) {
    const current = getApp().globalData.reservation
    if (reservation.canCancel) {
      getApp().globalData.reservation = reservation
      localState.saveBookingReference(reservation)
    } else {
      if (current && sameId(current.id, reservation.id)) getApp().globalData.reservation = null
      localState.clearBookingReference(reservation.id)
    }
    // 预约详情与表单草稿分开保存，刷新详情不能回填已清空的表单。
    this.setData({ reservation, detailError: '', ...(this.pageType === 'main' ? {
      activeReservation: isActiveBooking(getApp().globalData.reservation) ? getApp().globalData.reservation : null
    } : {}) })
    this.saveProfile(reservation.name, reservation.phone)
  },

  clearReservationForm() {
    this.dateRequestId = (this.dateRequestId || 0) + 1
    this.slotRequestId = (this.slotRequestId || 0) + 1
    this.currentScrollTop = 0
    this.formScrollTop = 0
    this.setData({
      visitorCount: 1, visitorCountSelected: false, showVisitorOptions: false, name: '', phone: '', dateValue: '', dateText: '', selectedTime: '', selectedSlotId: '',
      draftDateValue: '', draftSlotId: '', consented: false, timeSlots: [],
      dateError: '', slotError: '', bookingLookupError: '', isLoadingDates: false, isLoadingSlots: false,
      mainScrollTop: 0, showPolicy: false, policyContent: '', policyIsRichText: false
    })
    if (this.pageType === 'main' && !this.data.isSubmitting) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  friendlyError(error, fallback) {
    return error && error.message ? error.message : fallback
  },

  toast(message) {
    wx.showToast({ title: message, icon: 'none' })
  },

  onPageScroll(event) {
    if (this.pageType === 'main') this.currentScrollTop = event.scrollTop
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    if (!['name', 'phone'].includes(field) || this.data.isSubmitting) return
    this.setData({ [field]: event.detail.value })
  },

  openPicker(event) {
    if (this.data.isSubmitting || this.navigating || this.data.isCheckingBooking || this.data.bookingLookupError || this.data.activeReservation) return
    const picker = event.currentTarget.dataset.picker
    if (picker !== 'date' && picker !== 'time') return
    if (picker === 'time' && !this.data.dateValue) return this.toast('请先选择日期')
    this.formScrollTop = this.currentScrollTop ?? this.data.mainScrollTop
    return this.navigatePage(picker)
  },

  async loadDates() {
    const requestId = this.dateRequestId = (this.dateRequestId || 0) + 1
    const { activity } = this.data
    const months = buildMonths(activity.startDate, activity.endDate)
    this.setData({ isLoadingDates: true, dateError: '', months, hasAvailableDates: false })
    try {
      if (!months.length) throw new Error('活动尚未设置开放日期')
      const statuses = await Promise.all(months.map((month) => api.getMonthStatus(month.key)))
      if (this.destroyed || requestId !== this.dateRequestId) return
      const today = api.todayInShanghai()
      const available = []
      const nextMonths = months.map((month, index) => {
        const byDate = {}
        statuses[index].forEach((day) => { byDate[day.date] = day })
        return { ...month, days: month.days.map((day) => {
          if (day.placeholder) return day
          const record = byDate[day.value]
          const disabled = !record || record.status !== 0 || day.value < activity.startDate || day.value > activity.endDate || day.value < today
          if (!disabled) available.push(day.value)
          return { ...day, disabled, status: record ? record.status : 1 }
        }) }
      })
      this.setData({ months: nextMonths, hasAvailableDates: available.length > 0, draftDateValue: available.includes(this.data.draftDateValue) ? this.data.draftDateValue : '' })
    } catch (error) {
      if (!this.destroyed && requestId === this.dateRequestId) this.setData({ dateError: this.friendlyError(error, '日期加载失败，请重试。'), draftDateValue: '' })
    } finally {
      if (!this.destroyed && requestId === this.dateRequestId) this.setData({ isLoadingDates: false })
    }
  },

  returnToForm() {
    if (this.data.isBookingRoot) return this.queryBookings()
    if (this.pageType !== 'main') return wx.navigateBack({ delta: 1 })
    const scrollTop = this.formScrollTop ?? 0
    this.currentScrollTop = scrollTop
    this.setData({ view: 'main', mainScrollTop: scrollTop })
    this.updateNavigationTitle()
    wx.pageScrollTo({ scrollTop, duration: 0 })
  },

  selectDate(event) {
    if (this.data.isLoadingDates || this.data.dateError) return
    const value = event.currentTarget.dataset.value
    const available = this.data.months.some((month) => month.days.some((day) => day.value === value && !day.disabled && !day.placeholder))
    if (available) this.setData({ draftDateValue: value })
  },

  confirmDate() {
    if (this.confirmingSelection || this.data.isLoadingDates || this.data.dateError) return
    const dateValue = this.data.draftDateValue
    const available = this.data.months.some(month => month.days.some(day => day.value === dateValue && !day.disabled && !day.placeholder))
    if (!available) return this.toast('请选择可预约日期')
    this.confirmingSelection = true
    this.openerChannel.emit('dateConfirmed', { dateValue })
    wx.navigateBack({ delta: 1, fail: () => { this.confirmingSelection = false } })
  },

  applyDateSelection(dateValue) {
    const changed = dateValue !== this.data.dateValue
    this.slotRequestId = (this.slotRequestId || 0) + 1
    this.setData({
      dateValue, dateText: api.formatDate(dateValue), draftDateValue: dateValue,
      ...(changed ? { selectedTime: '', selectedSlotId: '', draftSlotId: '', timeSlots: [] } : {})
    })
  },

  async loadSlots() {
    const date = this.data.dateValue
    if (!date) return
    const requestId = this.slotRequestId = (this.slotRequestId || 0) + 1
    this.setData({ isLoadingSlots: true, slotError: '', timeSlots: [] })
    try {
      const timeSlots = await api.getSlots(date)
      if (this.destroyed || requestId !== this.slotRequestId || date !== this.data.dateValue) return
      const chosen = timeSlots.find((slot) => sameId(slot.id, this.data.draftSlotId) && !slot.disabled)
      const selected = timeSlots.find((slot) => sameId(slot.id, this.data.selectedSlotId) && !slot.disabled)
      this.setData({ timeSlots, draftSlotId: chosen ? chosen.id : '', ...(!selected ? { selectedSlotId: '', selectedTime: '' } : {}) })
    } catch (error) {
      if (!this.destroyed && requestId === this.slotRequestId) this.setData({ slotError: this.friendlyError(error, '时段加载失败，请重试。'), draftSlotId: '' })
    } finally {
      if (!this.destroyed && requestId === this.slotRequestId) this.setData({ isLoadingSlots: false })
    }
  },

  selectTime(event) {
    if (this.data.isLoadingSlots || this.data.slotError) return
    const slot = this.data.timeSlots.find((item) => sameId(item.id, event.currentTarget.dataset.id) && !item.disabled)
    if (slot) this.setData({ draftSlotId: slot.id })
  },

  confirmTime() {
    if (this.confirmingSelection || this.data.isLoadingSlots || this.data.slotError) return
    const slot = this.data.timeSlots.find(item => sameId(item.id, this.data.draftSlotId) && !item.disabled)
    if (!slot) return this.toast('请选择可预约时段')
    this.confirmingSelection = true
    this.openerChannel.emit('timeConfirmed', { dateValue: this.data.dateValue, id: slot.id, value: slot.value })
    wx.navigateBack({ delta: 1, fail: () => { this.confirmingSelection = false } })
  },

  toggleConsent() {
    if (this.data.isSubmitting) return
    this.setData({ consented: !this.data.consented })
  },

  openPrivacyPolicy() {
    const configured = this.data.activity.privacyPolicy
    const content = typeof configured === 'string' ? configured.trim() : ''
    const hasContent = !!content.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|\s/gi, '') || /<img\b/i.test(content)
    this.setData({
      showPolicy: true,
      policyContent: hasContent ? content : '',
      policyIsRichText: /<\/?[a-z][^>]*>/i.test(content)
    })
  },

  closePrivacyPolicy() {
    this.setData({ showPolicy: false })
  },

  toggleVisitorOptions() {
    if (this.data.isSubmitting) return
    this.setData({ showVisitorOptions: !this.data.showVisitorOptions,
      visitorOptions: Array.from({ length: this.data.activity.maxVisitorCount || 5 }, (_, index) => index + 1) })
  },

  closeVisitorOptions() {
    this.setData({ showVisitorOptions: false })
  },

  selectVisitorCount(event) {
    if (this.data.isSubmitting) return
    const count = Number(event.currentTarget.dataset.count)
    if (!Number.isInteger(count) || count < 1 || count > (this.data.activity.maxVisitorCount || 5)) return
    this.setData({ visitorCount: count, visitorCountSelected: true, showVisitorOptions: false })
  },

  async submitReservation() {
    if (this.data.isSubmitting) return
    if (this.data.isCheckingBooking || this.data.bookingLookupError) return this.toast('请先确认预约状态')
    if (this.data.consented !== true) return this.toast('请阅读并同意隐私说明')
    const { name, phone, dateValue, selectedSlotId, visitorCount } = this.data
    const current = getApp().globalData.reservation
    if (current && current.canCancel) {
      this.applyReservation(current)
      this.clearReservationForm()
      await this.showConfirmedBooking()
      return this.toast('您已有有效预约')
    }
    if (!name.trim()) return this.toast('请填写姓名')
    if (!/^1\d{10}$/.test(phone.trim())) return this.toast('请填写正确的手机号码')
    if (!Number.isInteger(visitorCount) || visitorCount < 1 || visitorCount > (this.data.activity.maxVisitorCount || 5)) return this.toast('请选择有效的到访人数')
    if (!dateValue) return this.toast('请选择日期')
    if (selectedSlotId === '' || selectedSlotId === null || selectedSlotId === undefined) return this.toast('请选择时间')
    this.setData({ isSubmitting: true })
    wx.showLoading({ title: '正在提交', mask: true })
    try {
      const slots = await api.getSlots(dateValue)
      const slot = slots.find((item) => sameId(item.id, selectedSlotId) && !item.disabled)
      if (!slot) {
        this.setData({ selectedTime: '', selectedSlotId: '' })
        throw new Error('该时段已不可预约，请重新选择时间')
      }
      const cleanName = name.trim()
      const cleanPhone = phone.trim()
      const id = await api.createBooking({ name: cleanName, phone: cleanPhone, visitorCount, date: dateValue, slotId: slot.id })
      if (id === null || id === undefined || id === '') throw new Error('预约服务未返回预约编号，请查询我的预约确认结果')
      // 创建成功即锁定当前预约，详情查询失败不能让用户重复提交。
      const reservation = api.normalizeBooking({ id, userName: cleanName, userPhone: cleanPhone, visitorCount, bookingDate: dateValue, slotStartTime: slot.value.split('-')[0], slotEndTime: slot.value.split('-')[1], status: 0 })
      if (this.destroyed) return
      this.applyReservation(reservation)
      this.clearReservationForm()
      await this.showConfirmedBooking()
    } catch (error) {
      if (this.destroyed) return
      // 包含超时等结果未知的情形：先向后端确认是否已经创建。
      const recovered = await this.recoverActiveBooking(phone.trim())
      if (!recovered) this.toast(this.friendlyError(error, '提交失败，请稍后重试。'))
    } finally {
      wx.hideLoading()
      if (!this.destroyed) this.setData({ isSubmitting: false })
    }
  },

  async recoverActiveBooking(phone) {
    try {
      let reservation = null
      try {
        reservation = await api.getActiveBooking()
      } catch (error) {
        // 提交结果未知时，继续按本次提交的手机号确认是否已创建。
      }
      if (!reservation || !reservation.canCancel) {
        const reservations = await api.listBookings(phone)
        reservation = reservations.find((record) => record && record.canCancel)
      }
      if (!reservation || this.destroyed) return false
      this.applyReservation(reservation)
      this.clearReservationForm()
      await this.showConfirmedBooking()
      return true
    } catch (error) {
      return false
    }
  },

  async refreshReservation() {
    const current = this.data.reservation
    if (!current || (this.data.isRefreshing && sameId(this.refreshingBookingId, current.id))) return
    const requestId = this.refreshRequestId = (this.refreshRequestId || 0) + 1
    this.refreshingBookingId = current.id
    this.setData({ isRefreshing: true, detailError: '' })
    try {
      const reservation = await api.getBooking(current.id, current.phone)
      if (this.destroyed || requestId !== this.refreshRequestId || !this.data.reservation || !sameId(this.data.reservation.id, current.id)) return
      if (!reservation) throw new Error('未查询到该预约，请稍后刷新或查看我的预约')
      this.applyReservation(reservation)
      if (this.openerChannel) this.openerChannel.emit('reservationUpdated', reservation)
    } catch (error) {
      if (!this.destroyed && requestId === this.refreshRequestId) this.setData({ detailError: this.friendlyError(error, '预约已提交，详情加载失败，请刷新。') })
    } finally {
      if (!this.destroyed && requestId === this.refreshRequestId) this.setData({ isRefreshing: false })
    }
  },

  openMyBookings() {
    if (this.data.isSubmitting || this.data.isCancelling || this.data.isLoadingBookings) return
    this.formScrollTop = this.currentScrollTop ?? this.data.mainScrollTop
    const current = getApp().globalData.reservation
    const reference = localState.getBookingReference()
    const profile = localState.getProfile()
    const bookingPhone = [current && current.phone, reference && reference.phone, profile.phone, this.data.phone]
      .map((value) => String(value || '').trim())
      .find((value) => /^1\d{10}$/.test(value)) || ''
    this.setData({ view: 'bookings', bookingPhone, isBookingRoot: false })
    this.updateNavigationTitle()
    return this.queryBookings()
  },

  async queryBookings({ confirmedBooking = null, skipIdentityCheck = false } = {}) {
    if (this.data.isLoadingBookings) return
    const bookingRequestId = this.bookingListRequestId = (this.bookingListRequestId || 0) + 1
    this.setData({ isLoadingBookings: true, bookingError: '',
      ...(confirmedBooking ? {} : { bookings: [], hasQueriedBookings: false }) })
    try {
      if (this.data.isBookingRoot && !skipIdentityCheck) {
        const requestId = this.homeBookingRequestId = (this.homeBookingRequestId || 0) + 1
        const active = await this.lookupActiveBooking(requestId)
        if (this.destroyed || bookingRequestId !== this.bookingListRequestId) return
        if (!active) {
          getApp().globalData.reservation = null
          return await this.returnToHome()
        }
        this.applyReservation(active)
        this.setData({ bookingPhone: active.phone })
      }
      let phone = this.data.bookingPhone
      if (!phone) {
        const active = await api.getActiveBooking()
        if (this.destroyed || bookingRequestId !== this.bookingListRequestId) return
        if (!active) {
          this.setData({ hasQueriedBookings: true })
          return
        }
        phone = active.phone
        if (!/^1\d{10}$/.test(phone)) throw new Error('暂时无法获取预约信息，请稍后重试。')
        this.setData({ bookingPhone: phone })
      }
      const bookings = await api.listBookings(phone)
      if (this.destroyed || bookingRequestId !== this.bookingListRequestId) return
      // The create response is authoritative even if the list endpoint has not caught up yet.
      if (confirmedBooking && !bookings.some(item => sameId(item.id, confirmedBooking.id))) bookings.unshift(confirmedBooking)
      const active = bookings.find(isActiveBooking)
      if (active && !this.data.isBookingRoot) {
        this.applyReservation(active)
        if (this.pageType === 'main') {
          this.setData({ view: 'bookings', isBookingRoot: true, bookingPhone: active.phone, bookings, hasQueriedBookings: true })
          this.updateNavigationTitle()
          return
        }
        return await this.enterBookingRoot()
      }
      this.setData({ bookings, hasQueriedBookings: true })
    } catch (error) {
      if (!this.destroyed && bookingRequestId === this.bookingListRequestId) this.setData({ bookingError: this.friendlyError(error, '查询失败，请重试。') })
    } finally {
      if (!this.destroyed && bookingRequestId === this.bookingListRequestId) {
        this.setData({ isLoadingBookings: false })
        if (this.data.view === 'bookings') await startupLoading.finish(this)
      }
    }
  },

  viewBooking(event) {
    if (this.navigating || this.destroyed || this.data.isCancelling) return
    const reservation = this.data.bookings.find((item) => sameId(item.id, event.currentTarget.dataset.id))
    if (!reservation) return
    this.applyReservation(reservation)
    return this.navigatePage('success')
  },

  cancelReservation(event) {
    if (this.data.isCancelling || this.data.isSubmitting) return
    const id = event && event.currentTarget && event.currentTarget.dataset.id
    const target = id !== undefined ? this.data.bookings.find((item) => sameId(item.id, id)) : this.data.reservation
    if (!target || !target.canCancel) return this.toast('当前预约不可取消')
    this.setData({ showCancelDialog: true, cancelTarget: target })
  },

  closeCancelDialog() {
    if (!this.data.isCancelling) this.setData({ showCancelDialog: false, cancelTarget: null })
  },

  async confirmCancelReservation() {
    if (this.data.isCancelling || !this.data.cancelTarget) return
    const target = this.data.cancelTarget
    this.setData({ isCancelling: true })
    try {
      const cancelled = await api.cancelBooking(target.id, target.phone)
      if (cancelled !== true) throw new Error('取消尚未确认，请刷新预约后重试')
      if (this.destroyed) return
      const current = getApp().globalData.reservation
      if (current && sameId(current.id, target.id)) getApp().globalData.reservation = null
      localState.clearBookingReference(target.id)
      this.setData({ showCancelDialog: false, cancelTarget: null,
        ...(this.pageType === 'main' ? { activeReservation: getApp().globalData.reservation } : {}) })
      if (this.data.isBookingRoot || this.pageType === 'reservation') {
        await this.returnToHome()
      } else if (this.data.view === 'bookings') {
        await this.queryBookings()
      } else {
        this.currentScrollTop = 0
        this.formScrollTop = 0
        this.setData({ mainScrollTop: 0, reservation: null, dateValue: '', dateText: '', selectedTime: '', selectedSlotId: '', draftDateValue: '', draftSlotId: '', consented: false })
        this.returnToForm()
      }
      wx.showToast({ title: '预约已取消', icon: 'success' })
    } catch (error) {
      if (!this.destroyed) this.toast(this.friendlyError(error, '取消失败，请稍后重试。'))
    } finally {
      if (!this.destroyed) this.setData({ isCancelling: false })
    }
  },

  previewBoothMap() {
    const url = this.data.activity.boothMapUrl
    if (url) wx.previewImage({ current: url, urls: [url] })
  },

  openVenueLocation() {
    if (this.openingLocation) return
    const { address, location } = getVenueLocation(this.data.activity)
    if (!location || typeof wx.openLocation !== 'function') return this.offerCopyAddress(address)
    this.openingLocation = true
    try {
      wx.openLocation({
        ...location,
        scale: 18,
        fail: (error) => {
          if (!/cancel/i.test(error && error.errMsg || '')) this.offerCopyAddress(address)
        },
        complete: () => { this.openingLocation = false }
      })
    } catch (error) {
      this.openingLocation = false
      this.offerCopyAddress(address)
    }
  },

  offerCopyAddress(address) {
    wx.showModal({
      title: '暂时无法打开地图',
      content: `${address}\n可复制地址后在地图中搜索。`,
      confirmText: '复制地址',
      cancelText: '关闭',
      success: (result) => {
        if (result.confirm) wx.setClipboardData({ data: address })
      }
    })
  },

  noop() {}
}

// 各原生页面独立保存数据；仅在确认选择后向原表单回传结果。
module.exports = function createPage(pageType) {
  const view = pageType === 'main' ? 'loading' : pageType === 'reservation' ? 'bookings' : pageType
  return { ...definition, pageType, data: JSON.parse(JSON.stringify({ ...definition.data, view,
    showStartupLoading: pageType === 'main' })) }
}
