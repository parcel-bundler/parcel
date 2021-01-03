// @flow strict-local
import {Transformer} from '@parcel/plugin';
import nullthrows from 'nullthrows';
import {md5FromObject} from '@parcel/utils';
import ThrowableDiagnostic from '@parcel/diagnostic';
import type {Diagnostic} from '@parcel/diagnostic';
import type {TransformerResult} from '@parcel/types';
import SourceMap from '@parcel/source-map';
import semver from 'semver';
import {basename, extname, relative, dirname} from 'path';

const MODULE_BY_NAME_RE = /\.module\./;

// TODO: Use language-specific config files during preprocessing
export default (new Transformer({
  async loadConfig({config}) {
    let conf = await config.getConfig(
      ['.vuerc', '.vuerc.json', '.vuerc.js', 'vue.config.js'],
      {packageKey: 'vue'},
    );
    let contents = {};
    if (conf) {
      config.shouldInvalidateOnStartup();
      contents = conf.contents;
      if (typeof contents !== 'object') {
        throw new ThrowableDiagnostic({
          diagnostic: {
            message: 'Vue config should be an object.',
            origin: '@parcel/transformer-vue',
            filePath: conf.filePath,
          },
        });
      }
    }
    config.setResult({
      customBlocks: contents.customBlocks || {},
      filePath: conf && conf.filePath,
    });
  },
  canReuseAST({ast}) {
    return ast.type === 'vue' && semver.satisfies(ast.version, '^3.0.0');
  },
  async parse({asset, options}) {
    // TODO: This parses the vue component multiple times. Fix?
    let compiler = await options.packageManager.require(
      '@vue/compiler-sfc',
      asset.filePath,
      {shouldAutoInstall: options.shouldAutoInstall},
    );
    let code = await asset.getCode();
    let parsed = compiler.parse(code, {
      sourceMap: true,
      filename: asset.filePath,
    });
    if (parsed.errors.length) {
      throw new ThrowableDiagnostic({
        diagnostic: parsed.errors.map(err => {
          return createDiagnostic(err, asset.filePath);
        }),
      });
    }

    return {
      type: 'vue',
      version: '3.0.0',
      program: parsed.descriptor,
    };
  },
  async transform({asset, options, resolve, config}) {
    let baseId = md5FromObject({
      filePath: asset.filePath,
    }).slice(-6);
    let scopeId = 'data-v-' + baseId;
    let hmrId = baseId + '-hmr';
    let basePath = basename(asset.filePath);
    let {template, script, styles, customBlocks} = nullthrows(
      await asset.getAST(),
    ).program;
    if (asset.pipeline != null) {
      return processPipeline({
        asset,
        template,
        script,
        styles,
        customBlocks,
        config,
        basePath,
        options,
        resolve,
        scopeId,
        hmrId,
      });
    }
    return [
      {
        type: 'js',
        uniqueKey: asset.id + '-glue',
        content: `
let script;
let initialize = () => {
  script = ${
    script != null
      ? `require('script:./${basePath}');
  if (script.__esModule) script = script.default`
      : '{}'
  };
  ${
    template != null
      ? `script.render = require('template:./${basePath}').render;`
      : ''
  }
  ${
    styles.length !== 0
      ? `script.__cssModules = require('style:./${basePath}').default;`
      : ''
  }
  ${
    customBlocks != null
      ? `require('custom:./${basePath}').default(script);`
      : ''
  }
  script.__scopeId = '${scopeId}';
  script.__file = ${JSON.stringify(
    options.mode === 'production' ? basePath : asset.filePath,
  )};
};
initialize();
${
  options.hmrOptions
    ? `if (module.hot) {
  script.__hmrId = '${hmrId}';
  module.hot.accept(() => {
    setTimeout(() => {
      initialize();
      if (!__VUE_HMR_RUNTIME__.createRecord('${hmrId}', script)) {
        __VUE_HMR_RUNTIME__.reload('${hmrId}', script);
      }
    }, 0);
  });
}`
    : ''
}
export default script;`,
      },
    ];
  },
}): Transformer);

