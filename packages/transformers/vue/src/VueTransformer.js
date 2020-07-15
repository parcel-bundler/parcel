import {Transformer} from '@parcel/plugin';
import nullthrows from 'nullthrows';
import ThrowableDiagnostic from '@parcel/diagnostic';
import SourceMap from '@parcel/source-map';
import semver from 'semver';

// TODO: flow

export default new Transformer({
  async canReuseAST({ast}) {
    return ast.type === 'vue' && semver.satisfies(ast.version, '3.0.0-beta.20');
  },
  async parse({asset, options}) {
    let compiler = await options.packageManager.require(
      '@vue/compiler-sfc',
      __filename,
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
    let compiler = await options.packageManager.require(
      '@vue/compiler-sfc',
      __filename,
      {autoinstall: options.autoinstall},
    );
    let ast = nullthrows(await asset.getAST());
    let {template, script, styles} = ast.program;
    let assets = [];
    let scopeId =
      styles && styles.some(s => s.scoped)
        ? `data-v-${asset.id.slice(-6)}`
        : undefined;
    if (template == null) {
      // TODO: Is this acceptable?
      throw new ThrowableDiagnostic({
        diagnostic: {
          message: 'No template found',
          origin: '@parcel/transformer-vue',
          filePath: asset.filePath,
        },
      });
    }
    let isFunctional = template.functional;
    if (template.src) {
      template.content = (
        await options.inputFS.readFile(
          await resolve(asset.filePath, template.src),
        )
      ).toString();
    }
    let templateComp = compiler.compileTemplate({
      filename: asset.filePath,
      source: template.content,
      preprocessLang: template.lang,
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
      content: templateComp.code,
    };
    // TODO: Workaround?
    if (!templateComp.src) {
      let map = new SourceMap();
      map.addRawMappings(templateComp.map);
      templateAsset.map = map;
    }
    assets.push(templateAsset);
    if (script != null) {
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
              message: `Unknown script language: ${script.lang}`,
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
        content: script.content,
      };

      if (!script.src) {
        let map = new SourceMap();
        map.addRawMappings(script.map);
        scriptAsset.map = map;
      }
      assets.push(scriptAsset);
    }

    if (styles != null) {
      for (let style of styles) {
        if (style.src) {
          style.content = (
            await options.inputFS.readFile(
              await resolve(asset.filePath, style.src),
            )
          ).toString();
        }
        // TODO: CSS Modules?
        let styleComp = compiler.compileStyle({
          source: style.content,
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
        };
        if (!style.src) {
          let map = new SourceMap();
          map.addRawMappings(styleComp.map);
          styleAsset.map = map;
        }

        assets.push(styleAsset);
      }
    }
    return assets;
  },
  async postProcess({assets}) {
    let js = '';
    let map = new SourceMap();
    let finalAssets = [];
    let deps = [];
    for (let asset of assets) {
      if (asset.type === 'js') {
        // TODO: Better way?
        map.addBufferMappings((await asset.getMap()).toBuffer(), 0, js.length);
        js += await asset.getCode();
        deps = deps.concat((await asset.getDependencies()).map(rewriteDep));
      } else {
        finalAssets.push({
          type: asset.type,
          content: await asset.getCode(),
          map: await asset.getMap(),
          dependencies: (await asset.getDependencies()).map(rewriteDep),
        });
      }
    }
    // TODO: Improve
    let id = assets[0].id;
    // Does this even work?
    js += `
if (module.hot) {
  module.exports.__hmrId = '${id}';
  var api = __VUE_HMR_RUNTIME__;
  module.hot.accept(() => {
    api.rerender('${id}', render);
  })
  if (!api.createRecord('${id}', script)) {
    api.reload('${id}', script);
  }
}
if (!module.exports.default) {
  module.exports.default = {};
}
module.exports.default.render = module.exports.render;
delete module.exports.render;`;
    finalAssets.push({
      type: 'js',
      content: js,
      map,
      dependencies: deps,
    });
    return finalAssets;
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

function rewriteDep(dep) {
  return {
    moduleSpecifier: dep.moduleSpecifier,
    isAsync: dep.isAsync,
    isEntry: dep.isEntry,
    isOptional: dep.isOptional,
    isURL: dep.isURL,
    isWeak: dep.isWeak,
    loc: dep.loc,
    env: dep.env,
    meta: dep.meta,
    target: dep.target,
    symbols: dep.symbols,
  };
}
