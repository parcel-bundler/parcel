// @flow
/* eslint-disable no-unused-vars */
import type {
  ExportDeclaration,
  Expression,
  Identifier,
  ImportClause,
  ImportDeclaration,
  ImportSpecifier,
  Modifier,
  NamedImportBindings,
} from 'typescript';

import ts from 'typescript';
import invariant from 'assert';

type AssertClause = any;
type NamedExportBindings = any;

const [majorVersion, minorVersion] = ts.versionMajorMinor
  .split('.')
  .map(num => parseInt(num, 10));

// Everything below was generated using https://github.com/mischnic/tsc-version-wrapper

export const createImportClause: (
  factory: any,
  isTypeOnly: boolean,
  name: Identifier | void,
  namedBindings: NamedImportBindings | void,
) => ImportClause = (() => {
  if (majorVersion > 4 || (majorVersion === 4 && minorVersion >= 0)) {
    return (factory, isTypeOnly, name, namedBindings) =>
      factory.createImportClause(isTypeOnly, name, namedBindings);
  } else if (majorVersion > 3 || (majorVersion === 3 && minorVersion >= 8)) {
    return (factory, isTypeOnly, name, namedBindings) =>
      factory.createImportClause(name, namedBindings, isTypeOnly);
  } else if (majorVersion > 3 || (majorVersion === 3 && minorVersion >= 0)) {
    return (factory, isTypeOnly, name, namedBindings) =>
      factory.createImportClause(name, namedBindings);
  } else {
    invariant(false);
  }
})();

export const createImportDeclaration: (
  factory: any,
  modifiers: Modifier[] | void,
  importClause: ImportClause | void,
  moduleSpecifier: Expression,
  assertClause: AssertClause,
) => ImportDeclaration = (() => {
  if (majorVersion > 4 || (majorVersion === 4 && minorVersion >= 8)) {
    return (factory, modifiers, importClause, moduleSpecifier, assertClause) =>
      factory.createImportDeclaration(
        modifiers,
        importClause,
        moduleSpecifier,
        assertClause,
      );
  } else if (majorVersion > 4 || (majorVersion === 4 && minorVersion >= 5)) {
    return (factory, modifiers, importClause, moduleSpecifier, assertClause) =>
      factory.createImportDeclaration(
        undefined /* decorators */,
        modifiers,
        importClause,
        moduleSpecifier,
        assertClause,
      );
  } else if (majorVersion > 3 || (majorVersion === 3 && minorVersion >= 0)) {
    return (factory, modifiers, importClause, moduleSpecifier, assertClause) =>
      factory.createImportDeclaration(
        undefined /* decorators */,
        modifiers,
        importClause,
        moduleSpecifier,
      );
  } else {
    invariant(false);
  }
})();

export const createImportSpecifier: (
  factory: any,
  isTypeOnly: boolean,
  propertyName: Identifier | void,
  name: Identifier,
) => ImportSpecifier = (() => {
  if (majorVersion > 4 || (majorVersion === 4 && minorVersion >= 5)) {
    return (factory, isTypeOnly, propertyName, name) =>
      factory.createImportSpecifier(isTypeOnly, propertyName, name);
  } else if (majorVersion > 3 || (majorVersion === 3 && minorVersion >= 0)) {
    return (factory, isTypeOnly, propertyName, name) =>
      factory.createImportSpecifier(propertyName, name);
  } else {
    invariant(false);
  }
})();

export const updateExportDeclaration: (
  factory: any,
  node: ExportDeclaration,
  modifiers: Modifier[] | void,
  isTypeOnly: boolean,
  exportClause: NamedExportBindings | void,
  moduleSpecifier: Expression | void,
  assertClause: AssertClause | void,
) => ExportDeclaration = (() => {
  if (majorVersion > 4 || (majorVersion === 4 && minorVersion >= 8)) {
    return (
      factory,
      node,
      modifiers,
      isTypeOnly,
      exportClause,
      moduleSpecifier,
      assertClause,
    ) =>
      factory.updateExportDeclaration(
        node,
        modifiers,
        isTypeOnly,
        exportClause,
        moduleSpecifier,
        assertClause,
      );
  } else if (majorVersion > 4 || (majorVersion === 4 && minorVersion >= 5)) {
    return (
      factory,
      node,
      modifiers,
      isTypeOnly,
      exportClause,
      moduleSpecifier,
      assertClause,
    ) =>
      factory.updateExportDeclaration(
        node,
        undefined /* decorators */,
        modifiers,
        isTypeOnly,
        exportClause,
        moduleSpecifier,
        assertClause,
      );
  } else if (majorVersion > 4 || (majorVersion === 4 && minorVersion >= 0)) {
    return (
      factory,
      node,
      modifiers,
      isTypeOnly,
      exportClause,
      moduleSpecifier,
      assertClause,
    ) =>
      factory.updateExportDeclaration(
        node,
        undefined /* decorators */,
        modifiers,
        isTypeOnly,
        exportClause,
        moduleSpecifier,
      );
  } else if (majorVersion > 3 || (majorVersion === 3 && minorVersion >= 8)) {
    return (
      factory,
      node,
      modifiers,
      isTypeOnly,
      exportClause,
      moduleSpecifier,
      assertClause,
    ) =>
      factory.updateExportDeclaration(
        node,
        undefined /* decorators */,
        modifiers,
        exportClause,
        moduleSpecifier,
        isTypeOnly,
      );
  } else if (majorVersion > 3 || (majorVersion === 3 && minorVersion >= 0)) {
    return (
      factory,
      node,
      modifiers,
      isTypeOnly,
      exportClause,
      moduleSpecifier,
      assertClause,
    ) =>
      factory.updateExportDeclaration(
        node,
        undefined /* decorators */,
        modifiers,
        exportClause,
        moduleSpecifier,
      );
  } else {
    invariant(false);
  }
})();
