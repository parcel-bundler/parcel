use crate::{
  arena::{Node, NodeData},
  oxvg::OxvgConfig,
};
use convert_case::{Case, Casing};
use indexmap::IndexMap;
use serde::Deserialize;
use swc_core::{
  atoms::Atom,
  common::{BytePos, DUMMY_SP, FileName, SourceFile, SourceMap, sync::Lrc},
  ecma::{
    ast::*,
    parser::{Parser, StringInput, lexer::Lexer, parse_file_as_module},
    visit::{VisitMut, VisitMutWith},
  },
};
use xml5ever::{ExpandedName, expanded_name, local_name, namespace_url, ns};

fn to_jsx<'arena>(dom: &'arena Node<'arena>) -> JSXElementChild {
  match &dom.data {
    NodeData::Element { name, attrs, .. } => {
      let opening = JSXOpeningElement {
        name: JSXElementName::Ident(Ident::new_no_ctxt(name.local.as_ref().into(), DUMMY_SP)),
        attrs: attrs
          .borrow()
          .iter()
          .map(|attr| {
            JSXAttrOrSpread::JSXAttr(JSXAttr {
              name: JSXAttrName::Ident(IdentName::new(
                jsx_attr_name(&attr.name.expanded()).into(),
                DUMMY_SP,
              )),
              span: DUMMY_SP,
              value: Some(jsx_attr_value(attr.name.expanded(), &attr.value)),
            })
          })
          .collect(),
        self_closing: dom.first_child.get().is_none(),
        span: DUMMY_SP,
        type_args: None,
      };

      let mut children = Vec::new();
      let mut child = dom.first_child.get();
      while let Some(c) = child {
        children.push(to_jsx(c));
        child = c.next_sibling.get();
      }

      JSXElementChild::JSXElement(Box::new(JSXElement {
        opening,
        children,
        closing: dom.first_child.get().map(|_| JSXClosingElement {
          name: JSXElementName::Ident(Ident::new_no_ctxt(name.local.as_ref().into(), DUMMY_SP)),
          span: DUMMY_SP,
        }),
        span: DUMMY_SP,
      }))
    }
    NodeData::Text { contents } => {
      let value: Atom = contents.borrow().as_ref().into();
      JSXElementChild::JSXText(JSXText {
        value: value.clone().into(),
        raw: value,
        span: DUMMY_SP,
      })
    }
    NodeData::Document => {
      let mut children = Vec::new();
      let mut child = dom.first_child.get();
      while let Some(c) = child {
        if matches!(c.data, NodeData::Element { .. } | NodeData::Text { .. }) {
          children.push(to_jsx(c));
        }
        child = c.next_sibling.get();
      }

      if children.len() == 1 {
        children.remove(0)
      } else {
        JSXElementChild::JSXFragment(JSXFragment {
          children,
          span: DUMMY_SP,
          opening: JSXOpeningFragment { span: DUMMY_SP },
          closing: JSXClosingFragment { span: DUMMY_SP },
        })
      }
    }
    _ => JSXElementChild::JSXExprContainer(JSXExprContainer {
      expr: JSXExpr::JSXEmptyExpr(JSXEmptyExpr { span: DUMMY_SP }),
      span: DUMMY_SP,
    }),
  }
}

