use std::rc::Rc;

use swc_core::{common::Span, ecma::atoms::Atom as JsWord};

use crate::{Evaluator, Function, JsValue, Object};

pub struct JsString {}

impl Object for JsString {}

impl Function for JsString {
  fn call(
    &self,
    _this: JsValue,
    args: Vec<JsValue>,
    _span: Span,
    _evaluator: &crate::Evaluator,
  ) -> JsValue {
    if let Some(value) = args.get(0) {
      JsValue::String(value.to_string())
    } else {
      JsValue::String("".into())
    }
  }

  fn construct(&self, args: Vec<JsValue>, _span: Span, _evaluator: &crate::Evaluator) -> JsValue {
    let value = if let Some(value) = args.get(0) {
      value.to_string()
    } else {
      "".into()
    };

    JsValue::Object(Rc::new(StringObject { value }).into())
  }
}

// The JavaScript `String` object.
// https://tc39.es/ecma262/multipage/text-processing.html#sec-string-objects
pub struct StringObject {
  value: JsWord,
}

impl From<JsWord> for StringObject {
  fn from(value: JsWord) -> Self {
    StringObject { value }
  }
}

impl Object for StringObject {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    match prop {
      JsValue::Number(index) => {
        if *index < 0.0 {
          return JsValue::Undefined;
        }

        let mut iter = self.value.encode_utf16();
        let Some(c) = iter.nth(*index as usize) else {
          return JsValue::Undefined;
        };

        String::from_utf16(&[c]).map_or(JsValue::Unknown(span), |c| JsValue::String(c.into()))
      }
      JsValue::String(prop) => match prop.as_str() {
        "length" => JsValue::Number(self.value.encode_utf16().count() as f64),
        "toLowerCase" => JsValue::Function((&to_lower_case).into()),
        "toUpperCase" => JsValue::Function((&to_upper_case).into()),
        "trim" => JsValue::Function((&trim).into()),
        "trimStart" => JsValue::Function((&trim_start).into()),
        "trimEnd" => JsValue::Function((&trim_end).into()),
        "includes" => JsValue::Function((&includes).into()),
        "startsWith" => JsValue::Function((&starts_with).into()),
        "endsWith" => JsValue::Function((&ends_with).into()),
        "indexOf" => JsValue::Function((&index_of).into()),
        "codePointAt" => JsValue::Function((&code_point_at).into()),
        "charCodeAt" => JsValue::Function((&char_code_at).into()),
        "charAt" => JsValue::Function((&char_at).into()),
        "at" => JsValue::Function((&at).into()),
        "substring" => JsValue::Function((&substring).into()),
        "slice" => JsValue::Function((&slice).into()),
        "repeat" => JsValue::Function((&repeat).into()),
        "concat" => JsValue::Function((&concat).into()),
        _ => JsValue::Unknown(span),
      },
      _ => JsValue::Unknown(span),
    }
  }

  fn to_string(&self) -> JsWord {
    self.value.clone()
  }

  fn values<'a>(&'a self) -> Option<Box<dyn Iterator<Item = JsValue> + 'a>> {
    Some(Box::new(
      self
        .value
        .chars()
        .map(|c| JsValue::String(c.to_string().into())),
    ))
  }
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.tolowercase
fn to_lower_case(
  this: JsValue,
  _args: Vec<JsValue>,
  _span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  let s = this.to_string();
  JsValue::String(s.to_lowercase().into())
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.touppercase
fn to_upper_case(
  this: JsValue,
  _args: Vec<JsValue>,
  _span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  let s = this.to_string();
  JsValue::String(s.to_uppercase().into())
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.trim
fn trim(this: JsValue, _args: Vec<JsValue>, _span: Span, _evaluator: &Evaluator) -> JsValue {
  let s = this.to_string();
  JsValue::String(s.trim().into())
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.trimstart
fn trim_start(this: JsValue, _args: Vec<JsValue>, _span: Span, _evaluator: &Evaluator) -> JsValue {
  let s = this.to_string();
  JsValue::String(s.trim_start().into())
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.trimend
fn trim_end(this: JsValue, _args: Vec<JsValue>, _span: Span, _evaluator: &Evaluator) -> JsValue {
  let s = this.to_string();
  JsValue::String(s.trim_end().into())
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.includes
fn includes(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(search) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  // This throws at runtime if a regex is passed.
  if matches!(search, JsValue::Regex { .. }) {
    return JsValue::Unknown(span);
  }

  let position = if let Some(pos) = args.get(1) {
    if let JsValue::Number(pos) = pos {
      *pos as usize
    } else {
      return JsValue::Unknown(span);
    }
  } else {
    0
  };

  if position > 0 {
    // TODO: convert to UTF-16 and slice
    return JsValue::Unknown(span);
  }

  let this_str = this.to_string();
  let search_str = search.to_string();

  JsValue::Bool(this_str.contains(search_str.as_str()))
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.startswith
fn starts_with(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(search) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  // This throws at runtime if a regex is passed.
  if matches!(search, JsValue::Regex { .. }) {
    return JsValue::Unknown(span);
  }

  if args.len() > 1 {
    // TODO: convert to UTF-16 and slice
    return JsValue::Unknown(span);
  }

  let this_str = this.to_string();
  let search_str = search.to_string();

  JsValue::Bool(this_str.starts_with(search_str.as_str()))
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.endswith
fn ends_with(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(search) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  // This throws at runtime if a regex is passed.
  if matches!(search, JsValue::Regex { .. }) {
    return JsValue::Unknown(span);
  }

  if args.len() > 1 {
    // TODO: convert to UTF-16 and slice
    return JsValue::Unknown(span);
  }

  let this_str = this.to_string();
  let search_str = search.to_string();

  JsValue::Bool(this_str.ends_with(search_str.as_str()))
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.includes
fn index_of(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(search) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  let position = if let Some(pos) = args.get(1) {
    if let JsValue::Number(pos) = pos {
      *pos as usize
    } else {
      return JsValue::Unknown(span);
    }
  } else {
    0
  };

  let this_str: Vec<u16> = this.to_string().encode_utf16().collect();
  let search_str: Vec<u16> = search.to_string().encode_utf16().collect();
  let start = position.min(this_str.len());

  if search_str.len() == 0 {
    return JsValue::Number(start as f64);
  }

  let found = this_str[start..]
    .windows(search_str.len())
    .position(|window| window == search_str);

  JsValue::Number(found.map_or(-1.0, |index| (start + index) as f64))
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.codepointat
fn code_point_at(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(JsValue::Number(index)) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  if *index < 0.0 {
    return JsValue::Undefined;
  }

  let this_str = this.to_string();
  let mut iter = this_str.encode_utf16();
  let Some(first) = iter.nth(*index as usize) else {
    return JsValue::Undefined;
  };

  // Check if this is a high surrogate
  if first >= 0xD800 && first <= 0xDBFF {
    if let Some(second) = iter.next() {
      // Check if this is a valid low surrogate
      if second >= 0xDC00 && second <= 0xDFFF {
        // https://tc39.es/ecma262/multipage/ecmascript-language-source-code.html#sec-utf16decodesurrogatepair
        let res = (((first as usize) - 0xD800) * 0x400) + (second as usize) - 0xDC00 + 0x10000;
        return JsValue::Number(res as f64);
      }
    }
  }

  JsValue::Number(first as f64)
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.charcodeat
fn char_code_at(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(JsValue::Number(index)) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  if *index < 0.0 {
    return JsValue::Undefined;
  }

  let this_str = this.to_string();
  let mut iter = this_str.encode_utf16();
  let Some(c) = iter.nth(*index as usize) else {
    return JsValue::Undefined;
  };

  JsValue::Number(c as f64)
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.charcodeat
fn char_at(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(JsValue::Number(index)) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  if *index < 0.0 {
    return JsValue::String("".into());
  }

  let this_str = this.to_string();
  let mut iter = this_str.encode_utf16();
  let Some(c) = iter.nth(*index as usize) else {
    return JsValue::String("".into());
  };

  String::from_utf16(&[c]).map_or(JsValue::Unknown(span), |c| JsValue::String(c.into()))
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.at
fn at(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(JsValue::Number(index)) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  let this_str = this.to_string();
  let mut iter = this_str.encode_utf16();

  let k = if *index >= 0.0 {
    *index as usize
  } else {
    let count = iter.clone().count();
    let abs_index = (-*index) as usize;
    if abs_index > count {
      return JsValue::Undefined;
    }
    count - abs_index
  };

  let Some(c) = iter.nth(k) else {
    return JsValue::Undefined;
  };

  String::from_utf16(&[c]).map_or(JsValue::Unknown(span), |c| JsValue::String(c.into()))
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.substring
fn substring(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(JsValue::Number(start)) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  let start = *start as usize;
  let this_str = this.to_string();
  let iter = this_str.encode_utf16();

  let end = if let Some(JsValue::Number(end)) = args.get(1) {
    *end as usize
  } else {
    iter.clone().count()
  };

  let from = start.min(end);
  let to = start.max(end);

  let utf16_slice: Vec<u16> = iter.skip(from).take(to - from).collect();
  String::from_utf16(&utf16_slice).map_or(JsValue::Unknown(span), |c| JsValue::String(c.into()))
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.slice
fn slice(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(JsValue::Number(start)) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  let this_str = this.to_string();
  let iter = this_str.encode_utf16();
  let len = iter.clone().count();

  let from = if *start == f64::NEG_INFINITY {
    0
  } else if *start < 0.0 {
    (len as isize + *start as isize).max(0) as usize
  } else {
    (*start as usize).min(len)
  };

  let to = if let Some(JsValue::Number(end)) = args.get(1) {
    if *end == f64::NEG_INFINITY {
      0
    } else if *end < 0.0 {
      (len as isize + *end as isize).max(0) as usize
    } else {
      (*end as usize).min(len)
    }
  } else {
    iter.clone().count()
  };

  if from >= to {
    return JsValue::String("".into());
  }

  let utf16_slice: Vec<u16> = iter.skip(from).take(to - from).collect();
  String::from_utf16(&utf16_slice).map_or(JsValue::Unknown(span), |c| JsValue::String(c.into()))
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.repeat
fn repeat(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let Some(JsValue::Number(n)) = args.get(0) else {
    return JsValue::Unknown(span);
  };

  if *n < 0.0 || *n == f64::INFINITY {
    return JsValue::Unknown(span);
  }

  if *n == 0.0 {
    return JsValue::String("".into());
  }

  let s = this.to_string();
  JsValue::String(s.repeat(*n as usize).into())
}

// https://tc39.es/ecma262/multipage/text-processing.html#sec-string.prototype.concat
fn concat(this: JsValue, args: Vec<JsValue>, _span: Span, _evaluator: &Evaluator) -> JsValue {
  let mut res = this.to_string().to_string();
  for arg in args {
    res.push_str(&arg.to_string());
  }

  JsValue::String(res.into())
}
