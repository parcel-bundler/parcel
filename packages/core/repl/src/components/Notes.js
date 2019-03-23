// eslint-disable-next-line no-unused-vars
import {h} from 'preact';

export default function Notes() {
  return (
    <div class="file notes">
      Yes, this is Parcel as a (nearly) self-hosting bundler (self-
      <i>hoisting</i> doesn't work ...)
      <br />
      The Parcel portion of this page, including all compilers, is a 4.8MB
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
          Bundle loaders (async import, importing CSS in JS) locks up the
          bundler, caused by Parcel's <code>require.resolve</code> handling
        </li>
        <li>
          Babel would need to <code>require</code> plugins at runtime (at least
          without workarounds)
        </li>
        <li>
          Currently patching SASS because of{' '}
          <a href="https://github.com/mbullington/node_preamble.dart/issues/14">
            this issue
          </a>
        </li>
      </ul>
    </div>
  );
}