fn jsx_attr_name<'a>(name: &'a ExpandedName) -> &'a str {
  // https://github.com/facebook/react/blob/7c908bcf4e6b46135164be961972f0d756378517/packages/react-dom-bindings/src/shared/possibleStandardNames.js#L268
  match name {
    // HTML
    expanded_name!("", "accept") => "accept",
    expanded_name!("", "accept-charset") => "acceptCharset",
    expanded_name!("", "accesskey") => "accessKey",
    expanded_name!("", "action") => "action",
    expanded_name!("", "allowfullscreen") => "allowFullScreen",
    expanded_name!("", "alt") => "alt",
    expanded_name!("", "as") => "as",
    expanded_name!("", "async") => "async",
    // expanded_name!("", "autocapitalize") => "autoCapitalize",
    expanded_name!("", "autocomplete") => "autoComplete",
    // expanded_name!("", "autocorrect") => "autoCorrect",
    expanded_name!("", "autofocus") => "autoFocus",
    expanded_name!("", "autoplay") => "autoPlay",
    // expanded_name!("", "autosave") => "autoSave",
    expanded_name!("", "cellpadding") => "cellPadding",
    expanded_name!("", "cellspacing") => "cellSpacing",
    expanded_name!("", "charset") => "charSet",
    expanded_name!("", "checked") => "checked",
    expanded_name!("", "cite") => "cite",
    expanded_name!("", "class") => "className",
    expanded_name!("", "classid") => "classID",
    expanded_name!("", "cols") => "cols",
    expanded_name!("", "colspan") => "colSpan",
    expanded_name!("", "content") => "content",
    expanded_name!("", "contenteditable") => "contentEditable",
    expanded_name!("", "contextmenu") => "contextMenu",
    expanded_name!("", "controls") => "controls",
    // expanded_name!("", "controlslist") => "controlsList",
    expanded_name!("", "coords") => "coords",
    expanded_name!("", "crossorigin") => "crossOrigin",
    expanded_name!("", "data") => "data",
    expanded_name!("", "datetime") => "dateTime",
    expanded_name!("", "default") => "default",
    expanded_name!("", "defer") => "defer",
    expanded_name!("", "dir") => "dir",
    expanded_name!("", "disabled") => "disabled",
    // expanded_name!("", "disablepictureinpicture") => "disablePictureInPicture",
    // expanded_name!("", "disableremoteplayback") => "disableRemotePlayback",
    expanded_name!("", "download") => "download",
    expanded_name!("", "draggable") => "draggable",
    expanded_name!("", "enctype") => "encType",
    // expanded_name!("", "enterkeyhint") => "enterKeyHint",
    expanded_name!("", "fetchpriority") => "fetchPriority",
    expanded_name!("", "for") => "htmlFor",
    expanded_name!("", "form") => "form",
    expanded_name!("", "formmethod") => "formMethod",
    expanded_name!("", "formaction") => "formAction",
    expanded_name!("", "formenctype") => "formEncType",
    expanded_name!("", "formnovalidate") => "formNoValidate",
    expanded_name!("", "formtarget") => "formTarget",
    expanded_name!("", "frameborder") => "frameBorder",
    expanded_name!("", "headers") => "headers",
    expanded_name!("", "height") => "height",
    expanded_name!("", "hidden") => "hidden",
    expanded_name!("", "high") => "high",
    expanded_name!("", "href") => "href",
    expanded_name!("", "hreflang") => "hrefLang",
    // expanded_name!("", "httpequiv") => "httpEquiv",
    expanded_name!("", "http-equiv") => "httpEquiv",
    expanded_name!("", "icon") => "icon",
    expanded_name!("", "id") => "id",
    // expanded_name!("", "imagesizes") => "imageSizes",
    // expanded_name!("", "imagesrcset") => "imageSrcSet",
    // expanded_name!("", "inert") => "inert",
    expanded_name!("", "inputmode") => "inputMode",
    expanded_name!("", "integrity") => "integrity",
    expanded_name!("", "itemid") => "itemID",
    expanded_name!("", "itemprop") => "itemProp",
    expanded_name!("", "itemref") => "itemRef",
    expanded_name!("", "itemscope") => "itemScope",
    expanded_name!("", "itemtype") => "itemType",
    // expanded_name!("", "keyparams") => "keyParams",
    // expanded_name!("", "keytype") => "keyType",
    expanded_name!("", "kind") => "kind",
    expanded_name!("", "label") => "label",
    expanded_name!("", "lang") => "lang",
    expanded_name!("", "list") => "list",
    expanded_name!("", "loop") => "loop",
    expanded_name!("", "low") => "low",
    expanded_name!("", "manifest") => "manifest",
    expanded_name!("", "marginwidth") => "marginWidth",
    expanded_name!("", "marginheight") => "marginHeight",
    expanded_name!("", "max") => "max",
    expanded_name!("", "maxlength") => "maxLength",
    expanded_name!("", "media") => "media",
    // expanded_name!("", "mediagroup") => "mediaGroup",
    expanded_name!("", "method") => "method",
    expanded_name!("", "min") => "min",
    expanded_name!("", "minlength") => "minLength",
    expanded_name!("", "multiple") => "multiple",
    expanded_name!("", "muted") => "muted",
    expanded_name!("", "name") => "name",
    expanded_name!("", "nomodule") => "noModule",
    expanded_name!("", "nonce") => "nonce",
    expanded_name!("", "novalidate") => "noValidate",
    expanded_name!("", "open") => "open",
    expanded_name!("", "optimum") => "optimum",
    expanded_name!("", "pattern") => "pattern",
    expanded_name!("", "placeholder") => "placeholder",
    // expanded_name!("", "playsinline") => "playsInline",
    expanded_name!("", "poster") => "poster",
    expanded_name!("", "preload") => "preload",
    expanded_name!("", "profile") => "profile",
    expanded_name!("", "radiogroup") => "radioGroup",
    expanded_name!("", "readonly") => "readOnly",
    expanded_name!("", "referrerpolicy") => "referrerPolicy",
    expanded_name!("", "rel") => "rel",
    expanded_name!("", "required") => "required",
    expanded_name!("", "reversed") => "reversed",
    expanded_name!("", "role") => "role",
    expanded_name!("", "rows") => "rows",
    expanded_name!("", "rowspan") => "rowSpan",
    expanded_name!("", "sandbox") => "sandbox",
    expanded_name!("", "scope") => "scope",
    expanded_name!("", "scoped") => "scoped",
    expanded_name!("", "scrolling") => "scrolling",
    expanded_name!("", "seamless") => "seamless",
    expanded_name!("", "selected") => "selected",
    expanded_name!("", "shape") => "shape",
    expanded_name!("", "size") => "size",
    expanded_name!("", "sizes") => "sizes",
    expanded_name!("", "span") => "span",
    expanded_name!("", "spellcheck") => "spellCheck",
    expanded_name!("", "src") => "src",
    expanded_name!("", "srcdoc") => "srcDoc",
    expanded_name!("", "srclang") => "srcLang",
    expanded_name!("", "srcset") => "srcSet",
    expanded_name!("", "start") => "start",
    expanded_name!("", "step") => "step",
    expanded_name!("", "style") => "style",
    expanded_name!("", "summary") => "summary",
    expanded_name!("", "tabindex") => "tabIndex",
    expanded_name!("", "target") => "target",
    expanded_name!("", "title") => "title",
    expanded_name!("", "type") => "type",
    expanded_name!("", "usemap") => "useMap",
    expanded_name!("", "value") => "value",
    expanded_name!("", "width") => "width",
    expanded_name!("", "wrap") => "wrap",

    // SVG
    expanded_name!("", "accent-height") => "accentHeight",
    expanded_name!("", "accumulate") => "accumulate",
    expanded_name!("", "additive") => "additive",
    expanded_name!("", "alignment-baseline") => "alignmentBaseline",
    // expanded_name!("", "allowreorder") => "allowReorder",
    expanded_name!("", "alphabetic") => "alphabetic",
    expanded_name!("", "amplitude") => "amplitude",
    // expanded_name!("", "arabicform") => "arabicForm",
    expanded_name!("", "arabic-form") => "arabicForm",
    expanded_name!("", "ascent") => "ascent",
    expanded_name!("", "attributename") => "attributeName",
    expanded_name!("", "attributetype") => "attributeType",
    // expanded_name!("", "autoreverse") => "autoReverse",
    expanded_name!("", "azimuth") => "azimuth",
    expanded_name!("", "basefrequency") => "baseFrequency",
    expanded_name!("", "baseline-shift") => "baselineShift",
    expanded_name!("", "baseprofile") => "baseProfile",
    expanded_name!("", "bbox") => "bbox",
    expanded_name!("", "begin") => "begin",
    expanded_name!("", "bias") => "bias",
    expanded_name!("", "by") => "by",
    expanded_name!("", "calcmode") => "calcMode",
    expanded_name!("", "cap-height") => "capHeight",
    expanded_name!("", "clip") => "clip",
    expanded_name!("", "clippath") => "clipPath",
    expanded_name!("", "clip-path") => "clipPath",
    expanded_name!("", "clippathunits") => "clipPathUnits",
    expanded_name!("", "clip-rule") => "clipRule",
    expanded_name!("", "color") => "color",
    expanded_name!("", "color-interpolation") => "colorInterpolation",
    expanded_name!("", "color-interpolation-filters") => "colorInterpolationFilters",
    expanded_name!("", "color-profile") => "colorProfile",
    expanded_name!("", "color-rendering") => "colorRendering",
    expanded_name!("", "contentscripttype") => "contentScriptType",
    expanded_name!("", "contentstyletype") => "contentStyleType",
    expanded_name!("", "cursor") => "cursor",
    expanded_name!("", "cx") => "cx",
    expanded_name!("", "cy") => "cy",
    expanded_name!("", "d") => "d",
    expanded_name!("", "descent") => "descent",
    expanded_name!("", "diffuseconstant") => "diffuseConstant",
    expanded_name!("", "direction") => "direction",
    expanded_name!("", "display") => "display",
    expanded_name!("", "divisor") => "divisor",
    expanded_name!("", "dominant-baseline") => "dominantBaseline",
    expanded_name!("", "dur") => "dur",
    expanded_name!("", "dx") => "dx",
    expanded_name!("", "dy") => "dy",
    expanded_name!("", "edgemode") => "edgeMode",
    expanded_name!("", "elevation") => "elevation",
    expanded_name!("", "enable-background") => "enableBackground",
    expanded_name!("", "end") => "end",
    expanded_name!("", "exponent") => "exponent",
    expanded_name!("", "externalresourcesrequired") => "externalResourcesRequired",
    expanded_name!("", "fill") => "fill",
    expanded_name!("", "fill-opacity") => "fillOpacity",
    expanded_name!("", "fill-rule") => "fillRule",
    expanded_name!("", "filter") => "filter",
    expanded_name!("", "filterres") => "filterRes",
    expanded_name!("", "filterunits") => "filterUnits",
    expanded_name!("", "flood-opacity") => "floodOpacity",
    expanded_name!("", "flood-color") => "floodColor",
    expanded_name!("", "fontfamily") => "fontFamily",
    expanded_name!("", "font-family") => "fontFamily",
    expanded_name!("", "fontsize") => "fontSize",
    expanded_name!("", "font-size") => "fontSize",
    expanded_name!("", "font-size-adjust") => "fontSizeAdjust",
    expanded_name!("", "font-stretch") => "fontStretch",
    expanded_name!("", "fontstyle") => "fontStyle",
    expanded_name!("", "font-style") => "fontStyle",
    expanded_name!("", "font-variant") => "fontVariant",
    expanded_name!("", "fontweight") => "fontWeight",
    expanded_name!("", "font-weight") => "fontWeight",
    expanded_name!("", "format") => "format",
    expanded_name!("", "from") => "from",
    expanded_name!("", "fx") => "fx",
    expanded_name!("", "fy") => "fy",
    expanded_name!("", "g1") => "g1",
    expanded_name!("", "g2") => "g2",
    expanded_name!("", "glyph-name") => "glyphName",
    expanded_name!("", "glyph-orientation-horizontal") => "glyphOrientationHorizontal",
    expanded_name!("", "glyph-orientation-vertical") => "glyphOrientationVertical",
    expanded_name!("", "glyphref") => "glyphRef",
    expanded_name!("", "gradienttransform") => "gradientTransform",
    expanded_name!("", "gradientunits") => "gradientUnits",
    expanded_name!("", "hanging") => "hanging",
    expanded_name!("", "horiz-adv-x") => "horizAdvX",
    expanded_name!("", "horiz-origin-x") => "horizOriginX",
    expanded_name!("", "ideographic") => "ideographic",
    expanded_name!("", "image-rendering") => "imageRendering",
    expanded_name!("", "in2") => "in2",
    expanded_name!("", "in") => "in",
    expanded_name!("", "intercept") => "intercept",
    expanded_name!("", "k1") => "k1",
    expanded_name!("", "k2") => "k2",
    expanded_name!("", "k3") => "k3",
    expanded_name!("", "k4") => "k4",
    expanded_name!("", "k") => "k",
    expanded_name!("", "kernelmatrix") => "kernelMatrix",
    expanded_name!("", "kernelunitlength") => "kernelUnitLength",
    expanded_name!("", "kerning") => "kerning",
    expanded_name!("", "keypoints") => "keyPoints",
    expanded_name!("", "keysplines") => "keySplines",
    expanded_name!("", "keytimes") => "keyTimes",
    expanded_name!("", "lengthadjust") => "lengthAdjust",
    expanded_name!("", "letter-spacing") => "letterSpacing",
    expanded_name!("", "lighting-color") => "lightingColor",
    expanded_name!("", "limitingconeangle") => "limitingConeAngle",
    expanded_name!("", "local") => "local",
    expanded_name!("", "marker-end") => "markerEnd",
    expanded_name!("", "markerheight") => "markerHeight",
    expanded_name!("", "marker-mid") => "markerMid",
    expanded_name!("", "marker-start") => "markerStart",
    expanded_name!("", "markerunits") => "markerUnits",
    expanded_name!("", "markerwidth") => "markerWidth",
    expanded_name!("", "mask") => "mask",
    expanded_name!("", "maskcontentunits") => "maskContentUnits",
    expanded_name!("", "maskunits") => "maskUnits",
    expanded_name!("", "mathematical") => "mathematical",
    expanded_name!("", "mode") => "mode",
    expanded_name!("", "numoctaves") => "numOctaves",
    expanded_name!("", "offset") => "offset",
    expanded_name!("", "opacity") => "opacity",
    expanded_name!("", "operator") => "operator",
    expanded_name!("", "order") => "order",
    expanded_name!("", "orient") => "orient",
    expanded_name!("", "orientation") => "orientation",
    expanded_name!("", "origin") => "origin",
    expanded_name!("", "overflow") => "overflow",
    expanded_name!("", "overline-position") => "overlinePosition",
    expanded_name!("", "overline-thickness") => "overlineThickness",
    // expanded_name!("", "paint-order") => "paintOrder",
    expanded_name!("", "panose-1") => "panose1",
    expanded_name!("", "pathlength") => "pathLength",
    expanded_name!("", "patterncontentunits") => "patternContentUnits",
    expanded_name!("", "patterntransform") => "patternTransform",
    expanded_name!("", "patternunits") => "patternUnits",
    expanded_name!("", "pointer-events") => "pointerEvents",
    expanded_name!("", "points") => "points",
    expanded_name!("", "pointsatx") => "pointsAtX",
    expanded_name!("", "pointsaty") => "pointsAtY",
    expanded_name!("", "pointsatz") => "pointsAtZ",
    // expanded_name!("", "popover") => "popover",
    // expanded_name!("", "popovertarget") => "popoverTarget",
    // expanded_name!("", "popovertargetaction") => "popoverTargetAction",
    expanded_name!("", "preservealpha") => "preserveAlpha",
    expanded_name!("", "preserveaspectratio") => "preserveAspectRatio",
    expanded_name!("", "primitiveunits") => "primitiveUnits",
    expanded_name!("", "property") => "property",
    expanded_name!("", "r") => "r",
    expanded_name!("", "radius") => "radius",
    expanded_name!("", "refx") => "refX",
    expanded_name!("", "refy") => "refY",
    expanded_name!("", "rendering-intent") => "renderingIntent",
    expanded_name!("", "repeatcount") => "repeatCount",
    expanded_name!("", "repeatdur") => "repeatDur",
    expanded_name!("", "requiredextensions") => "requiredExtensions",
    expanded_name!("", "requiredfeatures") => "requiredFeatures",
    expanded_name!("", "restart") => "restart",
    expanded_name!("", "result") => "result",
    expanded_name!("", "rotate") => "rotate",
    expanded_name!("", "rx") => "rx",
    expanded_name!("", "ry") => "ry",
    expanded_name!("", "scale") => "scale",
    expanded_name!("", "seed") => "seed",
    expanded_name!("", "shape-rendering") => "shapeRendering",
    expanded_name!("", "slope") => "slope",
    expanded_name!("", "spacing") => "spacing",
    expanded_name!("", "specularconstant") => "specularConstant",
    expanded_name!("", "specularexponent") => "specularExponent",
    expanded_name!("", "speed") => "speed",
    expanded_name!("", "spreadmethod") => "spreadMethod",
    expanded_name!("", "startoffset") => "startOffset",
    expanded_name!("", "stddeviation") => "stdDeviation",
    expanded_name!("", "stemh") => "stemh",
    expanded_name!("", "stemv") => "stemv",
    expanded_name!("", "stitchtiles") => "stitchTiles",
    expanded_name!("", "stop-color") => "stopColor",
    expanded_name!("", "stop-opacity") => "stopOpacity",
    expanded_name!("", "strikethrough-position") => "strikethroughPosition",
    expanded_name!("", "strikethrough-thickness") => "strikethroughThickness",
    expanded_name!("", "string") => "string",
    expanded_name!("", "stroke") => "stroke",
    expanded_name!("", "stroke-dasharray") => "strokeDasharray",
    expanded_name!("", "stroke-dashoffset") => "strokeDashoffset",
    expanded_name!("", "stroke-linecap") => "strokeLinecap",
    expanded_name!("", "stroke-linejoin") => "strokeLinejoin",
    expanded_name!("", "stroke-miterlimit") => "strokeMiterlimit",
    expanded_name!("", "stroke-width") => "strokeWidth",
    expanded_name!("", "stroke-opacity") => "strokeOpacity",
    expanded_name!("", "surfacescale") => "surfaceScale",
    expanded_name!("", "systemlanguage") => "systemLanguage",
    expanded_name!("", "tablevalues") => "tableValues",
    expanded_name!("", "targetx") => "targetX",
    expanded_name!("", "targety") => "targetY",
    expanded_name!("", "text-anchor") => "textAnchor",
    expanded_name!("", "text-decoration") => "textDecoration",
    expanded_name!("", "textlength") => "textLength",
    expanded_name!("", "text-rendering") => "textRendering",
    expanded_name!("", "to") => "to",
    expanded_name!("", "transform") => "transform",
    // expanded_name!("", "transform-origin") => "transformOrigin",
    expanded_name!("", "u1") => "u1",
    expanded_name!("", "u2") => "u2",
    expanded_name!("", "underline-position") => "underlinePosition",
    expanded_name!("", "underline-thickness") => "underlineThickness",
    expanded_name!("", "unicode") => "unicode",
    expanded_name!("", "unicode-bidi") => "unicodeBidi",
    expanded_name!("", "unicode-range") => "unicodeRange",
    expanded_name!("", "units-per-em") => "unitsPerEm",
    expanded_name!("", "unselectable") => "unselectable",
    expanded_name!("", "v-alphabetic") => "vAlphabetic",
    expanded_name!("", "values") => "values",
    // expanded_name!("", "vector-effect") => "vectorEffect",
    expanded_name!("", "version") => "version",
    expanded_name!("", "vert-adv-y") => "vertAdvY",
    expanded_name!("", "vert-origin-x") => "vertOriginX",
    expanded_name!("", "vert-origin-y") => "vertOriginY",
    expanded_name!("", "v-hanging") => "vHanging",
    expanded_name!("", "v-ideographic") => "vIdeographic",
    expanded_name!("", "viewbox") => "viewBox",
    expanded_name!("", "viewtarget") => "viewTarget",
    expanded_name!("", "visibility") => "visibility",
    expanded_name!("", "v-mathematical") => "vMathematical",
    expanded_name!("", "widths") => "widths",
    expanded_name!("", "word-spacing") => "wordSpacing",
    expanded_name!("", "writing-mode") => "writingMode",
    expanded_name!("", "x1") => "x1",
    expanded_name!("", "x2") => "x2",
    expanded_name!("", "x") => "x",
    expanded_name!("", "xchannelselector") => "xChannelSelector",
    expanded_name!("", "x-height") => "xHeight",
    expanded_name!(xlink "actuate") => "xlinkActuate",
    expanded_name!(xlink "arcrole") => "xlinkArcrole",
    expanded_name!(xlink "href") => "xlinkHref",
    expanded_name!(xlink "role") => "xlinkRole",
    expanded_name!(xlink "show") => "xlinkShow",
    expanded_name!(xlink "title") => "xlinkTitle",
    expanded_name!(xlink "type") => "xlinkType",
    expanded_name!(xml "base") => "xmlBase",
    expanded_name!(xml "lang") => "xmlLang",
    expanded_name!(xmlns "xmlns") => "xmlns",
    expanded_name!(xml "space") => "xmlSpace",
    expanded_name!(xmlns "xlink") => "xmlnsXlink",
    expanded_name!("", "y1") => "y1",
    expanded_name!("", "y2") => "y2",
    expanded_name!("", "y") => "y",
    expanded_name!("", "ychannelselector") => "yChannelSelector",
    expanded_name!("", "z") => "z",
    expanded_name!("", "zoomandpan") => "zoomAndPan",
    _ => name.local.as_ref(),
  }
}

