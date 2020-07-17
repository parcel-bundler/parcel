import {Transformer} from '@parcel/plugin';
import nullthrows from 'nullthrows';
import {md5FromObject} from '@parcel/utils';
import ThrowableDiagnostic from '@parcel/diagnostic';
import SourceMap from '@parcel/source-map';
import semver from 'semver';
import {basename} from 'path';

const MODULE_BY_NAME_RE = /\.module\./;

// TODO: flow
export default new Transformer({
  async canReuseAST({ast}) {
    return ast.type === 'vue' && semver.satisfies(ast.version, '3.0.0-beta.20');
  },
  async parse({asset, options}) {
    // TODO: This parses the vue component multiple times. Fix?
    let compiler = await options.packageManager.require(
      '@vue/compiler-sfc',
      asset.filePath,
      {autoinstall: options.autoinstall},
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
      version: '3.0.0-beta.20',
      program: parsed.descriptor,
    };
  },
  async transform({asset, options, resolve}) {
    let baseId = md5FromObject({
      filePath: asset.filePath,
    }).slice(-6);
    let scopeId = 'data-v-' + baseId;
    let hmrId = baseId + '-hmr';

    let {template, script, styles} = nullthrows(await asset.getAST()).program;
    if (styles.every(s => !s.scoped)) {
      scopeId = undefined;
    }
    if (asset.pipeline) {
      return processPipeline({
        asset,
        template,
        script,
        styles,
        options,
        resolve,
        scopeId,
        hmrId,
      });
    }
    let basePath = basename(asset.filePath);
    let out =
      script == null
        ? 'let script = {};\n'
        : `import script from 'script:./${basePath}';\n`;
    if (template != null) {
      out +=
        `import {render} from 'template:./${basePath}';\n` +
        'script.render = render;\n';
    }
    // TODO: CSS Modules
    if (styles.length) {
      // Nothing happens if CSS modules is disabled
      out += `import setCSSModules from 'styler:./${basePath}';
setCSSModules(script.__cssModules = {});
`;
      // Assume CSS Modules
    }
    // TODO: disable HMR injection in production mode?
    out += `
${scopeId ? `script.__scopeId = '${scopeId}';` : ''}
script.__file = '${options.mode === 'production' ? basePath : asset.filePath}';
if (module.hot) {
  script.__hmrId = '${hmrId}';
  module.hot.accept();
  if (!__VUE_HMR_RUNTIME__.createRecord('${hmrId}', script)) {
    __VUE_HMR_RUNTIME__.reload('${hmrId}', script);
  }
}
export default script;`;
    return [
      {
        type: 'js',
        content: out,
      },
    ];
  },
});

function createDiagnostic(err, filePath) {
  if (typeof err === 'string') {
    return {
      message: err,
      origin: '@parcel/transformer-vue',
      filePath,
    };
  }
  let diagnostic = {
    message: err.message,
    origin: '@parcel/transformer-vue',
    name: err.name,
    stack: err.stack,
    filePath,
  };
  if (err.loc) {
    diagnostic.codeFrame = {
      code,
      codeHighlights: {
        start: {
          line: err.loc.start.line + err.loc.start.offset,
          column: err.loc.start.column,
        },
        end: {
          line: err.loc.end.line + err.loc.end.offset,
          column: err.loc.end.column,
        },
      },
    };
  }
  return diagnostic;
}

async function processPipeline({
  asset,
  template,
  script,
  styles,
  options,
  resolve,
  scopeId,
  hmrId,
}) {
  let compiler = await options.packageManager.require(
    '@vue/compiler-sfc',
    asset.filePath,
    {autoinstall: options.autoinstall},
  );
  let consolidate = await options.packageManager.require(
    'consolidate',
    asset.filePath,
    {autoinstall: false}, // Would have failed by now if it needed autoinstall
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
      }
      let content = template.content;
      if (template.lang && !['htm', 'html'].includes(template.lang)) {
        let preprocessor = consolidate[template.lang];
        if (!preprocessor) {
          throw new ThrowableDiagnostic({
            diagnostic: {
              content: `Unknown template language: "${template.lang}"`,
              origin: '@parcel/transformer-vue',
              filePath: asset.filePath,
            },
          });
        }
        try {
          content = await preprocessor.render(content, {});
        } catch (e) {
          if (e.code !== 'MODULE_NOT_FOUND' || !options.autoinstall) {
            throw e;
          }
          let firstIndex = e.message.indexOf("'");
          let secondIndex = e.message.indexOf("'", firstIndex + 1);
          let toInstall = e.message.slice(firstIndex + 1, secondIndex);

          await options.packageManager.install(
            [{name: toInstall}],
            asset.filePath,
          );

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
      let templateAsset = {
        type: 'js',
        uniqueKey: asset.id + '-template',
        content:
          templateComp.code +
          `
if (module.hot) {
  module.hot.accept(() => {
    __VUE_HMR_RUNTIME__.rerender('${hmrId}', render);
  })
}`,
      };
      // TODO: Workaround?
      if (!templateComp.src) {
        let map = new SourceMap();
        map.addRawMappings(templateComp.map);
        templateAsset.map = map;
      }
      return [templateAsset];
    }
    case 'script': {
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
      if (script.src) {
        script.content = (
          await options.inputFS.readFile(
            await resolve(asset.filePath, script.src),
          )
        ).toString();
      }
      let scriptAsset = {
        type,
        uniqueKey: asset.id + '-script',
        content: script.content,
      };

      if (!script.src) {
        let map = new SourceMap();
        map.addRawMappings(script.map);
        scriptAsset.map = map;
      }
      return [scriptAsset];
    }
    case 'styler': {
      let basePath = basename(asset.filePath);
      return [
        {
          type: 'js',
          content: `
import style from 'style:./${basePath}';
import {render} from 'template:./${basePath}';
let cssModules = {};
cssModules['$style'] = style;
if (module.hot) {
  module.hot.accept(() => {
    // TODO: Support custom module names
    cssModules['$style'] = style;
    __VUE_HMR_RUNTIME__.rerender('${hmrId}', render);
  });
};
export default realCSSModules => {
  for (let k in cssModules) {
    realCSSModules[k] = cssModules[k];
  }
  cssModules = realCSSModules;
};`,
          uniqueKey: asset.id + '-styler',
        },
      ];
    }
    case 'style': {
      let extraAssets = [];
      let baseAssets = await Promise.all(
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
          }
          // TODO: CSS Modules?
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
            sideEffects: !style.module,
            uniqueKey: asset.id + '-style' + i,
          };
          if (styleComp.modules) {
            extraAssets.push({
              type: 'js',
              content: `module.exports=${JSON.stringify(styleComp.modules)};`,
              uniqueKey: asset.id + '-modules' + i,
            });
          }
          if (!style.src) {
            let map = new SourceMap();
            map.addRawMappings(styleComp.map);
            styleAsset.map = map;
          }
          return styleAsset;
        }),
      );
      return baseAssets.concat(extraAssets);
    }
    default: {
      return [];
    }
  }
}
