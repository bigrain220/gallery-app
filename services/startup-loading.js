const MIN_VISIBLE_MS = 1200
const FADE_MS = 180

function wait(page, duration, phase) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      page.startupLoadingWait = null
      resolve(true)
    }, duration)
    page.startupLoadingWait = { timer, resolve, phase }
  })
}

function release(page, phase) {
  const pending = page.startupLoadingWait
  if (!pending || pending.phase !== phase) return
  clearTimeout(pending.timer)
  page.startupLoadingWait = null
  pending.resolve(true)
}

function artReady(page) {
  if (page.destroyed) return
  if (page.startupLoadingVisibleAt === undefined) page.startupLoadingVisibleAt = Date.now()
  release(page, 'artwork')
}

function homeCoverReady(page, src) {
  if (page.destroyed) return
  if (!page.readyHomeCovers) page.readyHomeCovers = new Set()
  page.readyHomeCovers.add(src)
  if (page.startupHomeCoverSrc === src) release(page, 'home-cover')
}

function fade(page) {
  return new Promise(resolve => {
    const pending = { timer: null, resolve, phase: 'fade' }
    page.startupLoadingWait = pending
    page.setData({ startupLoadingFading: true }, () => {
      if (page.startupLoadingWait !== pending || page.destroyed) return
      pending.timer = setTimeout(() => {
        page.startupLoadingWait = null
        resolve(true)
      }, FADE_MS)
    })
  })
}

function cancel(page) {
  const pending = page.startupLoadingWait
  if (pending) {
    clearTimeout(pending.timer)
    page.startupLoadingWait = null
    pending.resolve(false)
  }
  page.startupLoadingPromise = null
  if (!page.destroyed && page.data.startupLoadingFading) page.setData({ startupLoadingFading: false })
}

function finish(page) {
  if (page.destroyed || !page.data.showStartupLoading) return Promise.resolve()
  if (page.startupLoadingPromise) return page.startupLoadingPromise
  const task = (async () => {
    if (page.startupLoadingVisibleAt === undefined) {
      if (!await wait(page, 1500, 'artwork') || page.destroyed) return
      // Image errors or missing load events must not trap the user behind the cover.
      artReady(page)
    }
    if (page.pageType === 'main' && page.data.view === 'main') {
      const activity = page.data.activity || {}
      page.startupHomeCoverSrc = activity.coverUrl || activity.exhibitUrl || '/assets/exhibition.jpg'
      if (!page.readyHomeCovers || !page.readyHomeCovers.has(page.startupHomeCoverSrc)) {
        if (!await wait(page, 2000, 'home-cover') || page.destroyed) return
      }
    }
    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - page.startupLoadingVisibleAt))
    if (remaining && !await wait(page, remaining)) return
    if (page.destroyed) return
    if (!await fade(page) || page.destroyed) return
    page.setData({ showStartupLoading: false, startupLoadingFading: false })
  })()
  page.startupLoadingPromise = task
  return task.finally(() => {
    if (page.startupLoadingPromise === task) page.startupLoadingPromise = null
  })
}

module.exports = { finish, cancel, artReady, homeCoverReady }