fn jsx_attr_value(name: ExpandedName, value: &str) -> JSXAttrValue {
  match name {
    expanded_name!("", "style") => {
      if let Ok(attr) = lightningcss::stylesheet::StyleAttribute::parse(value, Default::default()) {
        let properties = attr
          .declarations
          .declarations
          .into_iter()
          .map(|decl| {
            let name = match decl.property_id() {
              lightningcss::properties::PropertyId::Custom(
                lightningcss::properties::custom::CustomPropertyName::Custom(name),
              ) => name.0.as_ref().to_string(),
              id => {
                let name = id.name();
                name.to_case(Case::Camel)
              }
            };

            PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
              key: if Ident::verify_symbol(&name).is_err() {
                PropName::Str(name.into())
              } else {
                PropName::Ident(IdentName::new(name.into(), DUMMY_SP))
              },
              value: Box::new(
                decl
                  .value_to_css_string(Default::default())
                  .unwrap_or_default()
                  .into(),
              ),
            })))
          })
          .collect();

        JSXAttrValue::JSXExprContainer(JSXExprContainer {
          span: DUMMY_SP,
          expr: JSXExpr::Expr(Box::new(Expr::Object(ObjectLit {
            props: properties,
            span: DUMMY_SP,
          }))),
        })
      } else {
        JSXAttrValue::JSXExprContainer(JSXExprContainer {
          span: DUMMY_SP,
          expr: JSXExpr::Expr(Box::new(Expr::Object(ObjectLit {
            props: vec![],
            span: DUMMY_SP,
          }))),
        })
      }
    }
    _ => {
      if let Ok(num) = value.parse::<f64>() {
        return JSXAttrValue::JSXExprContainer(JSXExprContainer {
          span: DUMMY_SP,
          expr: JSXExpr::Expr(Box::new(Expr::Lit(Lit::Num(num.into())))),
        });
      } else if value.ends_with("px") {
        if let Ok(num) = value[0..value.len() - 2].parse::<f64>() {
          return JSXAttrValue::JSXExprContainer(JSXExprContainer {
            span: DUMMY_SP,
            expr: JSXExpr::Expr(Box::new(Expr::Lit(Lit::Num(num.into())))),
          });
        }
      } else if value.starts_with("{") && value.ends_with("}") {
        let source_map = Lrc::new(SourceMap::default());
        let source_file = source_map.new_source_file(
          Lrc::new(swc_core::common::FileName::Anon),
          value[1..value.len() - 1].to_string(),
        );
        let lexer = Lexer::new(
          Default::default(),
          Default::default(),
          StringInput::from(&*source_file),
          None,
        );

        let mut parser = Parser::new_from(lexer);
        match parser.parse_expr() {
          Ok(expr) => {
            return JSXAttrValue::JSXExprContainer(JSXExprContainer {
              span: DUMMY_SP,
              expr: JSXExpr::Expr(expr),
            });
          }
          Err(_) => {}
        }
      }

      JSXAttrValue::Str(value.into())
    }
  }
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JsxOptions {
  #[serde(default)]
  pub icon: Icon,
  #[serde(default)]
  pub expand_props: ExpandProps,
  #[serde(default = "default_true")]
  pub svgo: bool,
  #[serde(default)]
  pub svgo_config: OxvgConfig,
  #[serde(default = "default_true")]
  pub dimensions: bool,
  #[serde(default, rename = "ref")]
  add_ref: bool,
  #[serde(default)]
  memo: bool,
  #[serde(default)]
  replace_attr_values: IndexMap<String, String>,
  #[serde(default)]
  svg_props: IndexMap<String, String>,
  #[serde(default)]
  title_prop: bool,
  #[serde(default)]
  desc_prop: bool,
  template: Option<String>,
}

