import {h} from 'preact';

export default function Options({values, onChange}) {
  return (
    <div class="options file">
      <label>
        Minify
        <input
          type="checkbox"
          checked={values.minify}
          onChange={e => onChange('minify', e.target.checked)}
        />
      </label>
      <label>
        Experimental Scope Hoisting
        <input
          type="checkbox"
          checked={values.scopeHoist}
          onChange={e => onChange('scopeHoist', e.target.checked)}
        />
      </label>
      <label
        title={
          values.scopeHoist ? 'Not supported with Scope Hoisting' : undefined
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
    </div>
  );
}
