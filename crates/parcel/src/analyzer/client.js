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
  for (let b of data.bundles) {
    let parent =
      distDirs.size > 1 ? child(root, dirname(b.name) || '.', 'dist') : root;
    let bundle = child(parent, basename(b.name), 'bundle');
    bundle.path = b.name;
    bundle.raw = b.size;
    bundle.gzip = b.gzip;
    bundle.colorKey = bundle.path;
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
        button.addEventListener('click', () => zoomTo(n));
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
      `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
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
    // Zoom into the highlighted node, or the directory containing it if it's a module.
    if (r) {
      zoomTo(r.node.children ? r.node : r.node.parent);
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
    if (e.key === '/') {
      e.preventDefault();
      search.focus();
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

  // --- Duplicates ------------------------------------------------------------

  // Modules included in more than one bundle, by the bytes the extra copies take up.
  const duplicates = (() => {
    let byPath = new Map();
    data.bundles.forEach((b, i) => {
      let ratio = b.size ? b.gzip / b.size : 1;
      for (let [index, bytes] of b.assets) {
        if (index == null) {
          continue;
        }
        let copies = byPath.get(index);
        if (!copies) {
          byPath.set(index, (copies = []));
        }
        copies.push({bundle: b.name, raw: bytes, gzip: bytes * ratio});
      }
    });
    let list = [];
    for (let [index, copies] of byPath) {
      if (copies.length > 1) {
        list.push({path: data.paths[index], copies});
      }
    }
    return list;
  })();

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
        let names = d.copies.map(c => c.bundle);
        let shown =
          names.slice(0, 4).join(', ') +
          (names.length > 4 ? `, and ${names.length - 4} more` : '');
        let max = Math.max(
          ...d.copies.map(c => (mode === 'gzip' ? c.gzip : c.raw)),
        );
        return (
          `<tr><td><a href="#" data-path="${escape(d.path)}">${escape(
            d.path,
          )}</a><div class="bundles">${escape(shown)}</div></td>` +
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
    let link = e.target.closest('a[data-path]');
    if (link) {
      e.preventDefault();
      search.value = link.dataset.path;
      zoomRoot = root;
      setView('treemap');
      setQuery(link.dataset.path);
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
