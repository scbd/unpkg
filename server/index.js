/*eslint-disable no-console*/
const http = require('http')
const express = require('express')
const cors = require('cors')
const morgan = require('morgan')
const middleware = require('./middleware')

const fs = require('fs')
const path = require('path')

const sendHomePage = (publicDir) => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')

  return (req, res, next) => {
    res.set('Cache-Control', 'public, max-age=60')
    res.send(html)
  }
}

const errorHandler = (err, req, res, next) => {
  res.status(500).send('<p>Internal Server Error</p>')
  console.error(err.stack)
  next(err)
}

const raven = require('raven')

if (process.env.SENTRY_DSN)
  raven.config(process.env.SENTRY_DSN, {
    environment: process.env.NODE_ENV || 'development',
    autoBreadcrumbs: true
  }).install()

morgan.token('fwd', (req) => (req.get('x-forwarded-for')||'').replace(/\s/g, ''))

const createServer = (config) => {
  const app = express()

  if (process.env.SENTRY_DSN) {
    app.use(raven.requestHandler())
    app.use(raven.errorHandler())
  }

  app.disable('x-powered-by')

  app.use(morgan(process.env.NODE_ENV === 'production'
    // Modified version of the Heroku router's log format
    // https://devcenter.heroku.com/articles/http-routing#heroku-router-log-format
    ? 'method=:method path=":url" host=:req[host] request_id=:req[x-request-id] cf_ray=:req[cf-ray] fwd=:fwd status=:status bytes=:res[content-length]'
    : 'dev'
  ))

  app.use(errorHandler)
  app.use(cors())

  app.get('/', sendHomePage(config.publicDir))

  app.use(express.static(config.publicDir, {
    maxAge: '365d'
  }))

  app.use(middleware(config))

  const server = http.createServer(app)

  // Heroku dynos automatically timeout after 30s. Set our
  // own timeout here to force sockets to close before that.
  // https://devcenter.heroku.com/articles/request-timeout
  server.setTimeout(25000, (socket) => {
    const message = `Timeout of 25 seconds exceeded`

    socket.end([
      `HTTP/1.1 503 Service Unavailable`,
      `Date: ${(new Date).toGMTString()}`,
      `Content-Type: text/plain`,
      `Content-Length: ${Buffer.byteLength(message)}`,
      `Connection: close`,
      ``,
      message
    ].join(`\r\n`))
  })

  return server
}

const defaultServerConfig = {
  id: 1,
  port: parseInt(process.env.PORT, 10) || 5000,
  publicDir: 'public',

  // for the middleware
  registryURL: process.env.REGISTRY_URL || 'https://registry.npmjs.org',
  autoIndex: !process.env.DISABLE_INDEX,
  blacklist: require('./package-blacklist').blacklist
}

const startServer = (serverConfig = {}) => {
  const config = Object.assign({}, defaultServerConfig, serverConfig)
  const server = createServer(config)

  server.listen(config.port, () => {
    console.log('Server #%s listening on port %s, Ctrl+C to stop', config.id, config.port)
  })
}

module.exports = {
  createServer,
  startServer
}
