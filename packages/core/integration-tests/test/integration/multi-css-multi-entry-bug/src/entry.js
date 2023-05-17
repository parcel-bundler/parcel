// This repro was taken from https://github.com/parcel-bundler/parcel/issues/8813

import './main.css';

import './Foo/foo.css';

import('./Foo');
import('./index-sib');