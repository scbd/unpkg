// Smoke tests: start the real server (plus a throwaway redis for the
// registry cache) and request a few package files from the public npm
// registry. Run with `npm test` (node:test, Node >= 22).
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const net = require('node:net')
const path = require('node:path')
const semver = require('semver')
const pkg = require('../package.json')

const root = path.resolve(__dirname, '..')
let server
let redis
let baseURL
let serverLog = ''

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })

const waitFor = async (check, label, timeoutMs = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (await check()) return
    } catch (error) {
      // not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for ${label}\n${serverLog}`)
}

const get = (pathname) =>
  fetch(baseURL + pathname, { redirect: 'manual' })

const sha1 = (buffer) =>
  createHash('sha1').update(buffer).digest('hex')

before(async () => {
  const redisPort = await freePort()
  redis = spawn('redis-server', ['--port', String(redisPort), '--save', '', '--appendonly', 'no'], {
    stdio: 'ignore'
  })
  await waitFor(() => new Promise(resolve => {
    const socket = net.connect(redisPort, '127.0.0.1', () => { socket.end(); resolve(true) })
    socket.on('error', () => resolve(false))
  }), 'redis')

  const port = await freePort()
  baseURL = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    detached: true,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      WEB_CONCURRENCY: '1',
      NODE_ENV: 'production',
      OPENREDIS_URL: `redis://127.0.0.1:${redisPort}`
    })
  })
  server.stdout.on('data', chunk => { serverLog += chunk })
  server.stderr.on('data', chunk => { serverLog += chunk })

  await waitFor(async () => (await get('/')).status === 200, 'server')
})

after(() => {
  if (server) {
    try { process.kill(-server.pid, 'SIGKILL') } catch (error) { server.kill('SIGKILL') }
  }
  if (redis) redis.kill('SIGKILL')
})

test('Node version satisfies package.json engines', () => {
  assert.ok(pkg.engines && pkg.engines.node, 'engines.node is set')
  assert.ok(
    semver.satisfies(process.version, pkg.engines.node),
    `${process.version} does not satisfy ${pkg.engines.node}`
  )
})

test('GET / serves the home page', async () => {
  const res = await get('/')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^text\/html/)
  assert.match(await res.text(), /<div id="root">/)
})

test('GET /react@16.0.0/package.json serves the package manifest', async () => {
  const res = await get('/react@16.0.0/package.json')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/json')
  const body = Buffer.from(await res.arrayBuffer())
  assert.equal(sha1(body), '8d0fb7e4f8e50bfb4a9a3b81c4763318b01a7b31')
  const json = JSON.parse(body)
  assert.equal(json.name, 'react')
  assert.equal(json.version, '16.0.0')
})

test('GET /lodash@4.17.21/lodash.min.js serves the published file', async () => {
  const res = await get('/lodash@4.17.21/lodash.min.js')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/javascript')
  const body = Buffer.from(await res.arrayBuffer())
  assert.equal(sha1(body), 'ae854b04025db8b7f48fdd6dedf41e77eae44394')
})

test('GET /react@16.0.0/?json returns directory metadata', async () => {
  const res = await get('/react@16.0.0/?json')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/json')
  const meta = await res.json()
  assert.equal(meta.type, 'directory')
  const paths = meta.files.map(file => file.path)
  assert.ok(paths.includes('/package.json'), paths.join(', '))
  assert.ok(paths.includes('/cjs'), paths.join(', '))
})

test('GET /react@16.0.0/ renders a directory listing', async () => {
  const res = await get('/react@16.0.0/')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/html')
  const html = await res.text()
  assert.match(html, /^<!DOCTYPE html>/)
  assert.match(html, /<title>Index of \/<\/title>/)
  assert.match(html, /package\.json/)
})

test('GET /react@16.0.0/cjs redirects to the trailing-slash directory URL', async () => {
  const res = await get('/react@16.0.0/cjs')
  assert.equal(res.status, 302)
  assert.equal(res.headers.get('location'), '/react@16.0.0/cjs/')
})

test('GET /react@^16/package.json redirects to the max satisfying version', async () => {
  const res = await get('/react@^16/package.json')
  assert.equal(res.status, 302)
  assert.match(res.headers.get('location'), /^\/react@16\.\d+\.\d+\/package\.json$/)
  assert.match(res.headers.get('content-type'), /^text\/html/)
})

test('GET a missing file returns 404', async () => {
  const res = await get('/react@16.0.0/does-not-exist.js')
  assert.equal(res.status, 404)
  assert.equal(res.headers.get('content-type'), 'text/plain')
  assert.match(await res.text(), /^Not found: file "\/does-not-exist\.js"/)
})

test('GET with an unsupported query key returns 403', async () => {
  const res = await get('/react@16.0.0/package.json?foo=bar')
  assert.equal(res.status, 403)
  assert.match(await res.text(), /^Invalid URL/)
})

test('server log has no errors or warnings', () => {
  assert.match(serverLog, /listening on port/)
  assert.doesNotMatch(serverLog, /DeprecationWarning|Warning:|Error|TypeError|Unhandled/i, serverLog)
})
