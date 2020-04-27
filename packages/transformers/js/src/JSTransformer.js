// @flow

import type {GlobalsMap} from './visitors/globals';

import template from '@babel/template';
import semver from 'semver';
import {Transformer} from '@parcel/plugin';
import collectDependencies from './visitors/dependencies';
import processVisitor from './visitors/process';
import fsVisitor from './visitors/fs';
import insertGlobals from './visitors/globals';
import traverse from '@babel/traverse';
import {ancestor as walkAncestor} from '@parcel/babylon-walk';
import * as babelCore from '@babel/core';
import {hoist} from '@parcel/scope-hoisting';
import {generate, parse} from '@parcel/babel-ast-utils';

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const ENV_RE = /\b(?:process\.env)\b/;
const BROWSER_RE = /\b(?:process\.browser)\b/;
const GLOBAL_RE = /\b(?:process|__dirname|__filename|global|Buffer|define)\b/;
const FS_RE = /\breadFileSync\b/;
const SW_RE = /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/;
const WORKER_RE = /\bnew\s*(?:Shared)?Worker\s*\(/;

// Sourcemap extraction
// const SOURCEMAP_RE = /\/\/\s*[@#]\s*sourceMappingURL\s*=\s*([^\s]+)/;
// const DATA_URL_RE = /^data:[^;]+(?:;charset=[^;]+)?;base64,(.*)/;

function canHaveDependencies(code) {
  return (
    IMPORT_RE.test(code) ||
    GLOBAL_RE.test(code) ||
    SW_RE.test(code) ||
    WORKER_RE.test(code)
  );
}

export default new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async parse({asset, options}) {
    let code = await asset.getCode();
    if (
      !asset.env.scopeHoist &&
      !canHaveDependencies(code) &&
      !ENV_RE.test(code) &&
      !BROWSER_RE.test(code) &&
      !FS_RE.test(code)
    ) {
      return null;
    }

    return parse({
      asset,
      code,
      options,
    });
  },

  async transform({asset, options, logger}) {
    // When this asset is an bundle entry, allow that bundle to be split to load shared assets separately.
    // Only set here if it is null to allow previous transformers to override this behavior.
    if (asset.isSplittable == null) {
      asset.isSplittable = true;
    }

    asset.type = 'js';
    let ast = await asset.getAST();
    if (!ast) {
      return [asset];
    }

    let code = asset.isASTDirty() ? null : await asset.getCode();

    // Inline process/environment variables
    if (
      (!asset.env.isNode() && (code == null || ENV_RE.test(code))) ||
      (asset.env.isBrowser() && (code == null || BROWSER_RE.test(code)))
    ) {
      walkAncestor(ast.program, processVisitor, {
        asset,
        ast,
        env: options.env,
        isNode: asset.env.isNode(),
        isBrowser: asset.env.isBrowser(),
      });
    }

    let isASTDirty;
    if (!asset.env.isNode()) {
      // Inline fs calls, run before globals to also collect Buffer
      if (code == null || FS_RE.test(code)) {
        // Check if we should ignore fs calls
        // See https://github.com/defunctzombie/node-browser-resolve#skip
        let pkg = await asset.getPackage();
        let ignore =
          pkg &&
          pkg.browser &&
          typeof pkg.browser === 'object' &&
          pkg.browser.fs === false;

        if (!ignore) {
          traverse.cache.clearScope();
          traverse(ast.program, fsVisitor, null, {asset, logger, ast});
        }
      }

      // Insert node globals
      if (code == null || GLOBAL_RE.test(code)) {
        let globals: GlobalsMap = new Map();
        walkAncestor(ast.program, insertGlobals, {asset, globals});

        if (globals.size > 0) {
          ast.program.program.body.unshift(
            ...[...globals.values()]
              .filter(Boolean)
              .map(({code}) => template.statement(code)()),
          );
          isASTDirty = true;
        }
      }
    }

    // Collect dependencies
    if (code == null || canHaveDependencies(code)) {
      walkAncestor(ast.program, collectDependencies, {asset, ast, options});
    }

    // If there's a hashbang, remove it and store it on the asset meta.
    // During packaging, if this is the entry asset, it will be prepended to the
    // packaged output.
    if (ast.program.program.interpreter != null) {
      asset.meta.interpreter = ast.program.program.interpreter.value;
      delete ast.program.program.interpreter;
      isASTDirty = true;
    }

    if (isASTDirty) {
      asset.setAST(ast);
    }

    if (asset.env.scopeHoist) {
      hoist(asset, ast);
    } else if (asset.meta.isES6Module) {
      // Convert ES6 modules to CommonJS
      let res = await babelCore.transformFromAstAsync(
        ast.program,
        code ?? undefined,
        {
          code: false,
          ast: true,
          filename: asset.filePath,
          babelrc: false,
          configFile: false,
          plugins: [require('@babel/plugin-transform-modules-commonjs')],
        },
      );

      asset.setAST({
        type: 'babel',
        version: '7.0.0',
        program: res.ast,
      });
    }

    return [asset];
  },

  generate({asset, ast, options}) {
    return generate({asset, ast, options});
  },
});