fn default_true() -> bool {
  true
}

impl Default for JsxOptions {
  fn default() -> Self {
    JsxOptions {
      icon: Icon::default(),
      expand_props: ExpandProps::default(),
      svgo: true,
      svgo_config: OxvgConfig::default(),
      dimensions: true,
      add_ref: false,
      memo: false,
      replace_attr_values: IndexMap::new(),
      svg_props: IndexMap::new(),
      title_prop: false,
      desc_prop: false,
      template: None,
    }
  }
}

#[derive(Default, Clone)]
pub enum Icon {
  #[default]
  None,
  String(String),
  Number(f64),
}

impl Icon {
  pub fn is_some(&self) -> bool {
    !matches!(self, Icon::None)
  }
}

impl<'de> Deserialize<'de> for Icon {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let value: serde_json::Value = Deserialize::deserialize(deserializer)?;
    Ok(match value {
      serde_json::Value::Bool(value) => {
        if value {
          Icon::String("1em".into())
        } else {
          Icon::None
        }
      }
      serde_json::Value::String(value) => Icon::String(value),
      serde_json::Value::Number(num) => num
        .as_f64()
        .map(Icon::Number)
        .unwrap_or_else(|| Icon::String("1em".into())),
      _ => Icon::None,
    })
  }
}

