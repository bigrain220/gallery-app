function load(src, fallback) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), 2000)
    const finish = path => { clearTimeout(timer); resolve(path) }
    try {
      wx.getImageInfo({ src, success: result => finish(src.startsWith('/') ? src : result.path || src), fail: () => finish(fallback) })
    } catch (_) {
      finish(fallback)
    }
  })
}

module.exports = activity => Promise.all([
  load(activity.successUrl || '/assets/success.jpg', '/assets/success.jpg'),
  load(activity.titleUrl || '/assets/title.png', '/assets/title.png')
]).then(([successArtSrc, successTitleSrc]) => ({ successArtSrc, successTitleSrc }))
