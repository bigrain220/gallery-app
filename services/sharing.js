let copyUrlOwner = null

function content(activity = {}) {
  return {
    title: activity.name || activity.nameEn || "Collector's Room 02",
    imageUrl: activity.coverUrl || activity.exhibitUrl || '/assets/exhibition.jpg'
  }
}

function showMenu(page) {
  if (typeof wx.showShareMenu === 'function') {
    wx.showShareMenu({ menus: ['shareAppMessage'] })
  }
  if (typeof wx.onCopyUrl !== 'function' || typeof wx.offCopyUrl !== 'function') return
  // 复制链接是全局监听；始终使用当前可见页面的公开标题和空查询参数。
  wx.offCopyUrl()
  wx.onCopyUrl(() => ({ title: content(page.data.activity).title, query: '' }))
  copyUrlOwner = page
}

function releaseCopyUrl(page) {
  if (copyUrlOwner !== page) return
  if (typeof wx.offCopyUrl === 'function') wx.offCopyUrl()
  copyUrlOwner = null
}

module.exports = {
  appMessage: activity => ({ ...content(activity), path: '/pages/index/index' }),
  showMenu, releaseCopyUrl
}
