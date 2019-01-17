const httpProxy = require('http-proxy');
const path = require('path');
const fs = require('fs');

/**
 * Try to locate the package.json file of the app executing this.
 * From that packaje.json reads an attribute 'proxy'.
 *
 * 'proxy' accepts a string or an object for configuring a proxy service.
 *
 * In case that a string is passed, will use it as a host to proxy
 * and any request to '/api*' will be proxied.
 *
 * If an object is passed will lock for 2 keys:
 * 'proxyHost': the host to proxy the requests
 * 'proxyPath': path to match requests to be proxied.
 *
 * @returns A proxy object if the configuration is correct, null
 *          otherwise.
 */
function ProxyHelper() {
  // Try to locate first the package.json of the running app
  const appDirectory = fs.realpathSync(process.cwd());
  const pkg = path.resolve(appDirectory, 'package.json');

  if (!fs.existsSync(pkg)) {
    return null;
  }

  const proxyConfig = require(pkg).proxy;

  if (typeof proxyConfig == 'string') {
    return new Proxy(proxyConfig, '/api');
  } else if (typeof proxyConfig == 'object') {
    if (proxyConfig.host && proxyConfig.path) {
      return new Proxy(proxyConfig.host, proxyConfig.path);
    }
    console.error('Could not configure proxy', proxyConfig);
  }

  return null;
}

class Proxy {
  constructor(host, path) {
    this.host = host;
    this.path = path;
    this._proxy = httpProxy.createProxyServer();
  }

  shouldProxyPath(path) {
    return path.startsWith(this.path);
  }

  proxy(req, res) {
    return this._proxy.web(req, res, {
      target: this.host
    });
  }
}

module.exports = ProxyHelper;
