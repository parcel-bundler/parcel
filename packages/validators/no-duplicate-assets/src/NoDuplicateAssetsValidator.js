// @flow
import {Validator} from '@parcel/plugin';
import {type DiagnosticCodeFrame, escapeMarkdown} from '@parcel/diagnostic';
import invariant from 'assert';

// only do this in prod?
export default (new Validator({
  async validateBundles({bundleGraph}) {},
}): Validator);
