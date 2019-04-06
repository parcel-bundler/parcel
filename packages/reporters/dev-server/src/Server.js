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
import ansiHtml from 'ansi-html';
import logger from '@parcel/logger';
import prettyError from '@parcel/reporter-cli/src/prettyError';
import generateCertificate from '@parcel/utils/src/generateCertificate';
import getCertificate from '@parcel/utils/src/getCertificate';
import serverErrors from './serverErrors';
import {readFile} from '@parcel/fs';
import ejs from 'ejs';

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
    this.pending = false;

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
      return this.serve(req, res, () => this.sendIndex(req, res));
    }
  }

  async sendIndex(req: Request, res: Response) {
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

  async send404(req: Request, res: Response) {
    res.statusCode = 404;

    let template404 = (await readFile(
      path.join(__dirname, 'templates/404.html')
    )).toString('utf8');

    setHeaders(res);
    res.end(template404);
  }

  async send500(req: Request, res: Response) {
    setHeaders(res);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(500);

    if (this.error) {
      let error = prettyError(this.error, {color: true});
      error.stack = ansiHtml(error.stack);

      let template500 = (await readFile(
        path.join(__dirname, 'templates/500.html')
      )).toString('utf8');

      res.end(
        ejs.render(template500, {
          error
        })
      );
    } else {
      res.end();
    }
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
      server = https.createServer(
        await generateCertificate(this.options.cacheDir),
        handler
      );
    } else {
      server = https.createServer(
        await getCertificate(this.options.https),
        handler
      );
    }

    server.listen(this.options.port, this.options.host);

    return new Promise((resolve, reject) => {
      server.on('error', err => {
        logger.error(
          new Error(
            serverErrors(err, server.address() && server.address().port)
          )
        );
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
