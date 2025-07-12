use core::f64;

use swc_core::common::Span;

use crate::{
  number::{to_number, to_uint32},
  Evaluator, JsValue, Object,
};

pub struct Math;

impl Object for Math {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    if let JsValue::String(prop) = prop {
      match prop.as_str() {
        "E" => JsValue::Number(std::f64::consts::E),
        "LN10" => JsValue::Number(std::f64::consts::LN_10),
        "LN2" => JsValue::Number(std::f64::consts::LN_2),
        "LOG10E" => JsValue::Number(std::f64::consts::LOG10_E),
        "LOG2E" => JsValue::Number(std::f64::consts::LOG2_E),
        "SQRT1_2" => JsValue::Number(std::f64::consts::FRAC_1_SQRT_2),
        "SQRT2" => JsValue::Number(std::f64::consts::SQRT_2),
        "PI" => JsValue::Number(std::f64::consts::PI),
        "abs" => JsValue::Function((&abs).into()),
        "acos" => JsValue::Function((&acos).into()),
        "acosh" => JsValue::Function((&acosh).into()),
        "asin" => JsValue::Function((&asin).into()),
        "asinh" => JsValue::Function((&asinh).into()),
        "atan" => JsValue::Function((&atan).into()),
        "atanh" => JsValue::Function((&atanh).into()),
        "atan2" => JsValue::Function((&atan2).into()),
        "cbrt" => JsValue::Function((&cbrt).into()),
        "ceil" => JsValue::Function((&ceil).into()),
        "clz32" => JsValue::Function((&clz32).into()),
        "cos" => JsValue::Function((&cos).into()),
        "cosh" => JsValue::Function((&cosh).into()),
        "exp" => JsValue::Function((&exp).into()),
        "expm1" => JsValue::Function((&exp_m1).into()),
        "floor" => JsValue::Function((&floor).into()),
        "fround" => JsValue::Function((&fround).into()),
        "hypot" => JsValue::Function((&hypot).into()),
        "imul" => JsValue::Function((&imul).into()),
        "log" => JsValue::Function((&ln).into()),
        "log1p" => JsValue::Function((&ln_1p).into()),
        "log10" => JsValue::Function((&log10).into()),
        "log2" => JsValue::Function((&log2).into()),
        "max" => JsValue::Function((&max).into()),
        "min" => JsValue::Function((&min).into()),
        "pow" => JsValue::Function((&pow).into()),
        "round" => JsValue::Function((&round).into()),
        "sign" => JsValue::Function((&sign).into()),
        "sin" => JsValue::Function((&sin).into()),
        "sinh" => JsValue::Function((&sinh).into()),
        "sqrt" => JsValue::Function((&sqrt).into()),
        "tan" => JsValue::Function((&tan).into()),
        "tanh" => JsValue::Function((&tanh).into()),
        "trunc" => JsValue::Function((&trunc).into()),
        _ => JsValue::Unknown(span),
      }
    } else {
      JsValue::Unknown(span)
    }
  }

  fn to_string(&self) -> swc_core::atoms::Atom {
    "[object Math]".into()
  }
}

macro_rules! op {
  ($name: ident) => {
    fn $name(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
      let arg = args.get(0).unwrap_or(&JsValue::Undefined);
      let n = to_number(arg);
      n.map_or(JsValue::Unknown(span), |n| JsValue::Number(n.$name()))
    }
  };
}

// https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-function-properties-of-the-math-object
op!(abs);
op!(acos);
op!(acosh);
op!(asin);
op!(asinh);
op!(atan);
op!(atanh);
op!(cbrt);
op!(ceil);
op!(cos);
op!(cosh);
op!(exp);
op!(exp_m1);
op!(floor);
op!(ln);
op!(ln_1p);
op!(log10);
op!(log2);
op!(sin);
op!(sinh);
op!(sqrt);
op!(tan);
op!(tanh);
op!(trunc);

fn atan2(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let y = to_number(args.get(0).unwrap_or(&JsValue::Undefined));
  let x = to_number(args.get(1).unwrap_or(&JsValue::Undefined));
  if let (Ok(y), Ok(x)) = (y, x) {
    JsValue::Number(y.atan2(x))
  } else {
    JsValue::Unknown(span)
  }
}

fn clz32(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let arg = to_number(args.get(0).unwrap_or(&JsValue::Undefined));
  arg.map_or(JsValue::Unknown(span), |n| {
    JsValue::Number((n as u32).leading_zeros() as f64)
  })
}

fn fround(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let arg = to_number(args.get(0).unwrap_or(&JsValue::Undefined));
  arg.map_or(JsValue::Unknown(span), |n| {
    JsValue::Number(f64::from(n as f32))
  })
}

// fn f16round(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
//   let arg = to_number(args.get(0).unwrap_or(&JsValue::Undefined));
//   arg.map_or(JsValue::Unknown(span), |n| {
//     JsValue::Number(f64::from(n as f16))
//   })
// }

fn round(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let arg = to_number(args.get(0).unwrap_or(&JsValue::Undefined));
  arg.map_or(JsValue::Unknown(span), |n| {
    JsValue::Number(if n.fract() == -0.5 {
      n.ceil()
    } else {
      n.round()
    })
  })
}

fn hypot(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let mut result: f64 = 0.0;
  for arg in args {
    if let Ok(num) = to_number(&arg) {
      result = result.hypot(num);
    } else {
      return JsValue::Unknown(span);
    }
  }

  JsValue::Number(result)
}

fn imul(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let a = to_uint32(args.get(0).unwrap_or(&JsValue::Undefined));
  let b = to_uint32(args.get(1).unwrap_or(&JsValue::Undefined));
  if let (Ok(a), Ok(b)) = (a, b) {
    JsValue::Number(a.wrapping_mul(b) as i32 as f64)
  } else {
    JsValue::Unknown(span)
  }
}

fn max(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let mut result = f64::NEG_INFINITY;
  for arg in args {
    if let Ok(num) = to_number(&arg) {
      if result.is_nan() {
        continue;
      } else if num.is_nan() {
        result = f64::NAN;
      } else {
        result = result.max(num);
      }
    } else {
      return JsValue::Unknown(span);
    }
  }

  JsValue::Number(result)
}

fn min(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let mut result = f64::INFINITY;
  for arg in args {
    if let Ok(num) = to_number(&arg) {
      if result.is_nan() {
        continue;
      } else if num.is_nan() {
        result = f64::NAN;
      } else {
        result = result.min(num);
      }
    } else {
      return JsValue::Unknown(span);
    }
  }

  JsValue::Number(result)
}

fn pow(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let base = to_number(args.get(0).unwrap_or(&JsValue::Undefined));
  let exponent = to_number(args.get(1).unwrap_or(&JsValue::Undefined));
  if let (Ok(base), Ok(exponent)) = (base, exponent) {
    JsValue::Number(base.powf(exponent))
  } else {
    JsValue::Unknown(span)
  }
}

fn sign(_this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  let arg = to_number(args.get(0).unwrap_or(&JsValue::Undefined));
  arg.map_or(JsValue::Unknown(span), |n| {
    JsValue::Number(if n == 0.0 { n } else { n.signum() })
  })
}
