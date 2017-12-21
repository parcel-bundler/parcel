const http = require('http');
const serveStatic = require('serve-static');
const getPort = require('get-port');
const serverErrors = require('./utils/customErrors').serverErrors;

function middleware(bundler) {
  const serve = serveStatic(bundler.options.outDir, {index: false});

  return function(req, res, next) {
    // Wait for the bundler to finish bundling if needed
    if (bundler.pending) {
      bundler.once('bundled', respond);
    } else {
      respond();
    }

    function respond() {
      if (bundler.errored) {
        return send500();
      } else if (!req.url.startsWith(bundler.options.publicURL)) {
        // If the URL doesn't start with the public path, send the main HTML bundle
        return sendIndex();
      } else {
        // Otherwise, serve the file from the dist folder
        req.url = req.url.slice(bundler.options.publicURL.length);
        return serve(req, res, send404);
      }
    }

    function sendIndex() {
      // If the main asset is an HTML file, serve it
      if (bundler.mainAsset.type === 'html') {
        req.url = `/${bundler.mainAsset.generateBundleName()}`;
        serve(req, res, send404);
      } else {
        send404();
      }
    }

    function send500() {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.writeHead(500);
      res.end('🚨 Build error, check the console for details.');
    }

    function send404() {
      if (next) {
        return next();
      }

      res.writeHead(404);
      res.end();
    }
  };
}

async function serve(bundler, port) {
  let freePort = await getPort({port});
  let server = http.createServer(middleware(bundler)).listen(freePort);

  return new Promise((resolve, reject) => {
    server.on('error', err => {
      bundler.logger.error(new Error(serverErrors(err, server.address().port)));
      reject(err);
    });

    server.once('listening', () => {
      let addon =
        server.address().port !== port
          ? `- ${bundler.logger.chalk.red(
              `configured port ${port} could not be used.`
            )}`
          : '';
      bundler.logger.persistent(
        `Server running at ${bundler.logger.chalk.cyan(
          `http://localhost:${server.address().port}`
        )} ${addon}`
      );

      resolve(server);
    });
  });
}

exports.middleware = middleware;
exports.serve = serve;
