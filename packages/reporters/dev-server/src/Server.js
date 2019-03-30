// @flow
import type {Request, Response, DevServerOptions} from './types.js.flow';
import type {BundleGraph} from '@parcel/types';
import type {PrintableError} from '@parcel/reporter-cli/src/prettyError';

import EventEmitter from 'events';
import path from 'path';
import http from 'http';
import https from 'https';
import url from 'url';
import serveStatic from 'serve-static';
import getPort from 'get-port';
import ansiToHtml from 'ansi-to-html';
import logger from '@parcel/logger';
import prettyError from '@parcel/reporter-cli/src/prettyError';
import generateCertificate from '@parcel/server-utils/src/generateCertificate';
import getCertificate from '@parcel/server-utils/src/getCertificate';
import serverErrors from './serverErrors';

function setHeaders(res: Response) {
  enableCors(res);
}

function enableCors(res: Response) {
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

export default class Server extends EventEmitter {
  pending: boolean;
  options: DevServerOptions;
  serve: (
    req: Request,
    res: Response,
    next?: (req: Request, res: Response, next?: (any) => any) => any
  ) => any;
  bundleGraph: BundleGraph | null;
  error: PrintableError | null;

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
  }

  buildSuccess(bundleGraph: BundleGraph) {
    this.bundleGraph = bundleGraph;

    this.emit('bundled');
  }

  buildError(error: PrintableError) {
    this.error = error;
  }

  respond(req: Request, res: Response) {
    let {pathname} = url.parse(req.url);

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
    } else {
      // Otherwise, serve the file from the dist folder
      req.url = pathname.slice(this.options.publicUrl.length);
      return this.serve(req, res, this.sendIndex);
    }
  }

  async sendIndex(req: Request, res: Response) {
    if (this.bundleGraph) {
      // If the main asset is an HTML file, serve it
      let htmlBundle = null;
      this.bundleGraph.traverseBundles(bundle => {
        if (bundle.type === 'html' && bundle.isEntry) {
          htmlBundle = bundle;
        }
      });

      if (htmlBundle) {
        req.url = `/${path.basename(htmlBundle.filePath)}`;

        this.serve(req, res, this.send404);
      } else {
        this.send404(req, res);
      }
    }

    this.send404(req, res);
  }

  send404(req: Request, res: Response, next?: any => any) {
    if (next) return next();

    setHeaders(res);
    res.writeHead(404);
    res.end();
  }

  send500(req: Request, res: Response) {
    setHeaders(res);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(500);

    let errorMesssge = '<h1>🚨 Build Error</h1>';
    if (process.env.NODE_ENV === 'production') {
      errorMesssge += '<p><b>Check the console for details.</b></p>';
    } else if (this.error) {
      const {message, stack} = prettyError(this.error, {color: true});

      errorMesssge += `<p><b>${message}</b></p>`;
      if (stack) {
        errorMesssge += `<div style="background: black; padding: 1rem;">${ansiToHtml.toHtml(
          stack
        )}</div>`;
      }
    }

    res.end(
      [
        `<!doctype html>`,
        `<head><title>🚨 Build Error</title></head>`,
        `<body style="font-family: monospace; white-space: pre;">${errorMesssge}</body>`
      ].join('')
    );
  }

  logAccessIfVerbose(req: Request) {
    logger.verbose(`Request: ${req.headers.host}${req.url}`);
  }

  async start() {
    let server;

    const handler = (req: Request, res: Response) => {
      this.logAccessIfVerbose(req);

      const response = () => this.respond(req, res);

      // Wait for the parcelInstance to finish bundling if needed
      if (this.pending) {
        this.once('bundled', response);
      } else {
        response();
      }
    };

    if (!this.options.https) {
      server = http.createServer(handler);
    } else if (typeof this.options.https === 'boolean') {
      server = https.createServer(generateCertificate(this.options), handler);
    } else {
      server = https.createServer(
        await getCertificate(this.options.https),
        handler
      );
    }

    let freePort = await getPort({port: this.options.port});
    server.listen(freePort, this.options.host);

    return new Promise((resolve, reject) => {
      server.on('error', err => {
        logger.error(new Error(serverErrors(err, server.address().port)));
        reject(err);
      });

      server.once('listening', () => {
        let addon =
          server.address().port !== this.options.port
            ? `- configured port ${this.options.port.toString()} could not be used.`
            : '';

        logger.log(
          `Server running at ${this.options.https ? 'https' : 'http'}://${this
            .options.host || 'localhost'}:${server.address().port} ${addon}`
        );

        resolve(server);
      });
    });
  }
}
