// eslint-disable-next-line no-unused-vars
import {h} from 'preact';
import {useState, useEffect, useRef} from 'preact/hooks';
import {memo} from 'preact/compat';
import {ctrlKey} from '../utils';
import renderGraph from '../graphs/index.js';
// import fs from 'fs';
/* eslint-disable react/jsx-no-bind */

// const commit = fs.readFileSync(__dirname + '../../../commit', 'utf8');

export function ParcelError({error: {error, diagnostics}}) {
  return (
    <Box class="build-error" header={<span>A build error occured:</span>}>
      {error ? error.message + '\n' : false}
      {diagnostics &&
        [...diagnostics]
          .map(([name, diags]) =>
            diags.map(d => `${d.severity}: ${name} - ${d.message}`).join('\n'),
          )
          .join('\n')}
    </Box>
  );
}

export function Box({class: clas, header, children, ...props}) {
  return (
    <div class={`file ${clas || ''}`} {...props}>
      {header && <div class="header">{header}</div>}
      <div class="content">{children}</div>
    </div>
  );
}

export function Notes() {
  return (
    <Box class="notes">
      Hotkeys:
      <ul>
        <li> {ctrlKey} + (B or Enter): Bundle</li>
      </ul>
      {/* Note:
      <ul>
        <li>
          PostHTML&apos;s <code>removeUnusedCss</code> is disabled for a smaller
          bundle size
        </li>
      </ul>
      Known issues:
      <ul>
        <li>
          Bundle loaders (async import, importing CSS in JS) lock up the
          bundler, caused by Parcel&apos;s <code>require.resolve</code> handling
        </li>
        <li>
          Currently patching <code>sass</code> because of{' '}
          <a href="https://github.com/mbullington/node_preamble.dart/issues/14">
            this issue
          </a>
        </li>
        <li>
          Currently patching <code>htmlnano</code> because its{' '}
          <code>require</code> calls aren&apos;t statically analyzeable
        </li>
      </ul> */}
      {/* <br />
      Based on commit:{' '}
      <a href={`https://github.com/parcel-bundler/parcel/tree/${commit}`}>
        {commit}
      </a> */}
    </Box>
  );
}

// function toDataURI(mime, data) {
//   return `data:${mime};charset=utf-8;base64,${btoa(data)}`;
// }

export const Graphs = memo(function Graphs({graphs}) {
  let [rendered, setRendered] = useState();

  useEffect(async () => {
    let render = await renderGraph();
    setRendered(
      await Promise.all(
        graphs.map(async ({name, content}) => ({
          name,
          content: /*toDataURI*/ ('image/svg+xml', await render(content)),
        })),
      ),
    );
  }, [graphs]);

  return (
    <Box header="Graphs (will open in a new tab)">
      <ul>
        {rendered &&
          rendered.map(({name, content}, i) => (
            <li key={i}>
              <button
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
            </li>
          ))}
      </ul>
    </Box>
  );
});

export function Tabs({names, children, selected, setSelected, ...props}) {
  let [_selected, _setSelected] = useState(0);

  selected = selected ?? _selected;
  setSelected = setSelected ?? _setSelected;

  return (
    <div class="tabs" {...props}>
      <div class="switcher">
        {names.map((n, i) => (
          <div
            onClick={() => setSelected(i)}
            key={i}
            class={i === selected ? 'selected' : undefined}
          >
            {n}
          </div>
        ))}
      </div>
      {children.find((_, i) => i === selected)}
    </div>
  );
}

export function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function useSessionStorage(key, initialValue) {
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

export function usePromise(promise) {
  let [state, setState] = useState(null);
  let mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  });

  useEffect(() => {
    promise.then(
      v => mountedRef.current && setState({resolved: v}),
      v => mountedRef.current && setState({rejected: v}),
    );
  }, [promise]);

  return [state?.resolved, state?.rejected, state != null];
}

const addBodyClass = className => document.body.classList.add(className);
const removeBodyClass = className => document.body.classList.remove(className);
export function useBodyClass(className) {
  let classNames = Array.isArray(className) ? className : [className];
  useEffect(() => {
    classNames.forEach(addBodyClass);

    return () => {
      classNames.forEach(removeBodyClass);
    };
  }, [className]);
}
