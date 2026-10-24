'use strict';
(() => {
  const data = JSON.parse(document.getElementById('data').textContent);
  const $ = id => document.getElementById(id);
  const canvas = $('treemap');
  const ctx = canvas.getContext('2d');
  const tooltip = $('tooltip');
  const search = $('search');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const darkScheme = matchMedia('(prefers-color-scheme: dark)');

  const HEADER = 18;
  const PAD = 2;
  const FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
  const UNKNOWN = 'Runtime and unmapped code';

  let mode = 'raw';
  let query = '';

  // --- Tree ----------------------------------------------------------------

  // kind: root | dist | bundle | dir | package | file | unknown
  function node(name, kind, parent) {
    return {
      name,
      kind,
      parent,
      children: null,
      raw: 0,
      gzip: 0,
      path: '',
      colorKey: '',
      match: true,
    };
  }

  function child(parent, name, kind) {
    parent.childMap ??= new Map();
    let key = kind + '\0' + name;
    let existing = parent.childMap.get(key);
    if (!existing) {
      existing = node(name, kind, parent);
      parent.childMap.set(key, existing);
    }
    return existing;
  }

  // Splits a module path into tree segments. Everything under a node_modules package is grouped in
  // one package node, named after the package (or chain of nested packages).
  function segments(path) {
    let parts = path.split('/');
    let first = parts.indexOf('node_modules');
    if (first < 0) {
      return {
        colorKey: colorKeyOf(parts),
        segments: parts.map((name, i) => [
          name,
          i === parts.length - 1 ? 'file' : 'dir',
        ]),
      };
    }
    let names = [];
    let i = first;
    while (parts[i] === 'node_modules' && i + 1 < parts.length - 1) {
      let name = parts[i + 1];
      i += 2;
      if (name.startsWith('@') && i < parts.length - 1) {
        name += '/' + parts[i++];
      }
      names.push(name);
    }
    let pkg = names.join(' › ');
    let rest = parts.slice(i);
    return {
      colorKey: pkg,
      segments: [
        ['node_modules', 'dir'],
        [pkg, 'package'],
        ...rest.map((name, j) => [
          name,
          j === rest.length - 1 ? 'file' : 'dir',
        ]),
      ],
    };
  }

  // Groups source files by package in monorepos (e.g. packages/@scope/name), and by top-level
  // directory otherwise.
  function colorKeyOf(parts) {
    parts = parts.filter(part => part !== '..' && part !== '.');
    let n =
      parts.length > 2 && /^(packages|apps|libs|modules)$/.test(parts[0])
        ? 2
        : 1;
    if (parts[n - 1]?.startsWith('@') && parts.length > n + 1) {
      n++;
    }
    return parts.slice(0, Math.min(n, parts.length - 1)).join('/') || parts[0];
  }

  function dirname(path) {
    let i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
  }

  function basename(path) {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  const root = node(data.title, 'root', null);
  const distDirs = new Set(data.bundles.map(b => dirname(b.name)));
  const bundles = [];
  for (let [bundleIndex, b] of data.bundles.entries()) {
    let parent =
      distDirs.size > 1 ? child(root, dirname(b.name) || '.', 'dist') : root;
    let bundle = child(parent, basename(b.name), 'bundle');
    bundle.path = b.name;
    bundle.raw = b.size;
    bundle.gzip = b.gzip;
    bundle.colorKey = bundle.path;
    bundle.index = bundleIndex;
    bundles.push(bundle);
    // Modules' compressed sizes are estimated from the bundle's compression ratio.
    let ratio = b.size ? b.gzip / b.size : 1;
    let mapped = 0;
    for (let [index, size] of b.assets) {
      mapped += size;
      let leaf;
      if (index == null) {
        leaf = child(bundle, UNKNOWN, 'unknown');
        leaf.colorKey = '';
      } else {
        let path = data.paths[index];
        let {colorKey, segments: segs} = segments(path);
        leaf = bundle;
        for (let [name, kind] of segs) {
          leaf = child(leaf, name, kind);
        }
        leaf.path = path;
        leaf.pathIndex = index;
        leaf.colorKey = colorKey;
      }
      leaf.raw += size;
      leaf.gzip += size * ratio;
    }
    // Asset sizes from transformed assets (bundles without source maps) needn't add up.
    if (b.assets.length && mapped < b.size) {
      let rest = child(bundle, UNKNOWN, 'unknown');
      rest.raw += b.size - mapped;
      rest.gzip += (b.size - mapped) * ratio;
    } else if (mapped > b.size) {
      let scale = b.size / mapped;
      for (let c of bundle.childMap?.values() ?? []) {
        scaleSizes(c, scale);
      }
    }
  }

  function scaleSizes(n, scale) {
    n.raw *= scale;
    n.gzip *= scale;
    for (let c of n.childMap?.values() ?? []) {
      scaleSizes(c, scale);
    }
  }

  // Converts child maps to arrays, sums sizes, and merges chains of single directories.
  function finalize(n) {
    if (n.childMap) {
      n.children = [...n.childMap.values()];
      delete n.childMap;
      for (let c of n.children) {
        finalize(c);
      }
      if (n.kind !== 'bundle') {
        n.raw = n.gzip = 0;
        for (let c of n.children) {
          n.raw += c.raw;
          n.gzip += c.gzip;
        }
      }
      // A directory with a single file becomes the file, and a package keeps its name.
      while (
        (n.kind === 'dir' || n.kind === 'package') &&
        n.children.length === 1
      ) {
        let only = n.children[0];
        if (
          only.kind !== 'dir' &&
          !(n.kind === 'dir' && only.kind === 'file')
        ) {
          break;
        }
        n.name += '/' + only.name;
        if (only.kind === 'file') {
          n.kind = 'file';
          n.path = only.path;
          n.pathIndex = only.pathIndex;
          n.colorKey = only.colorKey;
          n.children = null;
          return n;
        }
        n.children = only.children;
        for (let c of n.children) {
          c.parent = n;
        }
      }
      n.children.sort((a, b) => b.raw - a.raw);
      if (!n.colorKey) {
        n.colorKey = n.children.find(c => c.kind !== 'unknown')?.colorKey ?? '';
      }
    }
    return n;
  }
  finalize(root);

  const size = n => (mode === 'gzip' ? n.gzip : n.raw);

  function bundleOf(n) {
    while (n && n.kind !== 'bundle') {
      n = n.parent;
    }
    return n;
  }

  function ancestors(n) {
    let list = [];
    for (; n; n = n.parent) {
      list.unshift(n);
    }
    return list;
  }

  // --- Formatting ------------------------------------------------------------

  function formatSize(bytes) {
    const units = ['B', 'kB', 'MB', 'GB', 'TB'];
    let e =
      bytes > 0
        ? Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1)
        : 0;
    let value = bytes / 1000 ** e;
    if (Math.round(value * 100) / 100 >= 1000 && e < units.length - 1) {
      value /= 1000;
      e++;
    }
    return `${e === 0 ? Math.round(value) : +value.toFixed(2)} ${units[e]}`;
  }

  function percent(part, whole) {
    if (!whole) {
      return '–';
    }
    let p = (part / whole) * 100;
    return p >= 10 || p === 0 ? p.toFixed(0) + '%' : p.toFixed(1) + '%';
  }

  function escape(text) {
    return String(text).replace(
      /[&<>"]/g,
      c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]),
    );
  }

  // --- Colors ----------------------------------------------------------------

  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    }
    return h >>> 0;
  }

  let theme;
  function readTheme() {
    let style = getComputedStyle(document.documentElement);
    let dark = darkScheme.matches;
    theme = {
      dark,
      fg: style.getPropertyValue('--fg').trim(),
      muted: style.getPropertyValue('--muted').trim(),
      bundle: style.getPropertyValue('--bundle').trim(),
      line: style.getPropertyValue('--frame-line').trim(),
      accent: style.getPropertyValue('--accent').trim(),
      bg: style.getPropertyValue('--bg').trim(),
      unknown: makeHatch(dark),
    };
  }

  function makeHatch(dark) {
    let tile = document.createElement('canvas');
    tile.width = tile.height = 8;
    let t = tile.getContext('2d');
    t.fillStyle = dark ? '#2e2e33' : '#e4e4e8';
    t.fillRect(0, 0, 8, 8);
    t.strokeStyle = dark ? '#3c3c42' : '#d0d0d6';
    t.lineWidth = 2;
    t.beginPath();
    t.moveTo(-2, 10);
    t.lineTo(10, -2);
    t.moveTo(6, 10);
    t.lineTo(10, 6);
    t.moveTo(-2, 2);
    t.lineTo(2, -2);
    t.stroke();
    return ctx.createPattern(tile, 'repeat');
  }

  function fillFor(n) {
    if (n.kind === 'unknown') {
      return theme.unknown;
    }
    if (n.kind === 'bundle' || n.kind === 'dist') {
      return theme.bundle;
    }
    let hue = hash(n.colorKey) % 360;
    let leaf = !n.children;
    if (theme.dark) {
      return leaf ? `hsl(${hue} 32% 36%)` : `hsl(${hue} 18% 21%)`;
    }
    return leaf ? `hsl(${hue} 55% 76%)` : `hsl(${hue} 40% 91%)`;
  }

  // --- Layout ----------------------------------------------------------------

  function worst(max, min, sum, side) {
    let s2 = side * side;
    let sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  }

  // Squarified treemap layout (Bruls, Huizing, van Wijk) of `items`, which are sorted by area,
  // largest first, and whose areas add up to w × h.
  function squarify(items, x, y, w, h, out) {
    let i = 0;
    while (i < items.length) {
      let side = Math.min(w, h);
      if (side <= 0) {
        return;
      }
      let sum = items[i].area;
      let ratio = worst(sum, sum, sum, side);
      let j = i + 1;
      for (; j < items.length; j++) {
        let next = sum + items[j].area;
        let r = worst(items[i].area, items[j].area, next, side);
        if (r > ratio) {
          break;
        }
        sum = next;
        ratio = r;
      }
      let thickness = sum / side;
      let offset = 0;
      for (let k = i; k < j; k++) {
        let length = items[k].area / thickness;
        if (w >= h) {
          out.push({
            node: items[k].node,
            x,
            y: y + offset,
            w: thickness,
            h: length,
          });
        } else {
          out.push({
            node: items[k].node,
            x: x + offset,
            y,
            w: length,
            h: thickness,
          });
        }
        offset += length;
      }
      if (w >= h) {
        x += thickness;
        w -= thickness;
      } else {
        y += thickness;
        h -= thickness;
      }
      i = j;
    }
  }

  // Lays out `n` and its descendants in a rectangle, appending one entry per drawn node to `out`.
  // Containers get a header with their name when there's room, and are drawn as a block otherwise.
  function layout(n, x, y, w, h, depth, out) {
    let rect = {node: n, x, y, w, h, depth, header: false};
    out.push(rect);
    if (!n.children || !size(n)) {
      return;
    }
    let cx = x + PAD;
    let cy = y + PAD;
    let cw = w - 2 * PAD;
    let ch = h - 2 * PAD;
    if (depth > 0) {
      if (h < HEADER + 12 || w < 30) {
        return;
      }
      rect.header = true;
      cy = y + HEADER;
      ch = h - HEADER - PAD;
    }
    if (cw < 2 || ch < 2) {
      return;
    }
    let total = 0;
    let items = [];
    for (let c of n.children) {
      let v = size(c);
      if (v > 0) {
        items.push({node: c, area: v});
        total += v;
      }
    }
    items.sort((a, b) => b.area - a.area);
    let scale = (cw * ch) / total;
    for (let item of items) {
      item.area *= scale;
    }
    let rects = [];
    squarify(items, cx, cy, cw, ch, rects);
    for (let r of rects) {
      if (r.w >= 1 && r.h >= 1) {
        layout(r.node, r.x, r.y, r.w, r.h, depth + 1, out);
      }
    }
  }

  // --- Rendering -------------------------------------------------------------

  let zoomRoot = root;
  let rects = [];
  let hovered = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  const base = document.createElement('canvas');
  const baseCtx = base.getContext('2d');

  function fitText(c, text, max) {
    if (max <= 0) {
      return '';
    }
    let w = c.measureText(text).width;
    if (w <= max) {
      return text;
    }
    let len = Math.floor(text.length * (max / w));
    while (len > 0) {
      let t = text.slice(0, len) + '…';
      if (c.measureText(t).width <= max) {
        return t;
      }
      len--;
    }
    return '';
  }

  function render() {
    rects = [];
    if (width && height) {
      layout(zoomRoot, 0, 0, width, height, 0, rects);
    }
    base.width = Math.round(width * dpr);
    base.height = Math.round(height * dpr);
    let c = baseCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);
    c.font = FONT;
    c.textBaseline = 'alphabetic';
    for (let r of rects) {
      if (r.depth === 0) {
        continue;
      }
      let n = r.node;
      c.globalAlpha = query && !n.match ? 0.22 : 1;
      c.fillStyle = fillFor(n);
      c.fillRect(r.x, r.y, r.w, r.h);
      c.strokeStyle = theme.line;
      c.lineWidth = 1;
      c.strokeRect(
        r.x + 0.5,
        r.y + 0.5,
        Math.max(r.w - 1, 0),
        Math.max(r.h - 1, 0),
      );
      let label = n.kind === 'unknown' ? UNKNOWN : n.name;
      if (r.header) {
        drawLabel(
          c,
          label,
          size(n),
          r.x + 4,
          r.y + 13,
          r.w - 8,
          n.kind === 'bundle' || n.kind === 'dist',
        );
      } else if (r.w > 34 && r.h > 16) {
        c.fillStyle = theme.fg;
        c.font = FONT;
        c.fillText(fitText(c, label, r.w - 8), r.x + 4, r.y + 14);
        if (r.h > 30) {
          c.fillStyle = theme.muted;
          c.fillText(
            fitText(c, formatSize(size(n)), r.w - 8),
            r.x + 4,
            r.y + 28,
          );
        }
      }
    }
    c.globalAlpha = 1;
    present();
  }

  function drawLabel(c, label, bytes, x, y, max, bold) {
    let sizeText = formatSize(bytes);
    c.font = bold ? '600 ' + FONT : FONT;
    let sizeWidth = c.measureText(sizeText).width;
    let name = fitText(c, label, max - sizeWidth - 8);
    c.fillStyle = theme.fg;
    c.fillText(name || fitText(c, label, max), x, y);
    if (name) {
      c.font = FONT;
      c.fillStyle = theme.muted;
      c.fillText(sizeText, x + max - sizeWidth, y);
    }
    c.font = FONT;
  }

  // Draws the rendered treemap with the hovered node highlighted.
  function present() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!base.width || !base.height) {
      return;
    }
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let selectedRect = selected && drawnRect(selected);
    if (selectedRect) {
      // The selected node, or its closest ancestor when it's too small to draw.
      let r = selectedRect;
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = theme.accent;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.setLineDash(r.node === selected ? [] : [4, 3]);
      ctx.strokeRect(
        r.x + 1,
        r.y + 1,
        Math.max(r.w - 2, 0),
        Math.max(r.h - 2, 0),
      );
      ctx.setLineDash([]);
    }
    if (hovered) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        hovered.x + 1,
        hovered.y + 1,
        Math.max(hovered.w - 2, 0),
        Math.max(hovered.h - 2, 0),
      );
    }
  }

  function resize() {
    let box = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    width = box.width;
    height = box.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    hovered = null;
    render();
  }

  // --- Zooming ---------------------------------------------------------------

  function animate(draw, done) {
    if (reducedMotion.matches) {
      done();
      return;
    }
    let start = performance.now();
    let frame = now => {
      let t = Math.min((now - start) / 220, 1);
      draw(1 - (1 - t) ** 3);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        done();
      }
    };
    requestAnimationFrame(frame);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function snapshot() {
    let copy = document.createElement('canvas');
    copy.width = base.width;
    copy.height = base.height;
    copy.getContext('2d').drawImage(base, 0, 0);
    return copy;
  }

  function zoomTo(target) {
    if (target === zoomRoot || !target.children || !width || !height) {
      return;
    }
    hideTooltip();
    hovered = null;
    let from = zoomRoot;
    let old = snapshot();
    let zoomingIn = ancestors(target).includes(from);
    let rect = zoomingIn ? rects.find(r => r.node === target) : null;
    zoomRoot = target;
    updateBreadcrumbs();
    render();
    if (zoomingIn && rect) {
      // Grow the target's old rectangle to fill the view.
      let next = snapshot();
      animate(t => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1 - t;
        ctx.drawImage(old, 0, 0);
        ctx.globalAlpha = t;
        ctx.drawImage(
          next,
          lerp(rect.x, 0, t) * dpr,
          lerp(rect.y, 0, t) * dpr,
          lerp(rect.w, width, t) * dpr,
          lerp(rect.h, height, t) * dpr,
        );
        ctx.globalAlpha = 1;
      }, present);
    } else {
      // Shrink the previous view into its rectangle in the new one.
      let into =
        rects.find(r => r.node === from) ??
        ancestors(from)
          .map(a => rects.find(r => r.node === a))
          .filter(Boolean)
          .pop();
      if (!into) {
        return;
      }
      let next = snapshot();
      animate(t => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(next, 0, 0);
        ctx.globalAlpha = 1 - t;
        ctx.drawImage(
          old,
          lerp(0, into.x, t) * dpr,
          lerp(0, into.y, t) * dpr,
          lerp(width, into.w, t) * dpr,
          lerp(height, into.h, t) * dpr,
        );
        ctx.globalAlpha = 1;
      }, present);
    }
  }

  function updateBreadcrumbs() {
    let nav = $('breadcrumbs');
    nav.textContent = '';
    let path = ancestors(zoomRoot);
    path.forEach((n, i) => {
      if (i > 0) {
        nav.append(document.createTextNode('›'));
      }
      let label = n.kind === 'root' ? 'All bundles' : n.name;
      if (i === path.length - 1) {
        let current = document.createElement('span');
        current.textContent = label;
        current.setAttribute('aria-current', 'location');
        nav.append(current);
      } else {
        let button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => {
          select(n);
          zoomTo(n);
        });
        nav.append(button);
      }
    });
    let stat = document.createElement('span');
    stat.className = 'stat';
    stat.textContent = statText();
    nav.append(stat);
  }

  function statText() {
    let text = formatSize(size(zoomRoot)) + (mode === 'gzip' ? ' gzipped' : '');
    if (query) {
      let matched = 0;
      let count = 0;
      let visit = n => {
        if (!n.match) {
          return;
        }
        if (n.children) {
          n.children.forEach(visit);
        } else {
          matched += size(n);
          count++;
        }
      };
      visit(zoomRoot);
      text = `${count} matching ${
        count === 1 ? 'module' : 'modules'
      } · ${formatSize(matched)} of ${text}`;
    }
    return text;
  }

  // --- Interaction -----------------------------------------------------------

  function hitTest(x, y) {
    for (let i = rects.length - 1; i > 0; i--) {
      let r = rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        return r;
      }
    }
    return null;
  }

  function showTooltip(r, clientX, clientY) {
    let n = r.node;
    let bundle = bundleOf(n);
    let approx =
      mode === 'gzip' &&
      n.kind !== 'bundle' &&
      n.kind !== 'dist' &&
      n.kind !== 'root'
        ? '≈ '
        : '';
    let rows = [
      ['Size', formatSize(n.raw)],
      ['Gzip', (n.kind === 'bundle' ? '' : '≈ ') + formatSize(n.gzip)],
    ];
    if (bundle && bundle !== n) {
      rows.push(['Of bundle', percent(size(n), size(bundle))]);
    }
    rows.push(['Of total', approx + percent(size(n), size(root))]);
    let kind = {
      bundle: 'Bundle',
      package: 'Package',
      dist: 'Directory',
      dir: 'Directory',
      file: '',
      unknown: '',
    }[n.kind];
    let name = n.kind === 'unknown' ? UNKNOWN : n.name;
    let detail =
      n.kind === 'unknown'
        ? 'Code without a source in the source map, such as the Parcel runtime and module wrappers'
        : n.kind === 'dir' || n.kind === 'package'
        ? ancestors(n)
            .slice(ancestors(bundle).length)
            .map(a => a.name)
            .join('/')
        : n.path;
    if (bundle && bundle !== n) {
      detail = (detail ? detail + '\n' : '') + 'in ' + bundle.path;
    }
    tooltip.innerHTML =
      `<div class="name">${
        kind
          ? `<span style="font-weight:400;color:var(--muted)">${kind}</span> `
          : ''
      }${escape(name)}</div>` +
      (detail
        ? `<div class="path">${escape(detail).replace('\n', '<br>')}</div>`
        : '') +
      `<dl>${rows
        .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
        .join('')}</dl>` +
      `<div class="hint">Click for details</div>`;
    tooltip.hidden = false;
    let tw = tooltip.offsetWidth;
    let th = tooltip.offsetHeight;
    let left = clientX + 14;
    let top = clientY + 14;
    if (left + tw > innerWidth - 8) {
      left = Math.max(8, clientX - tw - 14);
    }
    if (top + th > innerHeight - 8) {
      top = Math.max(8, clientY - th - 14);
    }
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  canvas.addEventListener('mousemove', e => {
    let box = canvas.getBoundingClientRect();
    let r = hitTest(e.clientX - box.left, e.clientY - box.top);
    if (r !== hovered) {
      hovered = r;
      present();
    }
    if (r) {
      showTooltip(r, e.clientX, e.clientY);
    } else {
      hideTooltip();
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hovered = null;
    hideTooltip();
    present();
  });

  canvas.addEventListener('click', e => {
    let box = canvas.getBoundingClientRect();
    let r = hitTest(e.clientX - box.left, e.clientY - box.top);
    // Select the highlighted node, and zoom into it if it's a bundle or directory.
    if (r) {
      select(r.node);
      if (r.node.children) {
        zoomTo(r.node);
      } else {
        reveal(r.node);
      }
    }
  });

  canvas.addEventListener('contextmenu', e => {
    if (zoomRoot.parent) {
      e.preventDefault();
      zoomTo(zoomRoot.parent);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.target === search) {
      if (e.key === 'Escape') {
        search.value = '';
        setQuery('');
        search.blur();
      }
      return;
    }
    if (e.target.closest?.('input, button, a')) {
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      search.focus();
    } else if (e.key === 'Escape' && selection) {
      closePanel();
    } else if (
      (e.key === 'Escape' || e.key === 'Backspace') &&
      zoomRoot.parent &&
      view === 'treemap'
    ) {
      e.preventDefault();
      zoomTo(zoomRoot.parent);
    }
  });

  // --- Search ----------------------------------------------------------------

  function markMatches(n, q) {
    if (n.children) {
      let any = false;
      for (let c of n.children) {
        any = markMatches(c, q) || any;
      }
      n.match = any;
    } else {
      n.match =
        !q ||
        (n.kind === 'unknown'
          ? UNKNOWN.toLowerCase().includes(q)
          : n.path.toLowerCase().includes(q));
    }
    return n.match;
  }

  let pending = 0;
  function setQuery(value) {
    query = value.trim().toLowerCase();
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      markMatches(root, query);
      if (query && !zoomRoot.match) {
        zoomRoot = root;
      }
      render();
      updateBreadcrumbs();
      if (view === 'duplicates') {
        renderDuplicates();
      }
    });
  }

  search.addEventListener('input', () => setQuery(search.value));

  // --- Assets ----------------------------------------------------------------

  // Bundle contents are measured per source file, through source maps, while assets are what's
  // bundled. A file's bytes in a bundle belong to the assets built from it that the bundle includes.
  const key = (bundle, path) => bundle + ':' + path;

  // The bytes of each file in each bundle.
  const fileSizes = new Map();
  data.bundles.forEach((b, bundle) => {
    let ratio = b.size ? b.gzip / b.size : 1;
    for (let [path, bytes] of b.assets) {
      if (path != null) {
        fileSizes.set(key(bundle, path), {raw: bytes, gzip: bytes * ratio});
      }
    }
  });

  // The assets built from each file, and those included in each bundle by file.
  const fileAssets = new Map();
  const bundleAssets = new Map();
  data.assets.forEach((a, index) => {
    let list = fileAssets.get(a.path);
    if (!list) {
      fileAssets.set(a.path, (list = []));
    }
    list.push(index);
    for (let bundle of a.bundles) {
      let k = key(bundle, a.path);
      let inBundle = bundleAssets.get(k);
      if (!inBundle) {
        bundleAssets.set(k, (inBundle = []));
      }
      inBundle.push(index);
    }
  });

  // The size of an asset in a bundle: its file's bytes there, which other assets built from the
  // same file in that bundle share.
  function assetSize(asset, bundle) {
    return (
      fileSizes.get(key(bundle, data.assets[asset].path)) ?? {raw: 0, gzip: 0}
    );
  }

  // Distinguishes assets built from the same file.
  function assetLabel(a) {
    let parts = [a.pipeline ? `${a.pipeline}: → ${a.type}` : a.type];
    if (a.env) {
      parts.push(a.env);
    }
    if (a.generated) {
      parts.push('generated');
    }
    return parts.join(' · ');
  }

  // --- Duplicates ------------------------------------------------------------

  // Assets included in more than one bundle, by the bytes the extra copies take up.
  const duplicates = data.assets.flatMap((a, asset) => {
    if (a.bundles.length < 2) {
      return [];
    }
    let copies = a.bundles
      .map(bundle => ({bundle, ...assetSize(asset, bundle)}))
      .filter(c => c.raw > 0);
    return copies.length > 1 ? [{asset, path: data.paths[a.path], copies}] : [];
  });

  function wasted(d) {
    let sizes = d.copies.map(c => (mode === 'gzip' ? c.gzip : c.raw));
    return sizes.reduce((a, b) => a + b, 0) - Math.max(...sizes);
  }

  const MAX_ROWS = 1000;
  function renderDuplicates() {
    let view = $('duplicates-view');
    let list = duplicates
      .filter(d => !query || d.path.toLowerCase().includes(query))
      .map(d => ({...d, wasted: wasted(d)}));
    list.sort((a, b) => b.wasted - a.wasted);
    let total = list.reduce((sum, d) => sum + d.wasted, 0);
    let approx = mode === 'gzip' ? '≈ ' : '';
    if (!duplicates.length) {
      view.innerHTML =
        '<p>No modules are included in more than one bundle.</p>';
      return;
    }
    let rows = list
      .slice(0, MAX_ROWS)
      .map(d => {
        let names = d.copies.map(c => data.bundles[c.bundle].name);
        let shown =
          names.slice(0, 4).join(', ') +
          (names.length > 4 ? `, and ${names.length - 4} more` : '');
        let max = Math.max(
          ...d.copies.map(c => (mode === 'gzip' ? c.gzip : c.raw)),
        );
        let a = data.assets[d.asset];
        let label =
          (fileAssets.get(a.path)?.length ?? 0) > 1
            ? ` <span class="badge">${escape(assetLabel(a))}</span>`
            : '';
        return (
          `<tr><td><a href="#" data-asset="${d.asset}">${escape(
            d.path,
          )}</a>${label}` +
          `<div class="bundles">${escape(shown)}</div></td>` +
          `<td class="num">${
            d.copies.length
          }</td><td class="num">${approx}${formatSize(
            max,
          )}</td><td class="num">${approx}${formatSize(d.wasted)}</td></tr>`
        );
      })
      .join('');
    view.innerHTML =
      `<p>${list.length} ${
        list.length === 1 ? 'module is' : 'modules are'
      } included in more than one bundle, adding ${approx}${formatSize(total)}${
        mode === 'gzip' ? ' gzipped' : ''
      }.${
        list.length > MAX_ROWS ? ` Showing the largest ${MAX_ROWS}.` : ''
      } Select a module to find it in the treemap.</p>` +
      `<table><thead><tr><th>Module</th><th class="num">Copies</th><th class="num">Largest copy</th><th class="num">Duplicated</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  $('duplicates-view').addEventListener('click', e => {
    let link = e.target.closest('a[data-asset]');
    if (link) {
      e.preventDefault();
      let asset = Number(link.dataset.asset);
      let path = data.paths[data.assets[asset].path];
      search.value = path;
      zoomRoot = root;
      setView('treemap');
      setQuery(path);
      showAsset(asset, null, false);
    }
  });

  // --- Details panel ---------------------------------------------------------

  const panel = $('panel');
  // The selected tree node, and what the panel describes: a bundle, an asset (in a bundle, if
  // known), a file without an asset, or another tree node.
  let selected = null;
  let selection = null;

  function collectLeaves(n, map) {
    if (!n.children) {
      if (n.pathIndex != null) {
        map.set(n.pathIndex, n);
      }
      return map;
    }
    for (let c of n.children) {
      collectLeaves(c, map);
    }
    return map;
  }
  const bundleLeaves = bundles.map(b => collectLeaves(b, new Map()));

  // The bundles each bundle loads, the reverse of `loaded_by`.
  const loads = data.bundles.map(() => []);
  data.bundles.forEach((b, i) => {
    for (let [from, kind] of b.loaded_by ?? []) {
      loads[from].push([i, kind]);
    }
  });

  const LOAD_KINDS = {
    lazy: 'Lazy import',
    parallel: 'Parallel',
    url: 'URL',
    sync: 'Reference',
    with: 'Loaded alongside',
  };

  function drawnRect(n) {
    for (; n; n = n.parent) {
      let r = rects.find(r => r.node === n && r.depth > 0);
      if (r) {
        return r;
      }
    }
    return null;
  }

  // The selection for a file in a bundle: its first asset there, or the file itself.
  function fileSelection(path, bundle) {
    let assets = bundle != null ? bundleAssets.get(key(bundle, path)) : null;
    return assets?.length ? {asset: assets[0], bundle} : {file: path, bundle};
  }

  function select(n) {
    selected = n;
    if (n.kind === 'bundle') {
      selection = {bundle: n.index};
    } else if (n.kind === 'file' && n.pathIndex != null) {
      selection = fileSelection(n.pathIndex, bundleOf(n)?.index ?? null);
    } else {
      selection = {node: n};
    }
    renderPanel();
  }

  // Zooms to a module's bundle, unless the view is already within it.
  function reveal(leaf) {
    let bundle = bundleOf(leaf);
    let inBundle =
      bundleOf(zoomRoot) === bundle && ancestors(leaf).includes(zoomRoot);
    if (bundle && !inBundle) {
      zoomTo(bundle);
    }
  }

  function closePanel() {
    selected = null;
    selection = null;
    renderPanel();
  }

  function showBundle(index) {
    if (view !== 'treemap') {
      setView('treemap');
    }
    select(bundles[index]);
    zoomTo(bundles[index]);
    present();
  }

  // Selects a file in `bundle` in the treemap, and shows `nextSelection` in the panel.
  function showInBundle(path, bundle, nextSelection, zoom) {
    let leaf = bundle != null ? bundleLeaves[bundle].get(path) ?? null : null;
    if (view !== 'treemap') {
      setView('treemap');
    }
    selected = leaf;
    selection = nextSelection;
    renderPanel();
    if (leaf && zoom) {
      reveal(leaf);
    }
    present();
  }

  // Shows an asset's details, and selects it in `bundle` (or the first bundle including it) in the
  // treemap, zooming to the bundle unless `zoom` is false.
  function showAsset(asset, bundle, zoom = true) {
    let a = data.assets[asset];
    if (bundle == null || !a.bundles.includes(bundle)) {
      bundle = a.bundles[0] ?? null;
    }
    showInBundle(a.path, bundle, {asset, bundle}, zoom);
  }

  function showFile(path, bundle) {
    showInBundle(path, bundle, fileSelection(path, bundle), true);
  }

  function assetLink(asset, bundle, label) {
    let path = data.paths[data.assets[asset].path];
    return `<button type="button" class="link" data-asset="${asset}"${
      bundle != null ? ` data-bundle="${bundle}"` : ''
    } title="${escape(path)}">${escape(label ?? basename(path))}</button>`;
  }

  function fileLink(path, bundle, label) {
    let name = data.paths[path];
    return `<button type="button" class="link" data-path="${path}" data-bundle="${bundle}" title="${escape(
      name,
    )}">${escape(label ?? basename(name))}</button>`;
  }

  function bundleLink(index) {
    let name = data.bundles[index].name;
    return `<button type="button" class="link" data-bundle="${index}" title="${escape(
      name,
    )}">${escape(basename(name))}</button>`;
  }

  function sizeText(raw, gzip) {
    return mode === 'gzip' ? '≈ ' + formatSize(gzip) : formatSize(raw);
  }

  // A list of items, showing the first `limit` and a button for the rest.
  function list(items, limit = 10) {
    if (!items.length) {
      return '<p class="muted">None</p>';
    }
    let shown = items
      .slice(0, limit)
      .map(item => `<li>${item}</li>`)
      .join('');
    let hidden = items
      .slice(limit)
      .map(item => `<li hidden>${item}</li>`)
      .join('');
    return (
      `<ul>${shown}${hidden}</ul>` +
      (items.length > limit
        ? `<button type="button" class="link more" data-more>Show ${
            items.length - limit
          } more</button>`
        : '')
    );
  }

  function head(eyebrow, title, path) {
    return (
      `<div class="eyebrow">${eyebrow}<button type="button" class="close" data-close aria-label="Close details">×</button></div>` +
      `<h2>${escape(title)}</h2>` +
      (path ? `<div class="path">${escape(path)}</div>` : '')
    );
  }

  function stats(rows) {
    return `<dl class="stats">${rows
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join('')}</dl>`;
  }

  function renderPanel() {
    if (!selection) {
      panel.hidden = true;
      panel.textContent = '';
      present();
      return;
    }
    panel.innerHTML =
      selection.asset != null
        ? assetPanel(selection.asset, selection.bundle)
        : selection.file != null
        ? filePanel(selection.file, selection.bundle)
        : selection.bundle != null
        ? bundlePanel(selection.bundle)
        : nodePanel(selection.node);
    if (panel.hidden) {
      panel.hidden = false;
      // Lay out the treemap in the space left before zooming.
      resize();
    }
    panel.scrollTop = 0;
  }

  function bundlePanel(index) {
    let b = data.bundles[index];
    let n = bundles[index];
    let kinds = new Set((b.loaded_by ?? []).map(([, kind]) => kind));
    let badges = [
      ...(b.entry ? ['<span class="badge">Entry</span>'] : []),
      ...[...kinds].map(
        kind => `<span class="badge ${kind}">${LOAD_KINDS[kind]}</span>`,
      ),
    ].join('');
    let files = b.assets.filter(([path]) => path != null);
    let ratio = b.size ? b.gzip / b.size : 1;
    // Files whose assets here are also included in other bundles, with the most copies of any.
    let duplicated = files.flatMap(([path, bytes]) => {
      let copies = Math.max(
        0,
        ...(bundleAssets.get(key(index, path)) ?? []).map(
          a => data.assets[a].bundles.length,
        ),
      );
      return copies > 1 ? [{path, bytes, copies}] : [];
    });
    let duplicatedBytes = duplicated.reduce((sum, d) => sum + d.bytes, 0);
    let html =
      head(`Bundle ${badges}`, basename(b.name), b.name) +
      stats([
        ['Size', formatSize(b.size)],
        ['Gzip', formatSize(b.gzip)],
        ['Of total', percent(size(n), size(root))],
        ['Modules', files.length],
      ]);
    if (b.entries?.length) {
      html +=
        `<h3>Runs on load</h3>` +
        list(
          b.entries.map(a => assetLink(a, index)),
          5,
        );
    }
    html +=
      `<h3>Loaded by</h3>` +
      (b.entry && !b.loaded_by?.length
        ? '<p class="muted">Entry bundle</p>'
        : list(
            (b.loaded_by ?? []).map(
              ([from, kind]) =>
                `${bundleLink(from)}<span class="size">${
                  LOAD_KINDS[kind]
                }</span>`,
            ),
          ));
    html +=
      `<h3>Loads</h3>` +
      list(
        loads[index].map(
          ([to, kind]) =>
            `${bundleLink(to)}<span class="size">${LOAD_KINDS[kind]}</span>`,
        ),
      );
    html +=
      `<h3>Largest modules</h3>` +
      list(
        files.map(
          ([path, bytes]) =>
            `${fileLink(path, index)}<span class="size">${sizeText(
              bytes,
              bytes * ratio,
            )}</span>`,
        ),
      );
    html +=
      `<h3>Also in other bundles</h3>` +
      (duplicated.length
        ? `<p class="muted">${duplicated.length} ${
            duplicated.length === 1 ? 'module' : 'modules'
          } (${sizeText(
            duplicatedBytes,
            duplicatedBytes * ratio,
          )}) of this bundle ${
            duplicated.length === 1 ? 'is' : 'are'
          } also included in other bundles.</p>` +
          list(
            duplicated.map(
              d =>
                `${fileLink(d.path, index)}<span class="size">${
                  d.copies
                } copies · ${sizeText(d.bytes, d.bytes * ratio)}</span>`,
            ),
            5,
          )
        : '<p class="muted">None</p>');
    return html;
  }

  function assetPanel(asset, bundle) {
    let a = data.assets[asset];
    let path = data.paths[a.path];
    let siblings = fileAssets.get(a.path) ?? [];
    let here = a.bundles.includes(bundle) ? assetSize(asset, bundle) : null;
    let sharing = here
      ? (bundleAssets.get(key(bundle, a.path))?.length ?? 1) - 1
      : 0;
    let copies = a.bundles.map(b => ({bundle: b, ...assetSize(asset, b)}));
    let rows = [];
    if (here) {
      rows.push(['In this bundle', sizeText(here.raw, here.gzip)]);
    }
    if (copies.length > 1 || !here) {
      let raw = copies.reduce((sum, c) => sum + c.raw, 0);
      let gzip = copies.reduce((sum, c) => sum + c.gzip, 0);
      rows.push([
        `In ${copies.length} ${copies.length === 1 ? 'bundle' : 'bundles'}`,
        sizeText(raw, gzip),
      ]);
    }
    let html =
      head(
        `Module${a.entry ? ' <span class="badge">Entry</span>' : ''}${
          siblings.length > 1 || a.env || a.generated
            ? ` <span class="badge">${escape(assetLabel(a))}</span>`
            : ''
        }`,
        basename(path),
        path,
      ) + stats(rows);
    if (sharing) {
      html += `<p class="muted">Its size here includes ${sharing} other ${
        sharing === 1 ? 'asset' : 'assets'
      } built from this file.</p>`;
    }

    // Why it's included: the import chain from an entry.
    let chain = [];
    let seen = new Set();
    for (let i = asset; i != null && !seen.has(i); ) {
      seen.add(i);
      let via = data.assets[i].via;
      chain.unshift({asset: i, via});
      i = via?.[0];
    }
    html += `<h3>Why is this included?</h3>`;
    if (chain.length === 1 && !a.entry) {
      html += '<p class="muted">Not imported from an entry.</p>';
    } else {
      html +=
        '<ol class="chain">' +
        chain
          .map(({asset: i, via}, n) => {
            let edge = '';
            if (n > 0) {
              let [, specifier, kind] = via;
              let how =
                kind === 'lazy'
                  ? 'import()'
                  : kind === 'url'
                  ? 'URL'
                  : kind === 'parallel'
                  ? 'parallel'
                  : 'imports';
              edge = `<div class="edge ${kind}">${how} <code>${escape(
                specifier,
              )}</code></div>`;
            }
            let label =
              n === chain.length - 1
                ? `<strong>${escape(
                    basename(data.paths[data.assets[i].path]),
                  )}</strong>`
                : assetLink(i, null);
            let entry =
              n === 0 && data.assets[i].entry
                ? ' <span class="badge">Entry</span>'
                : '';
            return `<li>${edge}<span>${label}${entry}</span></li>`;
          })
          .join('') +
        '</ol>';
    }

    html +=
      `<h3>Included in ${copies.length} ${
        copies.length === 1 ? 'bundle' : 'bundles'
      }</h3>` +
      list(
        copies.map(
          c =>
            `${
              c.bundle === bundle
                ? `<strong>${escape(
                    basename(data.bundles[c.bundle].name),
                  )}</strong>`
                : assetLink(
                    asset,
                    c.bundle,
                    basename(data.bundles[c.bundle].name),
                  )
            }<span class="size">${sizeText(c.raw, c.gzip)}</span>`,
        ),
      );

    if (siblings.length > 1) {
      html +=
        `<h3>Other assets from this file</h3>` +
        list(
          // Assets with the same label (e.g. CSS extracted from several macros) are grouped.
          [
            ...Map.groupBy(
              siblings.filter(i => i !== asset),
              i => assetLabel(data.assets[i]),
            ),
          ].map(([label, group]) => {
            let bundles = new Set(group.flatMap(i => data.assets[i].bundles));
            let count = `${bundles.size} ${
              bundles.size === 1 ? 'bundle' : 'bundles'
            }`;
            return `${assetLink(group[0], null, label)}${
              group.length > 1
                ? ` <span class="muted">×${group.length}</span>`
                : ''
            }<span class="size">${count}</span>`;
          }),
        );
    }

    let importers = a.importers ?? [];
    html +=
      `<h3>Imported by${importers.length ? ` ${importers.length}` : ''}</h3>` +
      list(
        importers.map(i => assetLink(i, null, data.paths[data.assets[i].path])),
      );

    html += `<h3>Exports</h3>`;
    if (!a.exports) {
      html +=
        '<p class="muted">Which exports are used isn\'t known statically, e.g. because this is a CommonJS module or not JavaScript.</p>';
    } else {
      let all = [...a.exports, ...(a.reexports ?? [])];
      if (!all.length) {
        html += '<p class="muted">No exports</p>';
      } else {
        let used = a.namespace ? all.length : all.filter(([, u]) => u).length;
        html += `<p>${
          a.namespace
            ? `All ${all.length} used through a namespace import`
            : `${used} of ${all.length} used`
        }${
          used < all.length
            ? '. Unused exports are tree-shaken in optimized builds'
            : ''
        }.</p>`;
        let chips = (items, reexport) =>
          items
            .slice(0, 300)
            .map(
              ([name, u]) =>
                `<span class="chip${
                  u || a.namespace ? '' : ' unused'
                }" title="${u || a.namespace ? 'Used' : 'Unused'}${
                  reexport ? ', re-exported' : ''
                }">${escape(name)}</span>`,
            )
            .join('');
        html += `<div class="chips">${chips(a.exports, false)}</div>`;
        if (a.reexports?.length) {
          html +=
            `<p class="muted" style="margin-top:8px">Re-exports</p>` +
            `<div class="chips">${chips(a.reexports, true)}</div>`;
        }
        if (all.length > 300) {
          html += '<p class="muted">Showing the first 300.</p>';
        }
      }
    }
    return html;
  }

  // A file whose code is in a bundle without an asset built from it there, e.g. a dependency's
  // original source, which its source map refers to.
  function filePanel(path, bundle) {
    let here = bundle != null ? fileSizes.get(key(bundle, path)) : null;
    let assets = fileAssets.get(path) ?? [];
    return (
      head('Source file', basename(data.paths[path]), data.paths[path]) +
      (here ? stats([['In this bundle', sizeText(here.raw, here.gzip)]]) : '') +
      '<p class="muted" style="margin-top:12px">No asset in this bundle was built from this file. Its code is attributed to it by the source map of another module, such as a dependency published with source maps.</p>' +
      (assets.length
        ? `<h3>Assets built from this file</h3>` +
          list(assets.map(i => assetLink(i, null, assetLabel(data.assets[i]))))
        : '')
    );
  }

  // The build, directories, packages and unmapped code.
  function nodePanel(n) {
    if (n.kind === 'root' || n.kind === 'dist') {
      let contained = data.bundles
        .map((b, index) => ({b, index}))
        .filter(({index}) => ancestors(bundles[index]).includes(n));
      let raw = contained.reduce((sum, {b}) => sum + b.size, 0);
      let gzip = contained.reduce((sum, {b}) => sum + b.gzip, 0);
      return (
        head(
          n.kind === 'root' ? 'Build' : 'Directory',
          n.kind === 'root' ? data.title : n.name,
        ) +
        stats([
          ['Size', formatSize(raw)],
          ['Gzip', formatSize(gzip)],
          ['Bundles', contained.length],
          ['Entry bundles', contained.filter(({b}) => b.entry).length],
        ]) +
        `<h3>Largest bundles</h3>` +
        list(
          contained
            .sort((a, b) =>
              mode === 'gzip' ? b.b.gzip - a.b.gzip : b.b.size - a.b.size,
            )
            .map(
              ({b, index}) =>
                `${bundleLink(index)}<span class="size">${
                  mode === 'gzip' ? formatSize(b.gzip) : formatSize(b.size)
                }</span>`,
            ),
        )
      );
    }
    if (n.kind === 'unknown') {
      return (
        head('Code', UNKNOWN, bundleOf(n)?.path) +
        stats([['Size', sizeText(n.raw, n.gzip)]]) +
        '<p class="muted" style="margin-top:12px">Code in the bundle that its source map doesn\'t attribute to a source file, such as the Parcel runtime, module wrappers, and code generated by plugins.</p>'
      );
    }
    let leaves = [...collectLeaves(n, new Map()).values()].sort(
      (a, b) => size(b) - size(a),
    );
    let bundle = bundleOf(n);
    let kind =
      {package: 'Package', dist: 'Directory', root: 'Build'}[n.kind] ??
      'Directory';
    let path =
      n.kind === 'dir' || n.kind === 'package'
        ? ancestors(n)
            .slice(ancestors(bundle).length)
            .map(a => a.name)
            .join('/')
        : '';
    return (
      head(kind, n.name, path + (bundle ? ` in ${bundle.path}` : '')) +
      stats([
        ['Size', sizeText(n.raw, n.gzip)],
        ['Modules', leaves.length],
        ...(bundle ? [['Of bundle', percent(size(n), size(bundle))]] : []),
      ]) +
      `<h3>Largest modules</h3>` +
      list(
        leaves.map(
          leaf =>
            `${fileLink(
              leaf.pathIndex,
              bundle?.index,
              leaf.name,
            )}<span class="size">${sizeText(leaf.raw, leaf.gzip)}</span>`,
        ),
      )
    );
  }

  panel.addEventListener('click', e => {
    let target = e.target.closest('button');
    if (!target) {
      return;
    }
    if (target.hasAttribute('data-close')) {
      closePanel();
    } else if (target.hasAttribute('data-more')) {
      for (let item of target.previousElementSibling.querySelectorAll(
        'li[hidden]',
      )) {
        item.hidden = false;
      }
      target.remove();
    } else if (target.dataset.asset != null) {
      showAsset(
        Number(target.dataset.asset),
        target.dataset.bundle != null ? Number(target.dataset.bundle) : null,
      );
    } else if (target.dataset.path != null) {
      showFile(Number(target.dataset.path), Number(target.dataset.bundle));
    } else if (target.dataset.bundle != null) {
      showBundle(Number(target.dataset.bundle));
    }
  });

  // --- Controls --------------------------------------------------------------

  let view = 'treemap';
  function setView(next) {
    view = next;
    $('view-treemap').setAttribute('aria-pressed', String(view === 'treemap'));
    $('view-duplicates').setAttribute(
      'aria-pressed',
      String(view === 'duplicates'),
    );
    $('treemap-view').hidden = view !== 'treemap';
    $('duplicates-view').hidden = view !== 'duplicates';
    $('breadcrumbs').hidden = view !== 'treemap';
    hideTooltip();
    if (view === 'treemap') {
      updateBreadcrumbs();
      resize();
    } else {
      renderDuplicates();
    }
  }

  function setMode(next) {
    mode = next;
    $('mode-raw').setAttribute('aria-pressed', String(mode === 'raw'));
    $('mode-gzip').setAttribute('aria-pressed', String(mode === 'gzip'));
    updateSummary();
    updateBreadcrumbs();
    if (selection) {
      let scroll = panel.scrollTop;
      renderPanel();
      panel.scrollTop = scroll;
    }
    if (view === 'treemap') {
      render();
    } else {
      renderDuplicates();
    }
  }

  function updateSummary() {
    let count = data.bundles.length;
    $('summary').textContent = `${data.title} · ${count} ${
      count === 1 ? 'bundle' : 'bundles'
    } · ${formatSize(root.raw)} · ${formatSize(root.gzip)} gzipped`;
    $('view-duplicates').textContent = duplicates.length
      ? `Duplicates (${duplicates.length})`
      : 'Duplicates';
  }

  $('view-treemap').addEventListener('click', () => setView('treemap'));
  $('view-duplicates').addEventListener('click', () => setView('duplicates'));
  $('mode-raw').addEventListener('click', () => setMode('raw'));
  $('mode-gzip').addEventListener('click', () => setMode('gzip'));
  darkScheme.addEventListener('change', () => {
    readTheme();
    render();
  });
  new ResizeObserver(resize).observe(canvas);

  readTheme();
  updateSummary();
  updateBreadcrumbs();
})();
