const URLFormat = /^\/((?:@[^\/@]+\/)?[^\/@]+)(?:@([^\/]+))?(\/.*)?$/

const decodeParam = (param) =>
  param && decodeURIComponent(param)

const ValidQueryKeys = {
  main: true,
  json: true,
  v:true
}

const queryIsValid = (query) =>
  Object.keys(query).every(key => ValidQueryKeys[key])

const parsePackageURL = (url) => {
  // Prefix a fixed origin instead of passing a base URL so that a request
  // path starting with "//" is never treated as a host name.
  const { pathname, search, searchParams } = new URL(`http://localhost${url}`)
  const query = Object.fromEntries(searchParams)

  if (!queryIsValid(query))
    return null

  const match = URLFormat.exec(pathname)

  if (match == null)
    return null

  const packageName = match[1]
  const version = decodeParam(match[2]) || 'latest'
  const filename = decodeParam(match[3])

  return {        // If the URL is /@scope/name@version/path.js?main=browser:
    pathname,     // /@scope/name@version/path.js
    search,       // ?main=browser
    query,        // { main: 'browser' }
    packageName,  // @scope/name
    version,      // version
    filename      // /path.js
  }
}

const createPackageURL = (packageName, version, filename, search) => {
  let pathname = `/${packageName}`

  if (version != null)
    pathname += `@${version}`

  if (filename != null)
    pathname += filename

  if (search)
    pathname += search

  return pathname
}

module.exports = {
  parsePackageURL,
  createPackageURL
}
