// @flow
import type {ServerOptions} from '@parcel/types';
import type Parcel from '@parcel/core';
import type {PrintableError} from '@parcel/logger/src/prettyError';
import http, {
  IncomingMessage as HTTPIncomingMessage,
  ServerResponse as HTTPServerResponse,
  Server as HTTPServer
} from 'http';
import https, {
  IncomingMessage as HTTPSIncomingMessage,
  ServerResponse as HTTPSServerResponse,
  Server as HTTPSServer
} from 'https';
import serveStatic from 'serve-static';
import getPort from 'get-port';
import serverErrors from './serverErrors';
import generateCertificate from './generateCertificate';
import getCertificate from './getCertificate';
import AnsiToHtml from 'ansi-to-html';
import logger from '@parcel/logger';
import path from 'path';
import url from 'url';

type Request = (HTTPIncomingMessage | HTTPSIncomingMessage) & {
  connection?: {
    encrypted?: boolean
  }
};
type Response = HTTPServerResponse | HTTPSServerResponse;
export type Server = HTTPServer | HTTPSServer;

const ansiToHtml = new AnsiToHtml({newline: true});

serveStatic.mime.define({
  'application/wasm': ['wasm']
});

function setHeaders(res) {
  enableCors(res);
}

function enableCors(res) {
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

export function middleware(parcelInstance: Parcel) {
  const serve = serveStatic(parcelInstance.options.cliOpts.distDir, {
    index: false,
    redirect: false,
    setHeaders: setHeaders,
    dotfiles: 'allow'
  });

  let publicUrl = parcelInstance.options.cliOpts.publicURL || '/';

  return function(req: Request, res: Response, next?: any => any) {
    logAccessIfVerbose();

    // Wait for the parcelInstance to finish bundling if needed
    if (parcelInstance.pending) {
      parcelInstance.once('bundled', respond);
    } else {
      respond();
    }

    function respond() {
      let {pathname} = url.parse(req.url);
      if (parcelInstance.error) {
        return send500(parcelInstance.error);
      } else if (
        !pathname ||
        !pathname.startsWith(publicUrl) ||
        path.extname(pathname) === ''
      ) {
        // If the URL doesn't start with the public path, or the URL doesn't
        // have a file extension, send the main HTML bundle.
        return sendIndex();
      } else {
        // Otherwise, serve the file from the dist folder
        req.url = pathname.slice(publicUrl.length);
        return serve(req, res, sendIndex);
      }
    }

    async function sendIndex() {
      // If the main asset is an HTML file, serve it
      let htmlBundle = null;
      parcelInstance.bundleGraph.traverseBundles(bundle => {
        if (bundle.type === 'html' && bundle.isEntry) {
          htmlBundle = bundle;
        }
      });

      if (htmlBundle) {
        req.url = `/${path.basename(htmlBundle.filePath)}`;
        serve(req, res, send404);
      } else {
        send404();
      }

      send404();
    }

    function send500(error: PrintableError) {
      setHeaders(res);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(500);
      let errorMesssge = '<h1>🚨 Build Error</h1>';
      if (process.env.NODE_ENV === 'production') {
        errorMesssge += '<p><b>Check the console for details.</b></p>';
      } else {
        const {message, stack} = logger.formatError(error, {color: true});
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

    function send404() {
      if (next) {
        return next();
      }
      setHeaders(res);
      res.writeHead(404);
      res.end();
    }

    function logAccessIfVerbose() {
      const protocol =
        req.connection && req.connection.encrypted ? 'https' : 'http';
      const fullUrl = `${protocol}://${req.headers.host}${req.url}`;

      logger.verbose(`Request: ${fullUrl}`);
    }
  };
}

export async function serve(
  parcelInstance: Parcel,
  options: ServerOptions | boolean
) {
  let handler = middleware(parcelInstance);

  let realOptions: ServerOptions =
    typeof options === 'boolean'
      ? {
          host: '',
          port: 1234,
          https: false
        }
      : options;

  let server;
  if (!realOptions.https) {
    server = http.createServer(handler);
  } else if (typeof realOptions.https === 'boolean') {
    server = https.createServer(
      generateCertificate(parcelInstance.options),
      handler
    );
  } else {
    server = https.createServer(
      await getCertificate(realOptions.https),
      handler
    );
  }

  let freePort = await getPort({port: realOptions.port});
  server.listen(freePort, realOptions.host);

  return new Promise((resolve, reject) => {
    server.on('error', err => {
      console.log(err);
      logger.error(new Error(serverErrors(err, server.address().port)));
      reject(err);
    });

    server.once('listening', () => {
      let addon =
        server.address().port !== realOptions.port
          ? `- ${logger.chalk.yellow(
              `configured port ${realOptions.port.toString()} could not be used.`
            )}`
          : '';

      logger.persistent(
        `Server running at ${logger.chalk.cyan(
          `${realOptions.https ? 'https' : 'http'}://${realOptions.host ||
            'localhost'}:${server.address().port}`
        )} ${addon}`
      );

      resolve(server);
    });
  });
}
