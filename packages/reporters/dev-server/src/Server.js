// @flow
import type {Request, Response, DevServerOptions} from './types.js.flow';
import type {BundleGraph} from '@parcel/types';
import type {PrintableError} from '@parcel/utils';
import type {Server as HTTPServer} from 'http';
import type {Server as HTTPSServer} from 'https';

import EventEmitter from 'events';
import path from 'path';
import http from 'http';
import https from 'https';
import url from 'url';
import serveStatic from 'serve-static';
import ansiHtml from 'ansi-html';
import logger from '@parcel/logger';
import {prettyError} from '@parcel/utils';
import {loadConfig, generateCertificate, getCertificate} from '@parcel/utils';
import serverErrors from './serverErrors';
import fs from 'fs';
import ejs from 'ejs';
import connect from 'connect';
import httpProxyMiddleware from 'http-proxy-middleware';

function setHeaders(res: Response) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, HEAD, PUT, PATCH, POST, DELETE'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Content-Type'
  );
}

const SOURCES_ENDPOINT = '/__parcel_source_root';
const TEMPLATE_404 = fs.readFileSync(
  path.join(__dirname, 'templates/404.html'),
  'utf8'
);

const TEMPLATE_500 = fs.readFileSync(
  path.join(__dirname, 'templates/500.html'),
  'utf8'
);

type ServeFunction = (
  req: Request,
  res: Response,
  next?: (req: Request, res: Response, next?: (any) => any) => any
) => any;

export default class Server extends EventEmitter {
  pending: boolean;
  options: DevServerOptions;
  serve: ServeFunction;
  serveSources: ServeFunction;
  bundleGraph: BundleGraph | null;
  error: PrintableError | null;
  server: HTTPServer | HTTPSServer;

  constructor(options: DevServerOptions) {
    super();

    this.options = options;
    this.pending = true;
    this.bundleGraph = null;
    this.error = null;

    this.serve = serveStatic(this.options.distDir, {
      index: false,
      redirect: false,
      setHeaders: setHeaders,
      dotfiles: 'allow'
    });

    this.serveSources = serveStatic(this.options.projectRoot, {
      index: false,
      redirect: false,
      setHeaders: setHeaders,
      dotfiles: 'allow'
    });
  }

  buildSuccess(bundleGraph: BundleGraph) {
    this.bundleGraph = bundleGraph;
    this.error = null;
    this.pending = false;

    this.emit('bundled');
  }

  buildError(error: PrintableError) {
    this.error = error;
  }

  respond(req: Request, res: Response) {
    let {pathname} = url.parse(req.originalUrl || req.url);

    if (this.error) {
      return this.send500(req, res);
    } else if (
      !pathname ||
      !pathname.startsWith(this.options.publicUrl) ||
      path.extname(pathname) === ''
    ) {
      // If the URL doesn't start with the public path, or the URL doesn't
      // have a file extension, send the main HTML bundle.
      return this.sendIndex(req, res);
    } else if (pathname.startsWith(SOURCES_ENDPOINT)) {
      req.url = pathname.slice(SOURCES_ENDPOINT.length);
      return this.serveSources(req, res, () => this.sendIndex(req, res));
    } else {
      // Otherwise, serve the file from the dist folder
      req.url = pathname.slice(this.options.publicUrl.length);
      return this.serve(req, res, () => this.sendIndex(req, res));
    }
  }

  sendIndex(req: Request, res: Response) {
    if (this.bundleGraph) {
      // If the main asset is an HTML file, serve it
      let htmlBundle = null;
      this.bundleGraph.traverseBundles((bundle, context, {stop}) => {
        if (bundle.type !== 'html' || !bundle.isEntry) return;

        if (!htmlBundle) {
          htmlBundle = bundle;
        }

        if (
          htmlBundle &&
          bundle.filePath &&
          bundle.filePath.endsWith('index.html')
        ) {
          htmlBundle = bundle;
          stop();
        }
      });

      if (htmlBundle) {
        req.url = `/${path.basename(htmlBundle.filePath)}`;

        this.serve(req, res, () => this.send404(req, res));
      } else {
        this.send404(req, res);
      }
    } else {
      this.send404(req, res);
    }
  }

  send404(req: Request, res: Response) {
    res.statusCode = 404;
    setHeaders(res);
    res.end(TEMPLATE_404);
  }

  send500(req: Request, res: Response) {
    setHeaders(res);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(500);

    if (this.error) {
      let error = prettyError(this.error, {color: true});
      error.message = ansiHtml(error.message);
      error.stack = ansiHtml(error.stack);

      res.end(
        ejs.render(TEMPLATE_500, {
          error
        })
      );
    } else {
      res.end();
    }
  }

  logAccessIfVerbose(req: Request) {
    logger.verbose(`Request: ${req.headers.host}${req.originalUrl || req.url}`);
  }

  /**
   * Load proxy table from package.json and apply them.
   */
  async applyProxyTable(app: any) {
    // avoid skipping project root
    const fileInRoot: string = path.join(this.options.projectRoot, '_');

    const pkg = await loadConfig(this.options.inputFS, fileInRoot, [
      '.proxyrc.js',
      '.proxyrc'
    ]);

    if (!pkg || !pkg.config || !pkg.files) {
      return this;
    }

    const cfg = pkg.config;
    const filename = path.basename(pkg.files[0].filePath);

    if (filename === '.proxyrc.js') {
      if (typeof cfg !== 'function') {
        logger.warn(
          "Proxy configuration file '.proxyrc.js' should export a function. Skipping..."
        );
        return this;
      }
      cfg(app);
    } else if (filename === '.proxyrc') {
      if (typeof cfg !== 'object') {
        logger.warn(
          "Proxy table in '.proxyrc' should be of object type. Skipping..."
        );
        return this;
      }
      for (const [context, options] of Object.entries(cfg)) {
        // each key is interpreted as context, and value as middleware options
        app.use(httpProxyMiddleware(context, options));
      }
    }

    return this;
  }

  async start() {
    const finalHandler = (req: Request, res: Response) => {
      this.logAccessIfVerbose(req);

      const response = () => this.respond(req, res);

      // Wait for the parcelInstance to finish bundling if needed
      if (this.pending) {
        this.once('bundled', response);
      } else {
        response();
      }
    };

    const app = connect();
    await this.applyProxyTable(app);
    app.use(finalHandler);

    if (!this.options.https) {
      this.server = http.createServer(app);
    } else if (typeof this.options.https === 'boolean') {
      this.server = https.createServer(
        await generateCertificate(this.options.outputFS, this.options.cacheDir),
        app
      );
    } else {
      this.server = https.createServer(
        await getCertificate(this.options.inputFS, this.options.https),
        app
      );
    }

    this.server.listen(this.options.port, this.options.host);

    return new Promise((resolve, reject) => {
      this.server.once('error', err => {
        logger.error(new Error(serverErrors(err, this.options.port)));
        reject(err);
      });

      this.server.once('listening', () => {
        resolve(this.server);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close(err => {
        if (err != null) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}
