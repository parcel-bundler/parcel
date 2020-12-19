// @flow
// @jsx h
/* eslint-disable react/jsx-no-bind */
import type {REPLOptions} from '../utils';

// eslint-disable-next-line no-unused-vars
import {h} from 'preact';
import {getDefaultTargetEnv} from '../utils';

export const DEFAULT_OPTIONS: REPLOptions = {
  minify: false,
  scopeHoist: true,
  sourceMaps: false,
  publicUrl: '',
  targetType: 'browsers',
  targetEnv: null,
  outputFormat: null,
  renderGraphs: false,
  viewSourcemaps: false,
  dependencies: [],
};

export default function Options({
  values,
  onChange,
  disabled = false,
}: {|
  values: REPLOptions,
  onChange: ($Keys<REPLOptions>, mixed) => void,
  disabled: ?boolean,
|}): any {
  return (
    <div class="options file">
      <label title="Sets `--no-minify`">
        <span>Minify</span>
        <input
          type="checkbox"
          checked={values.minify}
          onChange={e => onChange('minify', e.target.checked)}
          disabled={disabled}
        />
      </label>
      <label title="Corresponds to `--no-scope-hoist`">
        <span>Enable Scope Hoisting</span>
        <input
          type="checkbox"
          checked={values.scopeHoist}
          onChange={e => onChange('scopeHoist', e.target.checked)}
          disabled={disabled}
        />
      </label>
      <label title="Corresponds to `--no-source-maps`">
        <span>Source Maps</span>
        <input
          type="checkbox"
          checked={values.sourceMaps}
          disabled={values.viewSourcemaps || disabled}
          onChange={e => onChange('sourceMaps', e.target.checked)}
        />
      </label>
      <label title="Sets `--public-url <value>`">
        <span>Public URL</span>
        <input
          type="text"
          value={values.publicUrl}
          placeholder="/"
          onInput={e => onChange('publicUrl', e.target.value)}
          disabled={disabled}
        />
      </label>
      <label>
        <span>Output Format</span>
        <select
          onChange={e => onChange('outputFormat', e.target.value || null)}
          value={values.outputFormat}
          disabled={disabled}
        >
          <option value="" />
          <option value="esmodule">esmodule</option>
          <option value="commonjs">commonjs</option>
          <option value="global">global</option>
        </select>
      </label>
      <label>
        <span>Target</span>
        <div>
          <select
            onChange={e => {
              onChange('targetType', e.target.value);
              onChange('targetEnv', null);
            }}
            value={values.targetType}
            style={{marginRight: '0.5rem'}}
            disabled={disabled}
          >
            <option value="browsers">Browsers</option>
            <option value="node">Node</option>
          </select>
          <input
            type="text"
            value={values.targetEnv}
            onInput={e => onChange('targetEnv', e.target.value)}
            placeholder={getDefaultTargetEnv(values.targetType)}
            disabled={disabled}
          />
        </div>
      </label>
      <hr />
      <label title="env variable PARCEL_DUMP_GRAPHVIZ">
        <span>Render Graphs</span>
        <select
          onChange={e => onChange('renderGraphs', e.target.value || null)}
          value={values.renderGraphs}
          disabled={disabled}
        >
          <option value="">disabled</option>
          <option value="true">enabled</option>
          <option value="symbols">enabled with symbols</option>
        </select>
      </label>
      <label>
        <span>View sourcemaps</span>
        <input
          type="checkbox"
          checked={values.viewSourcemaps}
          onChange={e => {
            onChange('viewSourcemaps', e.target.checked);
            if (e.target.checked) {
              onChange('sourceMaps', true);
            }
          }}
          disabled={disabled}
        />
      </label>
      <hr />
      <div class="dependencies">
        Dependencies
        <ul>
          {values.dependencies?.map(([name, version], i) => (
            <li key={i}>
              <input
                type="text"
                value={name}
                placeholder="pkg-name"
                onInput={e =>
                  onChange(
                    'dependencies',
                    values.dependencies.map((v, j) =>
                      j === i ? [e.target.value, v[1]] : v,
                    ),
                  )
                }
                disabled={disabled}
              />
              @
              <input
                value={version}
                placeholder="range"
                onInput={e =>
                  onChange(
                    'dependencies',
                    values.dependencies.map((v, j) =>
                      j === i ? [v[0], e.target.value] : v,
                    ),
                  )
                }
              />
              <button
                class="remove"
                onClick={() =>
                  onChange(
                    'dependencies',
                    values.dependencies.filter((_, j) => j !== i),
                  )
                }
              >
                ✕
              </button>
            </li>
          ))}
          <li>
            <button
              class="add"
              onClick={() =>
                onChange('dependencies', [...values.dependencies, ['', '']])
              }
            >
              Add
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