#[derive(Default, Clone)]
pub enum ExpandProps {
  Start,
  #[default]
  End,
  None,
}

impl<'de> Deserialize<'de> for ExpandProps {
  fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let value: serde_json::Value = Deserialize::deserialize(deserializer)?;
    Ok(match value {
      serde_json::Value::Bool(value) => {
        if value {
          ExpandProps::End
        } else {
          ExpandProps::None
        }
      }
      serde_json::Value::String(value) => match value.as_str() {
        "start" => ExpandProps::Start,
        "end" => ExpandProps::End,
        "none" => ExpandProps::None,
        _ => ExpandProps::End,
      },
      _ => ExpandProps::None,
    })
  }
}

pub fn to_component<'arena>(dom: &'arena Node<'arena>, options: &JsxOptions) -> Program {
  if let Some(svg) = dom.find(expanded_name!(svg "svg")) {
    svg.remove_attribute(expanded_name!(xmlns "xmlns"));
  }

  if options.dimensions {
    match &options.icon {
      Icon::None => {}
      Icon::String(value) => {
        if let Some(svg) = dom.find(expanded_name!(svg "svg")) {
          svg.set_attribute(expanded_name!("", "width"), &value);
          svg.set_attribute(expanded_name!("", "height"), &value);
        }
      }
      Icon::Number(value) => {
        if let Some(svg) = dom.find(expanded_name!(svg "svg")) {
          let value = value.to_string();
          svg.set_attribute(expanded_name!("", "width"), &value);
          svg.set_attribute(expanded_name!("", "height"), &value);
        }
      }
    }
  } else {
    if let Some(svg) = dom.find(expanded_name!(svg "svg")) {
      svg.remove_attribute(expanded_name!("", "width"));
      svg.remove_attribute(expanded_name!("", "height"));
    }
  }

  if !options.svg_props.is_empty() {
    if let Some(svg) = dom.find(expanded_name!(svg "svg")) {
      for (key, value) in &options.svg_props {
        svg.set_attribute(
          ExpandedName {
            ns: &ns!(),
            local: &key.clone().into(),
          },
          &value,
        );
      }
    }
  }

  if !options.replace_attr_values.is_empty() {
    dom.walk(&mut |node| {
      if let NodeData::Element { attrs, .. } = &node.data {
        for attr in attrs.borrow_mut().iter_mut() {
          if let Some(replacement) = options.replace_attr_values.get(attr.value.as_ref()) {
            attr.value = replacement.clone().into();
          }
        }
      }
    });
  }

  let jsx = to_jsx(dom);
  let mut params = Vec::new();
  let expr = match jsx {
    JSXElementChild::JSXElement(mut el) => {
      // Add extra props to the root <svg> element if needed.
      if options.add_ref
        || !matches!(options.expand_props, ExpandProps::None)
        || options.title_prop
        || options.desc_prop
      {
        let props = Ident::new_private("props".into(), DUMMY_SP);
        let ref_ = Ident::new_private("ref".into(), DUMMY_SP);
        let title = if options.title_prop {
          Some(Ident::new_private("title".into(), DUMMY_SP))
        } else {
          None
        };
        let desc = if options.desc_prop {
          Some(Ident::new_private("desc".into(), DUMMY_SP))
        } else {
          None
        };

        let mut pat = Pat::Ident(BindingIdent {
          id: props.clone(),
          type_ann: None,
        });

        if options.title_prop || options.desc_prop {
          let mut props = Vec::new();
          if let Some(title) = title {
            props.push(ObjectPatProp::Assign(AssignPatProp {
              span: DUMMY_SP,
              key: BindingIdent {
                id: title.clone(),
                type_ann: None,
              },
              value: None,
            }));

            el.children.insert(0, conditional_el("title", title));
          }
          if let Some(desc) = desc {
            props.push(ObjectPatProp::Assign(AssignPatProp {
              span: DUMMY_SP,
              key: BindingIdent {
                id: desc.clone(),
                type_ann: None,
              },
              value: None,
            }));

            el.children.insert(0, conditional_el("desc", desc));
          }

          props.push(ObjectPatProp::Rest(RestPat {
            span: DUMMY_SP,
            dot3_token: DUMMY_SP,
            arg: Box::new(pat),
            type_ann: None,
          }));

          pat = Pat::Object(ObjectPat {
            span: DUMMY_SP,
            props,
            optional: false,
            type_ann: None,
          })
        }

        params.push(Param {
          pat,
          decorators: vec![],
          span: DUMMY_SP,
        });

        if options.add_ref {
          params.push(Param {
            pat: Pat::Ident(BindingIdent {
              id: ref_.clone(),
              type_ann: None,
            }),
            decorators: vec![],
            span: DUMMY_SP,
          });

          el.opening.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
            span: DUMMY_SP,
            name: JSXAttrName::Ident(IdentName::new("ref".into(), DUMMY_SP)),
            value: Some(JSXAttrValue::JSXExprContainer(JSXExprContainer {
              span: DUMMY_SP,
              expr: JSXExpr::Expr(Box::new(Expr::Ident(ref_))),
            })),
          }));
        }

        if !matches!(options.expand_props, ExpandProps::None) {
          let spread = JSXAttrOrSpread::SpreadElement(SpreadElement {
            expr: Box::new(Expr::Ident(props)),
            dot3_token: DUMMY_SP,
          });

          match options.expand_props {
            ExpandProps::Start => el.opening.attrs.insert(0, spread),
            ExpandProps::End => el.opening.attrs.push(spread),
            ExpandProps::None => unreachable!(),
          }
        }
      }

      Expr::JSXElement(el)
    }
    JSXElementChild::JSXExprContainer(expr) => match expr.expr {
      JSXExpr::Expr(expr) => *expr,
      JSXExpr::JSXEmptyExpr(_) => Expr::Lit(Lit::Null(Null { span: DUMMY_SP })),
    },
    JSXElementChild::JSXText(text) => Expr::Lit(Lit::Str(text.value.into())),
    JSXElementChild::JSXFragment(frag) => Expr::JSXFragment(frag),
    JSXElementChild::JSXSpreadChild(_) => unreachable!(),
  };

  let function = FnExpr {
    ident: Some(Ident::new_private("SvgComponent".into(), DUMMY_SP)),
    function: Box::new(Function {
      params,
      body: Some(FunctionBody {
        stmts: vec![Stmt::Return(ReturnStmt {
          arg: Some(Box::new(expr)),
          ..Default::default()
        })],
        ..Default::default()
      }),
      ..Default::default()
    }),
  };

  let mut import_specifiers = Vec::new();

  // Add forwardRef and memo wrappers if needed.
  let mut expr = Expr::Fn(function);

  if options.add_ref {
    let forward_ref = Ident::new_private("forwardRef".into(), DUMMY_SP);
    expr = Expr::Call(CallExpr {
      callee: Callee::Expr(Box::new(Expr::Ident(forward_ref.clone()))),
      args: vec![ExprOrSpread {
        expr: Box::new(expr),
        spread: None,
      }],
      ..Default::default()
    });

    import_specifiers.push(ImportSpecifier::Named(ImportNamedSpecifier {
      local: forward_ref,
      imported: None,
      is_type_only: false,
      span: DUMMY_SP,
    }));
  }

  if options.memo {
    let memo = Ident::new_private("memo".into(), DUMMY_SP);
    expr = Expr::Call(CallExpr {
      callee: Callee::Expr(Box::new(Expr::Ident(memo.clone()))),
      args: vec![ExprOrSpread {
        expr: Box::new(expr),
        spread: None,
      }],
      ..Default::default()
    });

    import_specifiers.push(ImportSpecifier::Named(ImportNamedSpecifier {
      local: memo,
      imported: None,
      is_type_only: false,
      span: DUMMY_SP,
    }));
  }

  let import = if !import_specifiers.is_empty() {
    Some(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
      src: Box::new("react".into()),
      specifiers: import_specifiers,
      span: DUMMY_SP,
      type_only: false,
      phase: ImportPhase::default(),
      with: None,
    })))
  } else {
    None
  };

  let template = options.template.as_ref().and_then(|template| {
    let file = SourceFile::new(
      FileName::Anon.into(),
      false,
      FileName::Anon.into(),
      template.clone().into(),
      BytePos(1),
    );
    parse_file_as_module(
      &file,
      Default::default(),
      Default::default(),
      None,
      &mut Vec::new(),
    )
    .ok()
  });

  let module = if let Some(mut template) = template {
    if let Some(import) = import {
      let index = template
        .body
        .iter()
        .position(|p| !is_directive(p))
        .unwrap_or(0);
      template.body.insert(index, import);
    }
    template.visit_mut_with(&mut TemplateReplacer { expr: Some(expr) });
    template
  } else {
    let export = ModuleDecl::ExportDefaultExpr(ExportDefaultExpr {
      expr: Box::new(expr),
      span: DUMMY_SP,
    });

    let mut body = Vec::new();
    if let Some(import) = import {
      body.push(import);
    }

    body.push(ModuleItem::ModuleDecl(export));
    Module {
      body,
      ..Default::default()
    }
  };

  Program::Module(module)
}

