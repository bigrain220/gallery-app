const { test } = require('node:test')
const assert = require('node:assert/strict')
const loading = require('../services/startup-loading')

function page() {
  return {
    startupLoadingStartedAt: Date.now(),
    startupLoadingVisibleAt: Date.now(),
    data: { showStartupLoading: true, startupLoadingFading: false },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() }
  }
}

test('fast startup holds the cover for 1200ms, then fades for 180ms over prepared content', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const instance = page()
  instance.data.view = 'main'
  const finished = loading.finish(instance)
  t.mock.timers.tick(1199)
  await Promise.resolve()
  assert.equal(instance.data.startupLoadingFading, false)
  assert.equal(instance.data.showStartupLoading, true)
  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.equal(instance.data.startupLoadingFading, true)
  assert.equal(instance.data.view, 'main')
  t.mock.timers.tick(179)
  await Promise.resolve()
  assert.equal(instance.data.showStartupLoading, true)
  t.mock.timers.tick(1)
  await finished
  assert.equal(instance.data.showStartupLoading, false)
})

test('slow startup adds only the fade, without a second minimum hold', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const instance = page()
  t.mock.timers.tick(2000)
  const finished = loading.finish(instance)
  assert.equal(instance.data.startupLoadingFading, true)
  t.mock.timers.tick(180)
  await finished
  assert.equal(instance.data.showStartupLoading, false)
})

test('hiding during the hold cancels pending work; resuming retains elapsed display time', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const instance = page()
  const hidden = loading.finish(instance)
  t.mock.timers.tick(100)
  loading.cancel(instance)
  await hidden
  t.mock.timers.tick(1500)
  assert.equal(instance.data.showStartupLoading, true)
  assert.equal(instance.data.startupLoadingFading, false)
  const resumed = loading.finish(instance)
  assert.equal(instance.data.startupLoadingFading, true)
  t.mock.timers.tick(180)
  await resumed
  assert.equal(instance.data.showStartupLoading, false)
})

test('unloading during fade resolves the wait without writing to a destroyed page', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const instance = page()
  t.mock.timers.tick(1200)
  const finished = loading.finish(instance)
  instance.destroyed = true
  instance.setData = () => assert.fail('must not update an unloaded page')
  loading.cancel(instance)
  await finished
  t.mock.timers.tick(1000)
  assert.equal(instance.startupLoadingWait, null)
})

test('completed startup never reintroduces the cover on subsequent refreshes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const instance = page()
  instance.data.showStartupLoading = false
  await loading.finish(instance)
  assert.equal(instance.startupLoadingWait, undefined)
  assert.equal(instance.data.showStartupLoading, false)
})

test('minimum display time starts at the image load event, not the earlier request start', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const instance = page()
  delete instance.startupLoadingVisibleAt
  const finished = loading.finish(instance)
  t.mock.timers.tick(500)
  loading.artReady(instance)
  await Promise.resolve()
  t.mock.timers.tick(1199)
  await Promise.resolve()
  assert.equal(instance.data.startupLoadingFading, false)
  t.mock.timers.tick(1)
  await Promise.resolve()
  assert.equal(instance.data.startupLoadingFading, true)
  t.mock.timers.tick(180)
  await finished
  assert.equal(instance.data.showStartupLoading, false)
})

test('an empty booking result waits for the configured home cover, then fades without adding another hold', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const instance = page()
  instance.pageType = 'main'
  instance.data.view = 'main'
  instance.data.activity = {coverUrl: 'https://example.com/cover.jpg'}
  const finished = loading.finish(instance)
  loading.homeCoverReady(instance, '/assets/exhibition.jpg')
  t.mock.timers.tick(1400)
  await Promise.resolve()
  assert.equal(instance.data.startupLoadingFading, false)
  loading.homeCoverReady(instance, 'https://example.com/cover.jpg')
  await Promise.resolve()
  assert.equal(instance.data.startupLoadingFading, true)
  t.mock.timers.tick(180)
  await finished
  assert.equal(instance.data.showStartupLoading, false)
})

test('missing image callbacks have a bounded fallback instead of permanently blocking entry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const instance = page()
  delete instance.startupLoadingVisibleAt
  instance.pageType = 'main'
  instance.data.view = 'main'
  const finished = loading.finish(instance)
  t.mock.timers.tick(1500)
  await Promise.resolve()
  t.mock.timers.tick(2000)
  await Promise.resolve()
  assert.equal(instance.data.startupLoadingFading, true)
  t.mock.timers.tick(180)
  await finished
  assert.equal(instance.data.showStartupLoading, false)
})

test('the fade clock starts after the view acknowledges the style update, not before rendering', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const instance = page()
  let rendered
  instance.setData = function(patch, callback) { Object.assign(this.data, patch); if (callback) rendered = callback }
  t.mock.timers.tick(1200)
  const finished = loading.finish(instance)
  t.mock.timers.tick(500)
  await Promise.resolve()
  assert.equal(instance.data.showStartupLoading, true)
  rendered()
  t.mock.timers.tick(179)
  await Promise.resolve()
  assert.equal(instance.data.showStartupLoading, true)
  t.mock.timers.tick(1)
  await finished
  assert.equal(instance.data.showStartupLoading, false)
})
