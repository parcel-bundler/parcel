import {createProxyMiddleware} from 'http-proxy-middleware';

export default function(app) {
  app.use(createProxyMiddleware('/api', {
    target: 'http://localhost:9753/',
    pathRewrite: {
      '^/api': ''
    }
  }));
};
