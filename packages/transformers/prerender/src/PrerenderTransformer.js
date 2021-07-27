import {promises as fs} from 'fs';
import path from 'path';
import Prerenderer from '@prerenderer/prerenderer';
import Puppeteer from '@prerenderer/renderer-puppeteer';
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async loadConfig({config, options}) {
    let routes = ['/']; // the default route
    let rendererConfig = {};

    let userConfig = await config.getConfigFrom(
      path.join(options.projectRoot, 'index'),
      [
        '.prerender.json',
        '.prerender.config.json',
        '.prerenderrc.json',
        '.prerenderrc',
        '.prerender.config.js',
      ],
    );

    if (userConfig) {
      const configContent = userConfig.content;
      if (Array.isArray(configContent)) {
        routes = configContent;
      } else {
        if (configContent.rendererConfig) {
          rendererConfig = configContent.rendererConfig;
        }
        if (configContent.routes) {
          routes = configContent.routes;
        }
      }

      // handle parcel cache
      let isJavascript = path.extname(userConfig.filePath) === '.js';
      if (isJavascript) {
        config.invalidateOnStartup();
      }
    }

    return {routes, rendererConfig};
  },
  async transform({options, config}) {
    const {routes, rendererConfig} = config;
    const outDir = options.outDir || path.resolve('./dist'); // TODO removed in parcel 2

    const prerenderer = new Prerenderer({
      staticDir: outDir,
      renderer: new Puppeteer(rendererConfig),
    });
    await prerenderer.initialize();

    const renderedRoutes = await prerenderer.renderRoutes(routes);

    const assets = await Promise.all(
      renderedRoutes.map(renderedRout => {
        const {route, html} = renderedRout;

        const outputDirectory = path.join(outDir, route);
        const file = path.resolve(outputDirectory, 'index.html');

        return {type: 'html', content: html.trim(), filePath: file};
      }),
    );

    prerenderer.destroy();

    return assets;
  },
}): Transformer);
