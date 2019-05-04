import {h} from 'preact';

const PATH_REGEX = /\/src\//g;

export function ParcelError(props) {
  return (
    <Box class="error" header={<span>A build error occured:</span>}>
      {props.error.message.trim().replace(PATH_REGEX, '')}
    </Box>
  );
}

export function Box(props) {
  return (
    <div class={`file ${props.class || ''}`}>
      {props.header && <div class="header">{props.header}</div>}
      <div class="content">{props.children}</div>
    </div>
  );
}

export function Notes() {
  return (
    <div class="file notes">
      Yes, this is Parcel as a (nearly) self-hosting bundler (self-
      <i>scope-hoisting</i> doesn't work ...)
      <br />
      The Parcel portion of this page, including all asset types, is a 2.8MB
      gzipped bundle running in a Web Worker
      <br />
      <br />
      Hotkeys:
      <ul>
        <li> Ctrl/⌘ + (B or Enter): Bundle</li>
      </ul>
      Known issues:
      <ul>
        <li>
          Bundle loaders (async import, importing CSS in JS) lock up the
          bundler, caused by Parcel's <code>require.resolve</code> handling
        </li>
        <li>
          Currently patching <code>sass</code> because of{' '}
          <a href="https://github.com/mbullington/node_preamble.dart/issues/14">
            this issue
          </a>
        </li>
        <li>
          Currently patching <code>htmlnano</code> because its{' '}
          <code>requires</code> aren't statically analyzeable
        </li>
      </ul>
    </div>
  );
}
