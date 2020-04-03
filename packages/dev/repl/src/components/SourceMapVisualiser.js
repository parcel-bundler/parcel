import Visualiser from 'sourcemap-visualiser';
import 'sourcemap-visualiser/lib/index.css';

// eslint-disable-next-line no-unused-vars
import {h, Fragment} from 'preact';
import {useState, useCallback} from 'preact/hooks';
import {useBodyClass} from './helper';

export default function SourceMapVisualiser({maps}) {
  let [open, setOpen] = useState(false);
  let onClickOpen = useCallback(() => setOpen(true), []);
  let onClickClose = useCallback(() => setOpen(false), []);
  let onClickNoop = useCallback(e => e.stopPropagation(), []);

  useBodyClass(open && 'no-scroll');

  return (
    <>
      <button onClick={onClickOpen}>Open Sourcemap Visualizer</button>
      {open && (
        <div class="overlay-backdrop" onClick={onClickClose}>
          <div class="overlay" onClick={onClickNoop}>
            <Visualiser sourcemapContent={maps} />
          </div>
        </div>
      )}
    </>
  );
}
