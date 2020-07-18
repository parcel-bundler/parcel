// @flow strict-local
import {Transformer} from '@parcel/plugin';
import nullthrows from 'nullthrows';
import {md5FromObject} from '@parcel/utils';
import ThrowableDiagnostic from '@parcel/diagnostic';
import type {Diagnostic} from '@parcel/diagnostic';
import type {TransformerResult} from '@parcel/types';
import SourceMap from '@parcel/source-map';
import semver from 'semver';
import {basename, extname} from 'path';

const MODULE_BY_NAME_RE = /\.module\./;

export default (new Transformer({
  canReuseAST({ast}) {
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
    let basePath = basename(asset.filePath);
    let {template, script, styles} = nullthrows(await asset.getAST()).program;
    if (styles.every(s => !s.scoped)) {
      scopeId = undefined;
    }
    if (asset.pipeline != null) {
      return processPipeline({
        asset,
        template,
        script,
        styles,
        basePath,
        options,
        resolve,
        scopeId,
        hmrId,
      });
    }
    let out =
      script == null
        ? 'let script = {};\n'
        : `import script from 'script:./${basePath}';\n`;
    if (template != null) {
      out +=
        `import {render} from 'template:./${basePath}';\n` +
        'script.render = render;\n';
    }
    if (styles.length) {
      if (!template) {
        throw new ThrowableDiagnostic({
          diagnostic: {
            message: 'Cannot style a component without a template',
            origin: '@parcel/transformer-vue',
            filePath: asset.filePath,
          },
        });
      }
      // Nothing happens if CSS modules is disabled
      out += `import cssModules from 'style:./${basePath}';
script.__cssModules = cssModules;
`;
    }
    out += `
${scopeId != null ? `script.__scopeId = '${scopeId}';` : ''}
script.__file = '${options.mode === 'production' ? basePath : asset.filePath}';
${
  options.hot
    ? `if (module.hot) {
  script.__hmrId = '${hmrId}';
  module.hot.accept();
  if (!__VUE_HMR_RUNTIME__.createRecord('${hmrId}', script)) {
    __VUE_HMR_RUNTIME__.reload('${hmrId}', script);
  }
}`
    : ''
}
export default script;`;
    return [
      {
        type: 'js',
        content: out,
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
  basePath,
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
          if (e.code !== 'MODULE_NOT_FOUND' || !options.autoinstall) {
            throw e;
          }
          let firstIndex = e.message.indexOf("'");
          let secondIndex = e.message.indexOf("'", firstIndex + 1);
          let toInstall = e.message.slice(firstIndex + 1, secondIndex);

          await options.packageManager.require(toInstall, asset.filePath, {
            autoinstall: true,
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
        ...(!template.src && {map: createMap(templateComp.map)}),
        content:
          templateComp.code +
          `
${
  options.hot
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
        ...(!script.src && {map: createMap(script.map)}),
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
            ...(!style.src && {map: createMap(style.map)}),
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
      if (cssModules.length !== 0) {
        assets.push({
          type: 'js',
          uniqueKey: asset.id + '-cssModules',
          content: `
import {render} from 'template:./${basePath}';
let cssModules = ${JSON.stringify(cssModules)};
${
  options.hot
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
    default: {
      return [];
    }
  }
}

function createMap(...params) {
  let newMap = new SourceMap();
  newMap.addRawMappings(...params);
  return newMap;
}
