// @flow
import v8 from 'v8';

// $FlowFixMe - Flow doesn't know about this method yet
export let serializeRaw: any => Buffer = v8.serialize;
// $FlowFixMe - Flow doesn't know about this method yet
export let deserializeRaw: Buffer => any = v8.deserialize;
