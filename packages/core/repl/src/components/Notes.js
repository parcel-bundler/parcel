// eslint-disable-next-line no-unused-vars
import {h} from 'preact';

export default function Notes() {
  return (
    <div class="file notes">
      Yes, this is Parcel as a (nearly) self-hosting bundler (self-
      <i>hoisting</i> doesn't work ...)
      <br />
      The Parcel portion of this page, including all compilers, is a 2.2MB
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
          Minifying CSS doesn't work (runtime <code>require</code> calls by
          cssnano, even for the config to disable the corresponding plugin...)
        </li>
        <li>
          Node builtin modules can't be polyfilled for the browser (looks up the
          bundler, caused by Parcel's <code>require.resolve</code> handling)
        </li>
        <li>
          Babel would need to <code>require</code> plugins at runtime (at least
          without workarounds)
        </li>
        <li>
          Currently patching SASS because of{' '}
          <a href="https://github.com/dart-lang/sdk/issues/36225">this issue</a>
        </li>
      </ul>
    </div>
  );
}