fn is_directive(item: &ModuleItem) -> bool {
  if let ModuleItem::Stmt(Stmt::Expr(ExprStmt { expr, .. })) = item {
    matches!(&**expr, Expr::Lit(Lit::Str(Str { .. })))
  } else {
    false
  }
}

fn conditional_el(name: &str, children: Ident) -> JSXElementChild {
  let desc_ident = JSXElementName::Ident(Ident::new_no_ctxt(name.into(), DUMMY_SP));
  JSXElementChild::JSXExprContainer(JSXExprContainer {
    span: DUMMY_SP,
    expr: JSXExpr::Expr(Box::new(Expr::Bin(BinExpr {
      span: DUMMY_SP,
      op: BinaryOp::LogicalAnd,
      left: Box::new(Expr::Ident(children.clone())),
      right: Box::new(Expr::JSXElement(Box::new(JSXElement {
        span: DUMMY_SP,
        opening: JSXOpeningElement {
          name: desc_ident.clone(),
          attrs: Vec::new(),
          self_closing: false,
          span: DUMMY_SP,
          type_args: None,
        },
        children: vec![JSXElementChild::JSXExprContainer(JSXExprContainer {
          span: DUMMY_SP,
          expr: JSXExpr::Expr(Box::new(Expr::Ident(children))),
        })],
        closing: Some(JSXClosingElement {
          name: desc_ident,
          span: DUMMY_SP,
        }),
      }))),
    }))),
  })
}

