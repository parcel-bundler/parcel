// @flow
// Based on parse5: https://github.com/inikulin/parse5/blob/252819607421a5741cf745bb60c404f023531b0d/packages/parse5/lib/common/foreign-content.js#L54

export const SVG_TAG_NAMES: {|[string]: string|} = {
  altglyph: 'altGlyph',
  altglyphdef: 'altGlyphDef',
  altglyphitem: 'altGlyphItem',
  animatecolor: 'animateColor',
  animatemotion: 'animateMotion',
  animatetransform: 'animateTransform',
  clippath: 'clipPath',
  feblend: 'feBlend',
  fecolormatrix: 'feColorMatrix',
  fecomponenttransfer: 'feComponentTransfer',
  fecomposite: 'feComposite',
  feconvolvematrix: 'feConvolveMatrix',
  fediffuselighting: 'feDiffuseLighting',
  fedisplacementmap: 'feDisplacementMap',
  fedistantlight: 'feDistantLight',
  feflood: 'feFlood',
  fefunca: 'feFuncA',
  fefuncb: 'feFuncB',
  fefuncg: 'feFuncG',
  fefuncr: 'feFuncR',
  fegaussianblur: 'feGaussianBlur',
  feimage: 'feImage',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
  femorphology: 'feMorphology',
  feoffset: 'feOffset',
  fepointlight: 'fePointLight',
  fespecularlighting: 'feSpecularLighting',
  fespotlight: 'feSpotLight',
  fetile: 'feTile',
  feturbulence: 'feTurbulence',
  foreignobject: 'foreignObject',
  glyphref: 'glyphRef',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  textpath: 'textPath',
};

export const SVG_ATTRS: {|[string]: string|} = {
  attributename: 'attributeName',
  attributetype: 'attributeType',
  basefrequency: 'baseFrequency',
  baseprofile: 'baseProfile',
  calcmode: 'calcMode',
  clippathunits: 'clipPathUnits',
  diffuseconstant: 'diffuseConstant',
  edgemode: 'edgeMode',
  filterunits: 'filterUnits',
  glyphref: 'glyphRef',
  gradienttransform: 'gradientTransform',
  gradientunits: 'gradientUnits',
  kernelmatrix: 'kernelMatrix',
  kernelunitlength: 'kernelUnitLength',
  keypoints: 'keyPoints',
  keysplines: 'keySplines',
  keytimes: 'keyTimes',
  lengthadjust: 'lengthAdjust',
  limitingconeangle: 'limitingConeAngle',
  markerheight: 'markerHeight',
  markerunits: 'markerUnits',
  markerwidth: 'markerWidth',
  maskcontentunits: 'maskContentUnits',
  maskunits: 'maskUnits',
  numoctaves: 'numOctaves',
  pathlength: 'pathLength',
  patterncontentunits: 'patternContentUnits',
  patterntransform: 'patternTransform',
  patternunits: 'patternUnits',
  pointsatx: 'pointsAtX',
  pointsaty: 'pointsAtY',
  pointsatz: 'pointsAtZ',
  preservealpha: 'preserveAlpha',
  preserveaspectratio: 'preserveAspectRatio',
  primitiveunits: 'primitiveUnits',
  refx: 'refX',
  refy: 'refY',
  repeatcount: 'repeatCount',
  repeatdur: 'repeatDur',
  requiredextensions: 'requiredExtensions',
  requiredfeatures: 'requiredFeatures',
  specularconstant: 'specularConstant',
  specularexponent: 'specularExponent',
  spreadmethod: 'spreadMethod',
  startoffset: 'startOffset',
  stddeviation: 'stdDeviation',
  stitchtiles: 'stitchTiles',
  surfacescale: 'surfaceScale',
  systemlanguage: 'systemLanguage',
  tablevalues: 'tableValues',
  targetx: 'targetX',
  targety: 'targetY',
  textlength: 'textLength',
  viewbox: 'viewBox',
  viewtarget: 'viewTarget',
  xchannelselector: 'xChannelSelector',
  ychannelselector: 'yChannelSelector',
  zoomandpan: 'zoomAndPan',
};
