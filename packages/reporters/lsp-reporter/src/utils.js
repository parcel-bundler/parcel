// @flow
import type {DiagnosticLogEvent, FilePath, SourceLocation} from '@parcel/types';
import type {ODiagnosticSeverity, Position, Range} from 'vscode-languageserver';

import path from 'path';
import {DiagnosticSeverity} from './protocol';

export type ParcelSeverity = DiagnosticLogEvent['level'];

export function parcelSeverityToLspSeverity(
  parcelSeverity: ParcelSeverity,
): ODiagnosticSeverity {
  switch (parcelSeverity) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warn':
      return DiagnosticSeverity.Warning;
    case 'info':
      return DiagnosticSeverity.Information;
    case 'verbose':
      return DiagnosticSeverity.Hint;
    default:
      throw new Error('Unknown severity');
  }
}

export function normalizeFilePath(
  filePath: FilePath,
  projectRoot: FilePath,
): FilePath {
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(projectRoot, filePath);
}

export function isInRange(loc: SourceLocation, position: Position): boolean {
  let pos = {line: position.line + 1, column: position.character + 1};

  if (pos.line < loc.start.line || loc.end.line < pos.line) {
    return false;
  }
  if (pos.line === loc.start.line) {
    return loc.start.column <= pos.column;
  }
  if (pos.line === loc.end.line - 1) {
    return pos.column < loc.start.column;
  }
  return true;
}

export const RANGE_DUMMY: Range = {
  start: {line: 0, character: 0},
  end: {line: 0, character: 0},
};