struct TemplateReplacer {
  expr: Option<Expr>,
}

impl VisitMut for TemplateReplacer {
  fn visit_mut_expr(&mut self, node: &mut Expr) {
    if self.expr.is_some() && matches!(node, Expr::Ident(id) if id.sym == "$ICON") {
      *node = self.expr.take().unwrap();
    } else {
      node.visit_mut_children_with(self);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::arena::Sink;
  use html5ever::tendril::TendrilSink;
  use indoc::indoc;
  use pretty_assertions::assert_eq;
  use swc_core::ecma::codegen::to_code;
  use typed_arena::Arena;

  fn test(input: &str, expected: &str, options: JsxOptions) {
    let arena = Arena::new();
    let dom = xml5ever::driver::parse_document(
      Sink::new(&arena),
      xml5ever::driver::XmlParseOpts::default(),
    )
    .from_utf8()
    .one(input.as_bytes());

    swc_core::common::GLOBALS.set(&swc_core::common::Globals::new(), || {
      let program = to_component(dom, &options);
      let code = to_code(&program);

      assert_eq!(code, expected);
    });
  }

  #[test]
  fn test_default() {
    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent(props) {
        return <svg viewBox="0 0 100 100" {...props}>
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    };
    "#},
      Default::default(),
    );

    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg">
      <rect style="fill: rgb(255, 0, 0); stroke: yellow; font-family: Helvetica; --foo-bar: test"></rect>
    </svg>
    "#,
      indoc! {r##"
    export default function SvgComponent(props) {
        return <svg {...props}>
          <rect style={{
            fill: "red",
            stroke: "#ff0",
            fontFamily: "Helvetica",
            "--foo-bar": "test"
        }}/>
        </svg>;
    };
    "##},
      Default::default(),
    );
  }

  #[test]
  fn test_ref() {
    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    import { forwardRef } from "react";
    export default forwardRef(function SvgComponent(props, ref) {
        return <svg ref={ref} {...props}>
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    });
    "#},
      JsxOptions {
        add_ref: true,
        ..Default::default()
      },
    );
  }

