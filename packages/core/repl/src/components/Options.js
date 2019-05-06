// eslint-disable-next-line no-unused-vars
import {h} from 'preact';

export default function Options({values, onChange, enableBrowserslist}) {
  return (
    <div class="options file">
      <label title="Sets `--no-minify`">
        Minify
        <input
          type="checkbox"
          checked={values.minify}
          onChange={e => onChange('minify', e.target.checked)}
        />
      </label>
      <label title="Sets `--experimental-scope-hoisting`">
        Scope Hoisting (Experimental)
        <input
          type="checkbox"
          checked={values.scopeHoist}
          onChange={e => onChange('scopeHoist', e.target.checked)}
        />
      </label>
      <label
        title={
          values.scopeHoist
            ? 'Not supported with Scope Hoisting'
            : 'Corresponds to `--no-source-maps`'
        }
      >
        Source Maps (not supported with Scope Hoisting)
        <input
          type="checkbox"
          checked={values.sourceMaps}
          disabled={values.scopeHoist}
          onChange={e => onChange('sourceMaps', e.target.checked)}
        />
      </label>
      <label title="Sets `--no-content-hash`">
        Content hashing (as opposed to path-based)
        <input
          type="checkbox"
          checked={values.contentHash}
          onChange={e => onChange('contentHash', e.target.checked)}
        />
      </label>
      <label title="Not an actual CLI option, put this into .browserslistrc 😁">
        Browserslist target, i.e.: <code>Chrome 70</code>
        <input
          type="text"
          value={enableBrowserslist ? values.browserslist : undefined}
          disabled={!enableBrowserslist}
          placeholder={
            enableBrowserslist ? '> 0.25%' : "You've already specified a config"
          }
          onInput={e => onChange('browserslist', e.target.value)}
        />
      </label>
      <label title="Sets `--global <value>`">
        Global (expose module as UMD)
        <input
          type="text"
          placeholder="[disabled]"
          onInput={e => onChange('global', e.target.value)}
        />
      </label>
      <label title="Gets set as `--public-url <value>`">
        Public URL
        <input
          type="text"
          value={values.publicUrl}
          placeholder="/"
          onInput={e => onChange('publicUrl', e.target.value)}
        />
      </label>
      <label title="Gets set as `--target <value>`">
        Target
        <select
          onChange={e => onChange('target', e.target.value)}
          value={values.target}
        >
          <option value="browser">Browser</option>
          <option value="node">Node</option>
          <option value="electron">Electron</option>
        </select>
      </label>
    </div>
  );
}
