// @flow
import type {TSModule, Export} from './TSModule';
import typeof TypeScriptModule from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies
import nullthrows from 'nullthrows';
import invariant from 'assert';

export class TSModuleGraph {
  ts: TypeScriptModule;
  modules: Map<string, TSModule>;
  mainModuleName: string;
  mainModule: ?TSModule;

  constructor(ts: TypeScriptModule, mainModuleName: string) {
    this.ts = ts;
    this.modules = new Map();
    this.mainModuleName = mainModuleName;
    this.mainModule = null;
  }

  addModule(name: string, module: TSModule) {
    this.modules.set(name, module);
    if (name === this.mainModuleName) {
      this.mainModule = module;
    }
  }

  getModule(name: string) {
    return this.modules.get(name);
  }

  markUsed(module: TSModule, name: string, context: any) {
    let {ts} = this;

    // If name is imported, mark used in the original module
    if (module.imports.has(name)) {
      module.used.add(name);
      let {specifier, imported} = nullthrows(module.imports.get(name));
      let m = this.getModule(specifier);
      if (!m) {
        return;
      }

      return this.markUsed(m, imported, context);
    }

    if (module.used.has(name)) {
      return;
    }

    module.used.add(name);

    // Visit all child nodes of the original binding and mark any referenced types as used.
    let visit = (node: any) => {
      if (ts.isQualifiedName(node) && ts.isIdentifier(node.left)) {
        let resolved = this.resolveImport(
          module,
          node.left.text,
          node.right.text,
        );
        if (resolved) {
          this.markUsed(resolved.module, resolved.imported, context);
        }
      } else if (ts.isIdentifier(node)) {
        this.markUsed(module, node.text, context);
      }

      return ts.visitEachChild(node, visit, context);
    };

    let node = module.bindings.get(name);
    if (node) {
      ts.visitEachChild(node, visit, context);
    }
  }

  getExport(m: TSModule, e: Export) {
    invariant(e.name != null);
    let exportName = e.name;

    // Re-export
    if (e.specifier && e.imported) {
      let m = this.getModule(e.specifier);
      if (!m) {
        return null;
      }

      let exp = this.resolveExport(m, e.imported);
      if (!exp) {
        return null;
      }

      return {module: exp.module, imported: exp.name, name: exportName};
    }

    // Import and then export
    if (m.imports.has(exportName)) {
      let imp = this.resolveImport(m, exportName);
      if (!imp) {
        return null;
      }

      return {module: imp.module, imported: imp.name, name: exportName};
    }

    // Named export
    return {
      module: m,
      name: m.getName(exportName),
      imported: e.imported || exportName,
    };
  }

  resolveImport(module: TSModule, local: string, imported?: string) {
    let i = module.imports.get(local);
    if (!i) {
      return null;
    }

    let m = this.getModule(i.specifier);
    if (!m) {
      // External module. pass through the import.
      return {module, name: local, imported: imported || i.imported};
    }

    return this.resolveExport(m, imported || i.imported);
  }

  resolveExport(module: TSModule, name: string) {
    for (let e of module.exports) {
      if (e.name === name) {
        return this.getExport(module, e);
      } else if (e.specifier) {
        return this.resolveExport(
          nullthrows(this.getModule(e.specifier)),
          name,
        );
      }
    }
  }

  getAllExports(
    module: TSModule = nullthrows(this.mainModule),
    excludeDefault: boolean = false,
  ) {
    let res = [];
    for (let e of module.exports) {
      if (e.name && (!excludeDefault || e.name !== 'default')) {
        let exp = this.getExport(module, e);
        if (exp) {
          res.push(exp);
        }
      } else if (e.specifier) {
        let m = this.getModule(e.specifier);
        if (m) {
          res.push(...this.getAllExports(m, true));
        }
      }
    }
    return res;
  }

  getAllImports() {
    // Build a map of all imports for external modules
    let importsBySpecifier: Map<string, Map<string, string>> = new Map();
    for (let module of this.modules.values()) {
      for (let [name, imp] of module.imports) {
        if (module.used.has(name) && !this.modules.has(imp.specifier)) {
          let importMap = importsBySpecifier.get(imp.specifier);
          if (!importMap) {
            importMap = new Map();
            importsBySpecifier.set(imp.specifier, importMap);
          }

          name = module.getName(name);
          importMap.set(name, imp.imported);
        }
      }
    }

    return importsBySpecifier;
  }

  propagate(context: any) {
    // Resolve all exported values, and mark them as used.
    let names = Object.create(null);
    let exportedNames = new Map<string, TSModule>();
    for (let e of this.getAllExports()) {
      this.markUsed(e.module, e.imported, context);
      e.module.names.set(e.imported, e.name);
      names[e.name] = 1;
      exportedNames.set(e.name, e.module);
    }

    // Assign unique names across all modules
    for (let m of this.modules.values()) {
      for (let [orig, name] of m.names) {
        if (exportedNames.has(name) && exportedNames.get(name) === m) {
          continue;
        }

        if (!m.used.has(orig) || m.imports.get(orig)) {
          continue;
        }

        if (names[name]) {
          m.names.set(name, `_${name}${names[name]++}`);
        } else {
          names[name] = 1;
        }
      }
    }

    return exportedNames;
  }
}
