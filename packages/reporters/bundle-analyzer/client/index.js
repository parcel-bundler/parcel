/* eslint-env browser */
/* global CarrotSearchFoamTree */

let bundleData = JSON.parse(document.getElementById('bundle-data').innerText);

let visualization = document.createElement('div');
visualization.style.height = '100vh';
visualization.style.width = '100vw';
document.body.appendChild(visualization);

let tooltip = document.createElement('div');
tooltip.classList.add('tooltip');
document.body.appendChild(tooltip);

// Foam Tree docs:
// https://get.carrotsearch.com/foamtree/demo/api/index.html
// Some options from Parcel 1 Visualizer:
// https://github.com/gregtillbrook/parcel-plugin-bundle-visualiser/blob/ca5440fc61c85e40e7abc220ad99e274c7c104c6/src/buildReportAssets/init.js#L4
// and Webpack Bundle Analyzer:
// https://github.com/webpack-contrib/webpack-bundle-analyzer/blob/4a232f0cf7bbfed907a5c554879edd5d6f4b48ce/client/components/Treemap.jsx
let foamtree = new CarrotSearchFoamTree({
  element: visualization,
  dataObject: bundleData,
  layout: 'squarified',
  stacking: 'flattened',
  pixelRatio: window.devicePixelRatio || 1,
  maxGroups: Infinity,
  maxGroupLevelsDrawn: Infinity,
  maxGroupLabelLevelsDrawn: Infinity,
  maxGroupLevelsAttached: Infinity,
  rolloutDuration: 0,
  pullbackDuration: 0,
  maxLabelSizeForTitleBar: 0, // disable the title bar
  onGroupHover(e) {
    if (e.group.label == null) {
      tooltip.innerHTML = '';
      return;
    }

    tooltip.innerHTML = `
      <div class="tooltip-content">
        <div>
          <span class="tooltip-title">${e.group.label}</span>
        </div>
        <dl>
          <div>
            <dt>Size</dt>
            <dd>${e.group.weight} bytes</dd>
          </div>
        </dl>
      </div>
    `;
  },
  onGroupClick(e) {
    this.zoom(e.group);
  }
});

visualization.addEventListener('mousemove', e => {
  tooltip.style.transform = `translateX(${visualization.clientLeft +
    e.clientX +
    5}px) translateY(${visualization.clientTop + e.clientY + 5}px)`;
});

window.addEventListener(
  'resize',
  debounce(() => {
    foamtree.resize();
  }, 100)
);

function debounce(fn, delay) {
  let timeout;

  return function(...args) {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}
