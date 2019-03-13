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
        Experimental Scope Hoisting
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
      <label title="Not an actual CLI option, put this into a .browserslistrc 😁">
        Browserslist
        <input
          type="text"
          value={enableBrowserslist ? values.browserslist : undefined}
          disabled={!enableBrowserslist}
          placeholder={
            enableBrowserslist ? '> 0.25%' : "You've already specified a config"
          }
          onChange={e => onChange('browserslist', e.target.value)}
        />
      </label>
      <label title="Gets set as `--public-url <value>`">
        Public URL
        <input
          type="text"
          value={values.publicUrl}
          placeholder="/"
          onChange={e => onChange('publicUrl', e.target.value)}
        />
      </label>
    </div>
  );
}
