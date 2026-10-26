App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请升级微信后重试。')
      return
    }

    const options = { traceUser: true }
    if (this.globalData.cloudEnvId) {
      options.env = this.globalData.cloudEnvId
    }
    wx.cloud.init(options)
  },

  globalData: {
    // 真机不会可靠继承开发者工具里选中的默认环境，必须显式指定。
    cloudEnvId: 'cloud1-d0gspd9pe0240a75e',
    reservation: null,
    user: null
  }
})
