App({
  onLaunch() {
    if (!wx.cloud || typeof wx.cloud.callContainer !== 'function') {
      console.error('当前基础库不支持云托管，请升级微信后重试。')
      return
    }

    // 云托管环境由每次 callContainer 的 config.env 显式指定。
    wx.cloud.init()
  },

  globalData: {
    reservation: null,
    bookingEntry: null,
    user: null
  }
})
