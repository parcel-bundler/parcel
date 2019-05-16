// @flow
import type {Position} from 'source-map';

export type Mapping = {|
  +generated: Position,
  +original: Position,
  +source: string,
  +name: string
|};
