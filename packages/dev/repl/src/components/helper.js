// @flow
import type {BundleOutputError} from '../parcel/ParcelWorker';
import {useCallback, useState, useEffect, useRef, memo} from 'react';
import {ctrlKey} from '../utils';
import renderGraph from '../graphs/index.js';
import {ASSET_PRESETS} from '../utils';
import {type FSMap} from '../utils/assets';
/* eslint-disable react/jsx-no-bind */

export function ParcelError({
  output: {error},
}: {|
  output: BundleOutputError,
|}): any {
  return (
    <div className="build-error">
      <span>A build error occured:</span>
      <div className="content" dangerouslySetInnerHTML={{__html: error}} />
    </div>
  );
}

export function Notes(): any {
  return (
    <div className="help">
      <div>
        <p>{ctrlKey} + B to bundle</p>
        <p>{ctrlKey} + S to save</p>
        <p>Ctrl + W to close a tab</p>
        {/* Note:
        <ul>
          <li>
            PostHTML&apos;s <code>removeUnusedCss</code> is disabled for a
            smaller bundle size
          </li>
        </ul>
        <br />
        Based on commit:{' '}
        <a href={`https://github.com/parcel-bundler/parcel/tree/${commit}`}>
          {commit}
        </a> */}
      </div>
    </div>
  );
}

// function toDataURI(mime, data) {
//   return `data:${mime};charset=utf-8;base64,${btoa(data)}`;
// }

export const Graphs: any = memo(function Graphs({graphs}) {
  let [rendered, setRendered] = useState();

  useEffect(() => {
    renderGraph().then(async render => {
      setRendered(
        await Promise.all(
          graphs.map(async ({name, content}) => ({
            name,
            content: /*toDataURI*/ ('image/svg+xml', await render(content)),
          })),
        ),
      );
    });
  }, [graphs]);

  return (
    <div className="graphs">
      Graphs (will open in a new tab)
      {rendered && (
        <div>
          {rendered.map(({name, content}, i) => (
            <button
              key={i}
              onClick={() => {
                var win = window.open();
                win.document.write(content);
                // win.document.write(
                //   '<iframe src="' +
                //     content +
                //     '" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>',
                // );
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export function Tabs({
  names,
  children,
  selected,
  setSelected,
  mode = 'remove',
  className,
  fallback,
  ...props
}: any): any {
  let [_selected, _setSelected] = useState(0);

  selected = selected ?? _selected;
  setSelected = setSelected ?? _setSelected;

  useEffect(() => {
    if (children.length > 0 && children.length <= selected) {
      setSelected(selected - 1);
    }
  }, [children, selected, setSelected]);

  return (
    <div {...props} className={'tabs ' + (className || '')}>
      <div className="switcher">
        {names.map((n, i) => (
          <div
            onClick={() => setSelected(i)}
            key={i}
            className={i === selected ? 'selected' : undefined}
            // tabIndex="0"
            // onKeyDown={(e) => e.code === "Enter" && setSelected(i)}
          >
            {n}
          </div>
        ))}
      </div>
      {mode === 'remove'
        ? children.find((_, i) => i === selected)
        : children.map((c, i) => (
            <div
              key={i}
              className="content"
              style={i !== selected ? {display: 'none'} : undefined}
            >
              {c}
            </div>
          ))}
      {children.length === 0 && fallback}
    </div>
  );
}

export function EditableField({value, editing, onChange}: any): any {
  let [v, setV] = useState(value);

  useEffect(() => {
    if (editing) {
      let handler = () => {
        onChange(v);
      };

      window.addEventListener('click', handler);

      return () => {
        window.removeEventListener('click', handler);
      };
    }
  }, [v, editing, onChange]);

  useEffect(() => {
    if (editing) {
      setV(value);
    }
  }, [editing, value]);

  return editing ? (
    <form
      onSubmit={e => {
        e.preventDefault();
        onChange(v);
      }}
      style={{display: 'inline'}}
    >
      <input
        type="text"
        value={v}
        onInput={e => {
          setV(e.target.value);
        }}
        onClick={e => e.stopPropagation()}
      />
    </form>
  ) : (
    <span>{value}</span>
  );
}

export function PresetSelector({dispatch}: any): any {
  let onChange = useCallback(
    async preset => {
      if (preset === 'Three.js Benchmark') {
        try {
          let data = await (
            await fetch(new URL('../assets/three.zip', import.meta.url))
          ).arrayBuffer();
          let files: FSMap = await extractZIP(data);

          let fs = new Map([
            ['copy1', files],
            ['copy2', files],
            ['copy3', files],
            [
              'index.js',
              {
                isEntry: true,
                value: `import * as copy1 from './copy1/Three.js'; export {copy1};
        import * as copy2 from './copy2/Three.js'; export {copy2};
        import * as copy3 from './copy3/Three.js'; export {copy3};`,
              },
            ],
          ]);

          dispatch({type: 'preset.load', name: preset, data: {fs}});
        } catch (e) {
          console.error(e);
        }
      } else {
        dispatch({type: 'preset.load', name: preset});
      }
    },
    [dispatch],
  );

  return (
    <label className="presets">
      <span>Preset:</span>
      <select
        onChange={e => {
          onChange(e.target.value);
        }}
        value={''}
      >
        <option value=""></option>
        {[...ASSET_PRESETS.keys()].map(n => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
// ----------------------------------------------------------------------------------------

export function useDebounce(
  cb: () => mixed,
  delay: number,
  deps: Array<mixed>,
): any {
  useEffect(() => {
    const handler = setTimeout(() => {
      cb();
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [cb, delay, ...deps]);
}

export function useSessionStorage(
  key: string,
  initialValue: mixed,
): [any, () => void] {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.sessionStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.log(error);
      return initialValue;
    }
  });

  const setValue = value => {
    try {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.sessionStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.log(error);
    }
  };

  return [storedValue, setValue];
}

export function usePromise<T>(promise: Promise<T>): [?T, any, boolean] {
  let [state, setState] = useState(null);
  let mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    promise.then(
      v => mountedRef.current && setState({resolved: v}),
      v => mountedRef.current && setState({rejected: v}),
    );
  }, [promise]);

  return [state?.resolved, state?.rejected, state != null];
}

// $FlowFixMe
const addBodyClass = className => document.body.classList.add(className);
// $FlowFixMe
const removeBodyClass = className => document.body.classList.remove(className);
export function useBodyClass(className: string) {
  let classNames = Array.isArray(className) ? className : [className];
  useEffect(() => {
    classNames.forEach(addBodyClass);

    return () => {
      classNames.forEach(removeBodyClass);
    };
  }, [className]);
}

export function useKeyboard(cb: KeyboardEvent => mixed, deps: Array<mixed>) {
  const keydownCb = useCallback((e: KeyboardEvent) => {
    cb(e);
  }, deps);
  useEffect(() => {
    document.addEventListener('keydown', keydownCb);
    return () => {
      document.removeEventListener('keydown', keydownCb);
    };
  }, [keydownCb]);
}
