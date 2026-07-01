import type {TypeOnlyValue} from './dep-type-only-import';

const value: TypeOnlyValue = {done: true};

output = value.done ? 'type-only-import-done' : 'type-only-import-failed';