function createDiagnostic(err, filePath) {
  if (typeof err === 'string') {
    return {
      message: err,
      origin: '@parcel/transformer-vue',
      filePath,
    };
  }
  let diagnostic: Diagnostic = {
    message: err.message,
    origin: '@parcel/transformer-vue',
    name: err.name,
    stack: err.stack,
    filePath,
  };
  if (err.loc) {
    diagnostic.codeFrame = {
      codeHighlights: [
        {
          start: {
            line: err.loc.start.line + err.loc.start.offset,
            column: err.loc.start.column,
          },
          end: {
            line: err.loc.end.line + err.loc.end.offset,
            column: err.loc.end.column,
          },
        },
      ],
    };
  }
  return diagnostic;
}

async function processPipeline({
  asset,
  template,
  script,
  styles,
  customBlocks,
  config,
  basePath,
  options,
  resolve,
  scopeId,
  hmrId,
}) {
  let compiler = await options.packageManager.require(
    '@vue/compiler-sfc',
    asset.filePath,
    {shouldAutoInstall: options.shouldAutoInstall},
  );
  let consolidate = await options.packageManager.require(
    'consolidate',
    asset.filePath,
    {shouldAutoInstall: options.shouldAutoInstall},
  );
  switch (asset.pipeline) {
    case 'template': {
      let isFunctional = template.functional;
      if (template.src) {
        template.content = (
          await options.inputFS.readFile(
            await resolve(asset.filePath, template.src),
          )
        ).toString();
        template.lang = extname(template.src);
      }
      let content = template.content;
      if (template.lang && !['htm', 'html'].includes(template.lang)) {
        let preprocessor = consolidate[template.lang];
        if (!preprocessor) {
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `Unknown template language: "${template.lang}"`,
              origin: '@parcel/transformer-vue',
              filePath: asset.filePath,
            },
          });
        }
        // TODO: Improve? This seems brittle
        try {
          content = await preprocessor.render(content, {});
        } catch (e) {
          if (e.code !== 'MODULE_NOT_FOUND' || !options.shouldAutoInstall) {
            throw e;
          }
          let firstIndex = e.message.indexOf("'");
          let secondIndex = e.message.indexOf("'", firstIndex + 1);
          let toInstall = e.message.slice(firstIndex + 1, secondIndex);

          await options.packageManager.require(toInstall, asset.filePath, {
            shouldAutoInstall: true,
          });

          content = await preprocessor.render(content, {});
        }
      }
      let templateComp = compiler.compileTemplate({
        filename: asset.filePath,
        source: content,
        inMap: template.src ? undefined : template.map,
        isFunctional,
        compilerOptions: {
          scopeId,
        },
      });
      if (templateComp.errors.length) {
        throw new ThrowableDiagnostic({
          diagnostic: templateComp.errors.map(err => {
            return createDiagnostic(err, asset.filePath);
          }),
        });
      }
      let templateAsset: TransformerResult = {
        type: 'js',
        uniqueKey: asset.id + '-template',
        ...(!template.src &&
          asset.env.sourceMap && {
            map: createMap(templateComp.map, options.projectRoot),
          }),
        content:
          templateComp.code +
          `
${
  options.hmrOptions
    ? `if (module.hot) {
  module.hot.accept(() => {
    __VUE_HMR_RUNTIME__.rerender('${hmrId}', render);
  })
}`
    : ''
}`,
      };
      return [templateAsset];
    }
    case 'script': {
      if (script.src) {
        script.content = (
          await options.inputFS.readFile(
            await resolve(asset.filePath, script.src),
          )
        ).toString();
        script.lang = extname(script.src);
      }
      let type;
      switch (script.lang || 'js') {
        case 'javascript':
        case 'js':
          type = 'js';
          break;
        case 'typescript':
        case 'ts':
          type = 'ts';
          break;
        case 'coffeescript':
        case 'coffee':
          type = 'coffee';
          break;
        default:
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `Unknown script language: "${script.lang}"`,
              origin: '@parcel/transformer-vue',
              filePath: asset.filePath,
            },
          });
      }
      let scriptAsset = {
        type,
        uniqueKey: asset.id + '-script',
        content: script.content,
        ...(!script.src &&
          asset.env.sourceMap && {
            map: createMap(script.map, options.projectRoot),
          }),
      };

      return [scriptAsset];
    }
    case 'style': {
      let cssModules = {};
      let assets = await Promise.all(
        styles.map(async (style, i) => {
          if (style.src) {
            style.content = (
              await options.inputFS.readFile(
                await resolve(asset.filePath, style.src),
              )
            ).toString();
            if (!style.module) {
              style.module = MODULE_BY_NAME_RE.test(style.src);
            }
            style.lang = extname(style.src);
          }
          let toInstall;
          switch (style.lang) {
            case 'less':
              toInstall = 'less';
              break;
            case 'stylus':
            case 'styl':
              toInstall = 'stylus';
              break;
            case 'scss':
            case 'sass':
              toInstall = 'sass';
              break;
            case 'css':
            case undefined:
              break;
            default:
              throw new ThrowableDiagnostic({
                diagnostic: {
                  message: `Unknown style language: "${style.lang}"`,
                  origin: '@parcel/transformer-vue',
                  filePath: asset.filePath,
                },
              });
          }
          if (toInstall) {
            await options.packageManager.require(toInstall, asset.filePath, {
              shouldAutoInstall: options.shouldAutoInstall,
            });
          }
          let styleComp = await compiler.compileStyleAsync({
            filename: asset.filePath,
            source: style.content,
            modules: style.module,
            preprocessLang: style.lang || 'css',
            scoped: style.scoped,
            map: style.src ? undefined : style.map,
            id: scopeId,
          });
          if (styleComp.errors.length) {
            throw new ThrowableDiagnostic({
              diagnostic: styleComp.errors.map(err => {
                return createDiagnostic(err, asset.filePath);
              }),
            });
          }
          let styleAsset = {
            type: 'css',
            content: styleComp.code,
            sideEffects: true,
            ...(!style.src &&
              asset.env.sourceMap && {
                map: createMap(style.map, options.projectRoot),
              }),
            uniqueKey: asset.id + '-style' + i,
          };
          if (styleComp.modules) {
            if (typeof style.module === 'boolean') style.module = '$style';
            cssModules[style.module] = {
              ...cssModules[style.module],
              ...styleComp.modules,
            };
          }
          return styleAsset;
        }),
      );
      if (Object.keys(cssModules).length !== 0) {
        assets.push({
          type: 'js',
          uniqueKey: asset.id + '-cssModules',
          content: `
import {render} from 'template:./${basePath}';
let cssModules = ${JSON.stringify(cssModules)};
${
  options.hmrOptions
    ? `if (module.hot) {
  module.hot.accept(() => {
    __VUE_HMR_RUNTIME__.rerender('${hmrId}', render);
  });
};`
    : ''
}
export default cssModules;`,
        });
      }
      return assets;
    }
    case 'custom': {
      let toCall = [];
      // To satisfy flow
      if (!config) return [];
      let types = new Set();
      for (let block of customBlocks) {
        let {type, src, content, attrs} = block;
        if (!config.customBlocks[type]) {
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `No preprocessor found for block type ${type}`,
              origin: '@parcel/transformer-vue',
              filePath: asset.filePath,
            },
          });
        }
        if (src) {
          content = (
            await options.inputFS.readFile(await resolve(asset.filePath, src))
          ).toString();
        }
        toCall.push([type, content, attrs]);
        types.add(type);
      }
      return [
        {
          type: 'js',
          uniqueKey: asset.id + '-custom',
          content: `
let NOOP = () => {};
${(
  await Promise.all(
    [...types].map(
      async type =>
        `import p${type} from './${relative(
          dirname(asset.filePath),
          await resolve(config.filePath, config.customBlocks[type]),
        )}';
if (typeof p${type} !== 'function') {
  p${type} = NOOP;
}`,
    ),
  )
).join('\n')}
export default script => {
  ${toCall
    .map(
      ([type, content, attrs]) =>
        `  p${type}(script, ${JSON.stringify(content)}, ${JSON.stringify(
          attrs,
        )});`,
    )
    .join('\n')}
}`,
        },
      ];
    }
    default: {
      return [];
    }
  }
}

function createMap(rawMap, projectRoot: string) {
  let newMap = new SourceMap(projectRoot);
  newMap.addRawMappings(rawMap);
  return newMap;
}
