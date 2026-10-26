const WEEKDAY_TEXT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const CLOUD_FUNCTION_NAME = 'reservation'

function pad(value) {
  return value < 10 ? `0${value}` : String(value)
}

function buildMonth(year, month) {
  const firstWeekday = new Date(year, month - 1, 1).getDay()
  const totalDays = new Date(year, month, 0).getDate()
  const days = []

  for (let index = 0; index < firstWeekday; index += 1) {
    days.push({ key: `blank-${month}-${index}`, placeholder: true, label: '' })
  }

  for (let day = 1; day <= totalDays; day += 1) {
    days.push({
      key: `${year}-${month}-${day}`,
      label: day,
      value: `${year}-${pad(month)}-${pad(day)}`,
      disabled: false
    })
  }

  return { label: `${month}月`, days }
}

function formatDate(value) {
  if (!value) return ''
  const [year, month, day] = value.split('-').map(Number)
  const weekday = WEEKDAY_TEXT[new Date(year, month - 1, day).getDay()]
  return `${month}月${day}日 ${weekday}`
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function callBackend(action, data = {}) {
  if (!wx.cloud) {
    throw new Error('当前微信版本不支持云开发')
  }

  const response = await wx.cloud.callFunction({
    name: CLOUD_FUNCTION_NAME,
    data: { action, ...data }
  })
  const result = response.result || {}

  if (!result.ok) {
    const error = new Error(result.message || '服务暂时不可用')
    error.code = result.code
    throw error
  }

  return result.data || {}
}

Page({
  data: {
    view: 'loading',
    statusBarHeight: 0,
    navBarHeight: 44,
    navTotalHeight: 44,
    mainScrollTop: 0,
    name: '',
    phone: '',
    dateValue: '',
    dateText: '',
    draftDateValue: '2026-11-20',
    selectedTime: '',
    draftTime: '13:00-14:00',
    consented: false,
    isAuthorizingPhone: false,
    isSubmitting: false,
    isCancelling: false,
    errorMessage: '',
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    months: [buildMonth(2026, 11), buildMonth(2026, 12)],
    timeSlots: [
      { value: '11:00-12:00', disabled: false },
      { value: '12:00-13:00', disabled: true },
      { value: '13:00-14:00', disabled: false },
      { value: '14:00-15:00', disabled: true },
      { value: '15:00-16:00', disabled: true },
      { value: '16:00-17:00', disabled: false },
      { value: '17:00-18:00', disabled: false },
      { value: '18:00-19:00', disabled: false },
      { value: '19:00-20:00', disabled: false }
    ]
  },

  onLoad() {
    const windowInfo = wx.getWindowInfo()
    const menuRect = wx.getMenuButtonBoundingClientRect()
    const statusBarHeight = windowInfo.statusBarHeight || 0
    const navBarHeight = Math.max(44, (menuRect.top - statusBarHeight) * 2 + menuRect.height)

    this.setData({
      statusBarHeight,
      navBarHeight,
      navTotalHeight: statusBarHeight + navBarHeight
    })

    this.initialize()
  },

  onUnload() {
    this.destroyed = true
  },

  async initialize() {
    this.setData({ view: 'loading', errorMessage: '' })

    try {
      const [, data] = await Promise.all([delay(1200), callBackend('bootstrap')])
      if (this.destroyed) return

      const user = data.user || {}
      const reservation = data.reservation || null
      getApp().globalData.user = user
      getApp().globalData.reservation = reservation

      if (reservation) {
        this.applyReservation(reservation)
        this.setData({ view: 'success' })
        return
      }

      this.setData({
        view: 'main',
        name: user.name || '',
        phone: user.phone || ''
      })
    } catch (error) {
      console.error('初始化云端数据失败', error)
      if (this.destroyed) return
      this.setData({
        view: 'error',
        errorMessage: this.friendlyError(error, '暂时无法连接预约服务，请检查网络后重试。')
      })
    }
  },

  retryInitialize() {
    this.initialize()
  },

  applyReservation(reservation) {
    this.setData({
      name: reservation.name || '',
      phone: reservation.phone || '',
      dateValue: reservation.date || '',
      dateText: reservation.dateText || formatDate(reservation.date),
      selectedTime: reservation.time || '',
      consented: true
    })
  },

  friendlyError(error, fallback) {
    if (error && error.code === 'ALREADY_RESERVED') return '您已经预约过了'
    if (error && error.code === 'NO_ACTIVE_RESERVATION') return '当前没有可取消的预约'
    if (error && error.code === 'INVALID_PHONE_CODE') return '手机号授权已失效，请重新点击授权'
    if (error && error.code === 'INVALID_INPUT') return error.message || '请检查预约信息'
    return fallback
  },

  handleNavBack() {
    if (this.data.view === 'date' || this.data.view === 'time') {
      this.returnToForm()
      return
    }

    if (this.data.view === 'success') {
      this.setData({ view: 'main', mainScrollTop: this.formScrollTop || 950 })
      return
    }

    wx.navigateBack({ delta: 1 })
  },

  onMainScroll(event) {
    this.currentScrollTop = event.detail.scrollTop
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [field]: event.detail.value })
  },

  handleAgreePrivacyAuthorization(event) {
    console.info('用户已同步隐私授权状态', event && event.detail)
  },

  phoneAuthorizationError(detail = {}) {
    const errMsg = String(detail.errMsg || '')
    const normalized = errMsg.toLowerCase()

    if (Number(detail.errno) === 112 || /not declared in the privacy agreement/.test(normalized)) {
      return '手机号尚未加入小程序隐私保护指引，请管理员先在微信公众平台完成隐私声明。'
    }

    if (Number(detail.errno) === 1400001) {
      return '当前小程序的手机号验证额度已用完，请在微信公众平台补充额度后重试。'
    }

    if (/deny|denied|cancel/.test(normalized)) {
      return '你取消了手机号授权，请重新点击“微信授权”并选择允许。'
    }

    if (/quota|limit|次数|额度/.test(normalized)) {
      return '当前小程序的手机号验证额度已用完，请在微信公众平台补充额度后重试。'
    }

    if (/permission|not authorized|auth deny|无权限/.test(normalized)) {
      return '当前小程序没有手机号快速验证权限，请确认账号已认证并已开通手机号快速验证能力。'
    }

    const detailText = [errMsg, detail.errno !== undefined ? `errno: ${detail.errno}` : '']
      .filter(Boolean)
      .join('\n')

    return detailText || '微信没有返回手机号授权凭证，请重新点击授权。'
  },

  async authorizePhone(event) {
    const detail = (event && event.detail) || {}
    const code = detail.code
    console.info('手机号授权回调', detail)

    if (!code) {
      wx.showModal({
        title: '手机号授权失败',
        content: this.phoneAuthorizationError(detail),
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    this.setData({ isAuthorizingPhone: true })
    try {
      const data = await callBackend('authorizePhone', { code })
      const phone = data.phone || ''
      const user = { ...(getApp().globalData.user || {}), phone }
      getApp().globalData.user = user
      this.setData({ phone })
      wx.showToast({ title: '手机号已授权', icon: 'success' })
    } catch (error) {
      console.error('手机号授权失败', error)
      wx.showToast({ title: this.friendlyError(error, '手机号授权失败，请重试'), icon: 'none' })
    } finally {
      this.setData({ isAuthorizingPhone: false })
    }
  },

  openPicker(event) {
    const picker = event.currentTarget.dataset.picker
    this.formScrollTop = this.currentScrollTop || this.data.mainScrollTop || 950

    if (picker === 'date') {
      this.setData({ view: 'date', draftDateValue: this.data.dateValue || this.data.draftDateValue })
      return
    }

    this.setData({ view: 'time', draftTime: this.data.selectedTime || this.data.draftTime })
  },

  returnToForm() {
    this.setData({ view: 'main', mainScrollTop: this.formScrollTop || 950 })
  },

  selectDate(event) {
    this.setData({ draftDateValue: event.currentTarget.dataset.value })
  },

  confirmDate() {
    const dateValue = this.data.draftDateValue
    this.setData({
      dateValue,
      dateText: formatDate(dateValue),
      view: 'main',
      mainScrollTop: this.formScrollTop || 950
    })
  },

  selectTime(event) {
    this.setData({ draftTime: event.currentTarget.dataset.value })
  },

  confirmTime() {
    this.setData({
      selectedTime: this.data.draftTime,
      view: 'main',
      mainScrollTop: this.formScrollTop || 950
    })
  },

  toggleConsent() {
    this.setData({ consented: !this.data.consented })
  },

  openPrivacyPolicy() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.showModal({
        title: '暂时无法打开',
        content: '当前微信版本不支持打开隐私保护指引，请升级微信后重试。',
        showCancel: false
      })
      return
    }

    wx.openPrivacyContract({
      fail: () => {
        wx.showModal({
          title: '隐私指引尚未生效',
          content: '请先在微信公众平台完成《小程序用户隐私保护指引》的配置和审核。',
          showCancel: false
        })
      }
    })
  },

  async submitReservation() {
    const { name, phone, dateValue, selectedTime, consented } = this.data

    if (!name.trim()) {
      wx.showToast({ title: '请填写姓名', icon: 'none' })
      return
    }
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请填写正确的手机号码', icon: 'none' })
      return
    }
    if (!dateValue) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    if (!selectedTime) {
      wx.showToast({ title: '请选择时间', icon: 'none' })
      return
    }
    if (!consented) {
      wx.showToast({ title: '请阅读并同意隐私说明', icon: 'none' })
      return
    }

    if (this.data.isSubmitting) return
    this.setData({ isSubmitting: true })
    wx.showLoading({ title: '正在提交', mask: true })

    try {
      const data = await callBackend('submit', {
        name: name.trim(),
        phone,
        date: dateValue,
        time: selectedTime
      })
      const reservation = data.reservation
      getApp().globalData.reservation = reservation
      getApp().globalData.user = {
        ...(getApp().globalData.user || {}),
        name: reservation.name,
        phone: reservation.phone
      }
      this.applyReservation(reservation)
      this.setData({ view: 'success' })
    } catch (error) {
      console.error('提交预约失败', error)

      if (error.code === 'ALREADY_RESERVED') {
        await this.refreshReservation()
      }
      wx.showToast({ title: this.friendlyError(error, '提交失败，请稍后重试'), icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ isSubmitting: false })
    }
  },

  async refreshReservation() {
    try {
      const data = await callBackend('bootstrap')
      if (!data.reservation) return
      getApp().globalData.reservation = data.reservation
      this.applyReservation(data.reservation)
      this.setData({ view: 'success' })
    } catch (error) {
      console.error('刷新预约失败', error)
    }
  },

  cancelReservation() {
    if (this.data.isCancelling) return

    wx.showModal({
      title: '取消预约',
      content: '确认取消本次预约吗？',
      confirmText: '确认取消',
      confirmColor: '#000000',
      success: async ({ confirm }) => {
        if (!confirm) return

        this.setData({ isCancelling: true })
        wx.showLoading({ title: '正在取消', mask: true })
        try {
          await callBackend('cancel')
          const user = getApp().globalData.user || {}
          getApp().globalData.reservation = null
          this.currentScrollTop = 0
          this.formScrollTop = 0
          this.setData({
            view: 'main',
            mainScrollTop: 0,
            name: user.name || this.data.name,
            phone: user.phone || this.data.phone,
            dateValue: '',
            dateText: '',
            selectedTime: '',
            consented: false
          })
          wx.showToast({ title: '预约已取消', icon: 'success' })
        } catch (error) {
          console.error('取消预约失败', error)
          if (error.code === 'NO_ACTIVE_RESERVATION') {
            getApp().globalData.reservation = null
            this.setData({ view: 'main', dateValue: '', dateText: '', selectedTime: '' })
          }
          wx.showToast({ title: this.friendlyError(error, '取消失败，请稍后重试'), icon: 'none' })
        } finally {
          wx.hideLoading()
          this.setData({ isCancelling: false })
        }
      }
    })
  }
})
