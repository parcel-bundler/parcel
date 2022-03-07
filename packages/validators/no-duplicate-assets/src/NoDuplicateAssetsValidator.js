// @flow
import {Validator} from '@parcel/plugin';
import {type DiagnosticCodeFrame, escapeMarkdown} from '@parcel/diagnostic';
import eslint from 'eslint';
import invariant from 'assert';

let cliEngine = null;

export default (new Validator({
  async validateBundle({bundle, bundleGraph}) {},
}): Validator);
