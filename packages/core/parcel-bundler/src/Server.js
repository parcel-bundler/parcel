const http = require('http');
const path = require('path');
const url = require('url');
const serveStatic = require('serve-static');

function middleware(bundler) {
  const serve = serveStatic(bundler.options.outDir, {index: false});

  return function (req, res, next) {
    // Wait for the bundler to finish bundling if needed
    if (bundler.pending) {
      bundler.once('bundled', respond);
    } else {
      respond();
    }

    function respond() {
      // If the URL doesn't start with the public path, send the main HTML bundle
      if (!req.url.startsWith(bundler.options.publicURL)) {
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
        req.url = '/' + bundler.mainAsset.basename;
        serve(req, res, send404);
      } else {
        send404();
      }
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

function serve(bundler, port) {
  return http.createServer(middleware(bundler)).listen(port);
}

exports.middleware = middleware;
exports.serve = serve;
