import assert from 'node:assert/strict'
import test from 'node:test'
import { refreshDefaultIconCache } from '../src/lib/icon-cache.ts'

function store() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
function fixture() {
  const calls = []
  return {
    version: 'release-a',
    defaultIconPaths: ['/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'],
    storage: store(), session: store(), calls,
    fetch: async (path, options) => {
      calls.push({ path, options })
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
    }
  }
}

test('a brand update refreshes implicit icon URLs with reload semantics, then stops across pages', async () => {
  const options = fixture()
  assert.equal(await refreshDefaultIconCache(options), true)
  assert.deepEqual(options.calls.map(call => call.path), options.defaultIconPaths)
  for (const { options: request } of options.calls) {
    assert.equal(request.cache, 'reload')
    assert.equal(request.credentials, 'same-origin')
    assert.ok(request.signal instanceof AbortSignal)
  }
  assert.equal(await refreshDefaultIconCache({ ...options, session: store() }), true)
  assert.equal(options.calls.length, 3)
  assert.equal(await refreshDefaultIconCache({ ...options, version: 'release-b' }), true)
  assert.equal(options.calls.length, 6)
})

test('failed/icon-as-HTML responses are not saved as success or retried on every navigation', async () => {
  const options = fixture()
  let requests = 0
  options.fetch = async () => {
    requests++
    return new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } })
  }
  assert.equal(await refreshDefaultIconCache(options), false)
  assert.equal(await refreshDefaultIconCache(options), false)
  assert.equal(requests, 3)
  assert.equal(options.storage.getItem('site-default-icons-version'), null)
  assert.equal(await refreshDefaultIconCache({ ...options, session: store() }), false)
  assert.equal(requests, 6)
})

test('blocked storage, failed downloads and unexpected paths never break page loading', async () => {
  const options = fixture()
  const blocked = { getItem() { throw new Error('Storage blocked') }, setItem() {} }
  assert.equal(await refreshDefaultIconCache({ ...options, storage: blocked }), false)
  assert.equal(options.calls.length, 0)
  assert.equal(await refreshDefaultIconCache({ ...options, defaultIconPaths: ['https://other.example/favicon.ico'] }), false)
  assert.equal(options.calls.length, 0)
  assert.equal(await refreshDefaultIconCache({ ...fixture(), fetch: async () => { throw new Error('Offline') } }), false)
})
