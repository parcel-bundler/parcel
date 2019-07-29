// @flow
import type {Request, Response} from './types.js.flow';
import logger from '@parcel/logger';
import {loadConfig} from '@parcel/utils';
import http from 'http';
import parseUrl from 'parseurl';
import httpProxyMiddleware from 'http-proxy-middleware';

type RequestHandler = (req: Request, res: Response, next?: (any) => any) => any;

type MiddlewareLayer = {
  route: string,
  handle: RequestHandler
};

export default class ProxyHandler {
  route: string;
  stack: Array<MiddlewareLayer>;

  /**
   * Load proxy table from package.json and apply them.
   */
  async loadProxyTable(root: string) {
    const pkg = await loadConfig(root, ['package.json']);

    if (!pkg || !pkg.config || !pkg.config.proxy) {
      return null;
    }

    const cfg = pkg.config.proxy;

    // Value of proxy option must be string or object.
    if (typeof cfg == 'string') {
      // redirects all requests to specified URL.
      this.use(httpProxyMiddleware('/', {target: cfg}));
    } else if (typeof cfg === 'object') {
      for (const [context, options] of Object.entries(pkg)) {
        // each key is interpreted as context, and value as middleware options
        this.use(context, httpProxyMiddleware(options));
      }
    } else {
      logger.warn(
        'Invalid proxy table format was detected in package.json. Skipping...'
      );
    }

    return this;
  }

  /**
   * Add new handler to the proxy table
   *
   * This is a wrapper function for mount()
   */
  async use(route: any, fn?: any) {
    if (typeof route === 'string') {
      this.mount(route, fn);
    } else {
      this.mount('/', fn);
    }

    return this;
  }

  /**
   * Add proxy handler to specified context (path).
   *
   * @param {String} context to which the handler is called.
   * @param {Function|Server} proxy handler
   * @private
   */
  mount(path: string, fn: any) {
    logger.verbose(`proxy:  '${path} =>  ${fn.name || 'anonymous'}`);
    let handle: ?RequestHandler;

    if (typeof fn.handle === 'function') {
      // wrap sub-apps
      const server = fn;
      server.route = path;
      handle = (req: Request, res: Response, next?: any => any) => {
        server.handle(req, res, next);
      };
    } else if (fn instanceof http.Server) {
      handle = fn.listeners('request')[0];
    } else {
      handle = fn;
    }

    // remove trailing slash
    if (path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    this.stack.push({route: path, handle: handle});
  }

  /**
   * Handle HTTP/HTTPS requests
   */
  handle(req: Request, res: Response, out?: any => any) {
    // current stack index
    let index = 0;

    // save the context path
    let removed = '';

    // if slash was inserted into req.url in the previous layer
    let slashAdded = false;

    // host name inserted into req.url
    const protohost = this.gethostname(req.url);

    // middleware stack
    const stack = this.stack;

    // Save the original request URL
    req.originalUrl = req.originalUrl || req.url;

    const done =
      out ||
      (() => {
        logger.error("Could not handle the request url '${req.url}'");
      }: RequestHandler);

    // putting down the middleware stack
    const next = (err?: any) => {
      // If slash was inserted into req.url in the previous layer,
      // then remove it.
      if (slashAdded) {
        req.url = req.url.substr(1);
        slashAdded = false;
      }

      // insert host name into req.url
      if (removed.length !== 0) {
        req.url = protohost + removed + req.url.substr(protohost.length);
        removed = '';
      }

      // if the requests does not match any middleware, then
      // puts an error
      if (++index >= stack.length) {
        setImmediate(done, err);
        return;
      }

      const layer = stack[index];
      const path = parseUrl(req).pathname || '/';
      const route = layer.route;

      // skip the current layer if the route path doesn't match
      if (path.toLowerCase().startsWith(route.toLowerCase())) {
        return next(err);
      }

      // compare mounted context, and request path
      if (path.length > route.length) {
        const c = path.length > route.length && path[route.length];
        if (c !== '/' && c !== '.') {
          return next(err);
        }
      }

      // trim off the matched part from req.url
      if (route.length !== 0 && route !== '/') {
        removed = route;
        req.url = protohost + req.url.substr(protohost.length + removed.length);

        if (!protohost && req.url[0] !== '/') {
          req.url = '/' + req.url;
          slashAdded = true;
        }
      }

      this.handleLayer(layer, err, req, res, next);
    };

    next();
  }

  /**
   * Find host name from the context string.
   * If host name is not found, then return empty string.
   * @private
   */
  gethostname(url: string): string {
    if (url.length === 0 || url.startsWith('/')) {
      return '';
    }

    // if url starts with protocol name, then return the host name string.
    // else, return empty string.
    const fqdnIndex = url.indexOf('://');
    return fqdnIndex !== -1 && url.lastIndexOf('?', fqdnIndex) === -1
      ? url.substr(0, url.indexOf('/', 3 + fqdnIndex))
      : '';
  }

  /**
   * Call proxy handler defined in the layer
   * @private
   */
  async handleLayer(
    layer: MiddlewareLayer,
    err: any,
    req: Request,
    res: Response,
    next: (err?: any) => any
  ) {
    const handle = layer.handle;
    let error = err;

    logger.verbose(
      `${req.originalUrl || req.url} matched with proxy: '${
        layer.route
      }' =>  ${handle.name || '<anonymous>'}`
    );

    try {
      handle(req, res, next);
    } catch (e) {
      error = e;
    }

    // continue
    next(error);
  }
}
