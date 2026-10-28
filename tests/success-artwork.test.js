const { test } = require('node:test')
const assert = require('node:assert/strict')
const loadArtwork = require('../services/success-artwork')

test('success artwork resolves both images to cached paths', async () => {
  global.wx = { getImageInfo: options => options.success({path: '/cached/' + options.src.split('/').pop()}) }
  assert.deepEqual(await loadArtwork({successUrl: 'https://example.com/art.jpg', titleUrl: 'https://example.com/title.png'}), {
    successArtSrc: '/cached/art.jpg', successTitleSrc: '/cached/title.png'
  })
})

test('failed remote artwork falls back to packaged images without blocking confirmed bookings', async () => {
  global.wx = { getImageInfo: options => options.fail() }
  assert.deepEqual(await loadArtwork({successUrl: 'https://example.com/missing.jpg'}), {
    successArtSrc: '/assets/success.jpg', successTitleSrc: '/assets/title.png'
  })
})

test('packaged images retain absolute paths when image info returns a relative path', async () => {
  global.wx = { getImageInfo: options => options.success({path: options.src.slice(1)}) }
  assert.deepEqual(await loadArtwork({}), {
    successArtSrc: '/assets/success.jpg', successTitleSrc: '/assets/title.png'
  })
})

test('unresponsive image loading is bounded to two seconds and ignores late responses', async t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  const requests = []
  global.wx = { getImageInfo: options => requests.push(options) }
  const pending = loadArtwork({successUrl: 'https://example.com/slow.jpg'})
  t.mock.timers.tick(2000)
  const result = await pending
  assert.equal(result.successArtSrc, '/assets/success.jpg')
  requests[0].success({path: '/late.jpg'})
  assert.equal(result.successArtSrc, '/assets/success.jpg')
})