  #[test]
  fn test_memo() {
    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    import { memo } from "react";
    export default memo(function SvgComponent(props) {
        return <svg {...props}>
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    });
    "#},
      JsxOptions {
        memo: true,
        ..Default::default()
      },
    );

    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    import { forwardRef, memo } from "react";
    export default memo(forwardRef(function SvgComponent(props, ref) {
        return <svg ref={ref} {...props}>
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    }));
    "#},
      JsxOptions {
        memo: true,
        add_ref: true,
        ..Default::default()
      },
    );
  }

  #[test]
  fn test_props() {
    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent(props) {
        return <svg {...props} viewBox="0 0 100 100">
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    };
    "#},
      JsxOptions {
        expand_props: ExpandProps::Start,
        ..Default::default()
      },
    );

    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent() {
        return <svg viewBox="0 0 100 100">
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    };
    "#},
      JsxOptions {
        expand_props: ExpandProps::None,
        ..Default::default()
      },
    );

    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    import { forwardRef } from "react";
    export default forwardRef(function SvgComponent(props, ref) {
        return <svg viewBox="0 0 100 100" ref={ref}>
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    });
    "#},
      JsxOptions {
        expand_props: ExpandProps::None,
        add_ref: true,
        ..Default::default()
      },
    );

    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <text xml:space="preserve"> foo </text>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent(props) {
        return <svg viewBox="0 0 100 100" {...props}>
          <text xmlSpace="preserve"> foo </text>
        </svg>;
    };
    "#},
      JsxOptions {
        ..Default::default()
      },
    );
  }

  #[test]
  fn test_icon() {
    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent(props) {
        return <svg viewBox="0 0 100 100" width="1em" height="1em" {...props}>
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    };
    "#},
      JsxOptions {
        icon: Icon::String("1em".into()),
        ..Default::default()
      },
    );

    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent(props) {
        return <svg viewBox="0 0 100 100" {...props}>
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    };
    "#},
      JsxOptions {
        icon: Icon::String("1em".into()),
        dimensions: false,
        ..Default::default()
      },
    );

    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="24" height="24">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent(props) {
        return <svg viewBox="0 0 100 100" {...props}>
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    };
    "#},
      JsxOptions {
        dimensions: false,
        ..Default::default()
      },
    );
  }

  #[test]
  fn test_title() {
    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent({ title, ...props }) {
        return <svg viewBox="0 0 100 100" {...props}>{title && <title>{title}</title>}
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    };
    "#},
      JsxOptions {
        title_prop: true,
        ..Default::default()
      },
    );
  }

  #[test]
  fn test_desc() {
    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent({ desc, ...props }) {
        return <svg viewBox="0 0 100 100" {...props}>{desc && <desc>{desc}</desc>}
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    };
    "#},
      JsxOptions {
        desc_prop: true,
        ..Default::default()
      },
    );

    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent({ title, desc, ...props }) {
        return <svg viewBox="0 0 100 100" {...props}>{desc && <desc>{desc}</desc>}{title && <title>{title}</title>}
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    };
    "#},
      JsxOptions {
        title_prop: true,
        desc_prop: true,
        ..Default::default()
      },
    );
  }

  #[test]
  fn test_svg_props() {
    test(
      r#"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="25" y="36" width="48" height="1" aria-label="Test" class="rect"></rect>
    </svg>
    "#,
      indoc! {r#"
    export default function SvgComponent(props) {
        return <svg viewBox="0 0 100 100" role="img" {...props}>
          <rect x={25} y={36} width={48} height={1} aria-label="Test" className="rect"/>
        </svg>;
    };
    "#},
      JsxOptions {
        svg_props: IndexMap::from([("role".into(), "img".into())]),
        ..Default::default()
      },
    );
  }

  #[test]
  fn test_replace_attr_values() {
    test(
      r##"
    <?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect fill="#ff0"></rect>
    </svg>
    "##,
      indoc! {r##"
    export default function SvgComponent(props) {
        return <svg viewBox="0 0 100 100" {...props}>
          <rect fill={props.fill}/>
        </svg>;
    };
    "##},
      JsxOptions {
        replace_attr_values: IndexMap::from([("#ff0".into(), "{props.fill}".into())]),
        ..Default::default()
      },
    );
  }
}
