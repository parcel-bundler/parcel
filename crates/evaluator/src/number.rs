use std::rc::Rc;

use num_traits::{float::FloatCore, ToPrimitive, Zero};
use swc_core::{common::Span, ecma::atoms::Atom as JsWord};

use crate::{Evaluator, Function, JsValue, Object};

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991_f64;
const MIN_SAFE_INTEGER: f64 = -9_007_199_254_740_991_f64;
const MAX_VALUE: f64 = f64::MAX;
const MIN_VALUE: f64 = 5e-324;

pub struct NumberConstructor {}

impl Function for NumberConstructor {
  // https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number-constructor-number-value
  fn call(
    &self,
    _this: JsValue,
    args: Vec<JsValue>,
    span: Span,
    _evaluator: &crate::Evaluator,
  ) -> JsValue {
    if let Some(value) = args.get(0) {
      match value {
        JsValue::BigInt(b) => b.to_f64().map_or(JsValue::Unknown(span), JsValue::Number),
        _ => to_number(value).map_or(JsValue::Unknown(span), JsValue::Number),
      }
    } else {
      JsValue::Number(0.0)
    }
  }

  fn construct(&self, args: Vec<JsValue>, span: Span, _evaluator: &crate::Evaluator) -> JsValue {
    let value = if let Some(value) = args.get(0) {
      match value {
        JsValue::BigInt(b) => b.to_f64(),
        _ => to_number(value).ok(),
      }
    } else {
      Some(0.0)
    };

    value.map_or(JsValue::Unknown(span), |value| {
      JsValue::Object(Rc::new(NumberObject { value }).into())
    })
  }
}

impl Object for NumberConstructor {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    if let JsValue::String(prop) = prop {
      match prop.as_str() {
        // https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-properties-of-the-number-constructor
        "EPSILON" => JsValue::Number(f64::EPSILON),
        "isFinite" => JsValue::Function((&number_is_finite).into()),
        "isInteger" => JsValue::Function((&is_integer).into()),
        "isNaN" => JsValue::Function((&number_is_nan).into()),
        "isSafeInteger" => JsValue::Function((&is_safe_integer).into()),
        "MAX_SAFE_INTEGER" => JsValue::Number(MAX_SAFE_INTEGER),
        "MAX_VALUE" => JsValue::Number(MAX_VALUE),
        "MIN_SAFE_INTEGER" => JsValue::Number(MIN_SAFE_INTEGER),
        "MIN_VALUE" => JsValue::Number(MIN_VALUE),
        "NaN" => JsValue::Number(f64::NAN),
        "NEGATIVE_INFINITY" => JsValue::Number(f64::NEG_INFINITY),
        "POSITIVE_INFINITY" => JsValue::Number(f64::INFINITY),
        "parseFloat" => JsValue::Function((&parse_float).into()),
        "parseInt" => JsValue::Function((&parse_int).into()),
        _ => JsValue::Unknown(span),
      }
    } else {
      JsValue::Unknown(span)
    }
  }
}

// https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber
pub fn to_number(value: &JsValue) -> Result<f64, ()> {
  match value {
    JsValue::Number(value) => Ok(*value),
    JsValue::BigInt(_) => Err(()),
    JsValue::Undefined => Ok(f64::NAN),
    JsValue::Null | JsValue::Bool(false) => Ok(0.0),
    JsValue::Bool(true) => Ok(1.0),
    JsValue::String(s) => string_to_number(s),
    _ => string_to_number(&value.to_string()),
  }
}

// https://tc39.es/ecma262/multipage/abstract-operations.html#sec-stringtonumber
fn string_to_number(value: &str) -> Result<f64, ()> {
  let value = value.trim();
  if value.is_empty() {
    return Ok(0.0);
  }

  if value == "-Infinity" {
    return Ok(f64::NEG_INFINITY);
  }

  if value == "Infinity" || value == "+Infinity" {
    return Ok(f64::INFINITY);
  }

  let radix = if value.starts_with("0b") || value.starts_with("0B") {
    Some(2)
  } else if value.starts_with("0o") || value.starts_with("0O") {
    Some(8)
  } else if value.starts_with("0x") || value.starts_with("0X") {
    Some(16)
  } else {
    None
  };

  if let Some(radix) = radix {
    let value = &value[2..];
    if value.is_empty() {
      return Ok(f64::NAN);
    }

    u32::from_str_radix(value, radix)
      .map_err(|_| ())
      .map(|v| v as f64)
  } else {
    value.parse().map_err(|_| ())
  }
}

// https://tc39.es/ecma262/multipage/abstract-operations.html#sec-toint32
pub fn to_int32(value: &JsValue) -> Result<i32, ()> {
  if let Ok(number) = to_number(value) {
    if !number.is_finite() || number.is_zero() {
      return Ok(0);
    }

    Ok(f64_to_int32(number))
  } else {
    Err(())
  }
}

/// Converts a 64-bit floating point number to an `i32` using [`FJCVTZS`][FJCVTZS] instruction on `ARMv8.3`.
///
/// [FJCVTZS]: https://developer.arm.com/documentation/dui0801/h/A64-Floating-point-Instructions/FJCVTZS
/// https://github.com/boa-dev/boa/blob/ff448e813260b75a323eff63972931d849cd0d91/core/engine/src/builtins/number/conversions.rs#L80
#[cfg(target_arch = "aarch64")]
fn f64_to_int32(number: f64) -> i32 {
  if number.is_nan() {
    return 0;
  }

  let ret: i32;
  // SAFETY: Number is not nan so no floating-point exception should throw.
  unsafe {
    std::arch::asm!(
      "fjcvtzs {dst:w}, {src:d}",
      src = in(vreg) number,
      dst = out(reg) ret,
    );
  }
  ret
}

#[cfg(not(target_arch = "aarch64"))]
fn f64_to_int32(number: f64) -> i32 {
  let (mantissa, exponent, sign) = number.integer_decode();
  let bits = if exponent < 0 {
    mantissa >> -exponent
  } else {
    (mantissa << exponent) & 0xFFFFFFFF
  };

  Ok(((sign as i64) * (bits as i64)) as i32)
}

// https://tc39.es/ecma262/multipage/abstract-operations.html#sec-touint32
pub fn to_uint32(value: &JsValue) -> Result<u32, ()> {
  if let Ok(number) = to_int32(value) {
    Ok(number as u32)
  } else {
    Err(())
  }
}

// https://tc39.es/ecma262/multipage/global-object.html#sec-isfinite-number
pub fn is_finite(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let Some(arg) = args.get(0) {
    if let Ok(num) = to_number(arg) {
      JsValue::Bool(num.is_finite())
    } else {
      JsValue::Unknown(span)
    }
  } else {
    JsValue::Bool(false)
  }
}

// https://tc39.es/ecma262/multipage/global-object.html#sec-isnan-number
pub fn is_nan(_this: JsValue, args: Vec<JsValue>, _span: Span, _evaluator: &Evaluator) -> JsValue {
  if let Some(arg) = args.get(0) {
    if let Ok(num) = to_number(arg) {
      JsValue::Bool(num.is_nan())
    } else {
      JsValue::Bool(true)
    }
  } else {
    JsValue::Bool(true)
  }
}

// https://tc39.es/ecma262/multipage/global-object.html#sec-parsefloat-string
pub fn parse_float(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let Some(arg) = args.get(0) {
    let s = arg.to_string();
    let s = s.trim_start();
    if s.starts_with("Infinity") || s.starts_with("+Infinity") {
      JsValue::Number(f64::INFINITY)
    } else if s.starts_with("-Infinity") {
      JsValue::Number(f64::NEG_INFINITY)
    } else if s.starts_with("inf") || s.starts_with("+inf") || s.starts_with("-inf") {
      JsValue::Number(f64::NAN)
    } else {
      // TODO: should be partial parse
      s.parse().map_or(JsValue::Unknown(span), JsValue::Number)
    }
  } else {
    JsValue::Number(f64::NAN)
  }
}

// https://tc39.es/ecma262/multipage/global-object.html#sec-parseint-string-radix
pub fn parse_int(
  _this: JsValue,
  args: Vec<JsValue>,
  span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let Some(arg) = args.get(0) {
    let s = arg.to_string();
    let mut s = s.trim_start();
    let sign = if s.starts_with("-") { -1 } else { 1 };
    if s.starts_with("+") || s.starts_with("-") {
      s = &s[1..];
    }
    let Ok(mut radix) = to_int32(args.get(1).unwrap_or(&JsValue::Undefined)) else {
      return JsValue::Unknown(span);
    };
    let mut strip_prefix = true;
    if radix != 0 {
      if radix < 2 || radix > 36 {
        return JsValue::Number(f64::NAN);
      }
      if radix != 16 {
        strip_prefix = false;
      }
    } else {
      radix = 10;
    }

    if strip_prefix {
      if s.starts_with("0x") || s.starts_with("0X") {
        s = &s[2..];
        radix = 16;
      }
    }

    let end = s
      .chars()
      .position(|code| !code.is_digit(radix as u32))
      .unwrap_or(s.len());

    let z = &s[0..end];
    if z.is_empty() {
      return JsValue::Number(f64::NAN);
    }

    let Ok(math_int) = u32::from_str_radix(z, radix as u32) else {
      return JsValue::Unknown(span);
    };

    if math_int == 0 {
      if sign == -1 {
        return JsValue::Number(-0.0);
      } else {
        return JsValue::Number(0.0);
      }
    }

    JsValue::Number((sign as f64) * math_int as f64)
  } else {
    JsValue::Number(f64::NAN)
  }
}

// https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.isfinite
fn number_is_finite(
  _this: JsValue,
  args: Vec<JsValue>,
  _span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let Some(JsValue::Number(num)) = args.get(0) {
    JsValue::Bool(num.is_finite())
  } else {
    JsValue::Bool(false)
  }
}

// https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.isnan
fn number_is_nan(
  _this: JsValue,
  args: Vec<JsValue>,
  _span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let Some(JsValue::Number(num)) = args.get(0) {
    JsValue::Bool(num.is_nan())
  } else {
    JsValue::Bool(false)
  }
}

// https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.isinteger
fn is_integer(_this: JsValue, args: Vec<JsValue>, _span: Span, _evaluator: &Evaluator) -> JsValue {
  if let Some(JsValue::Number(num)) = args.get(0) {
    JsValue::Bool(num.is_finite() && num.trunc() == *num)
  } else {
    JsValue::Bool(false)
  }
}

// https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.issafeinteger
fn is_safe_integer(
  _this: JsValue,
  args: Vec<JsValue>,
  _span: Span,
  _evaluator: &Evaluator,
) -> JsValue {
  if let Some(JsValue::Number(num)) = args.get(0) {
    JsValue::Bool(num.is_finite() && num.trunc() == *num && *num <= MAX_SAFE_INTEGER)
  } else {
    JsValue::Bool(false)
  }
}

pub struct NumberObject {
  value: f64,
}

impl From<f64> for NumberObject {
  fn from(value: f64) -> Self {
    NumberObject { value }
  }
}

impl Object for NumberObject {
  fn get(&self, prop: &JsValue, span: Span) -> JsValue {
    if let JsValue::String(prop) = prop {
      match prop.as_str() {
        "toString" => JsValue::Function((&to_string).into()),
        "toFixed" => JsValue::Function((&to_fixed).into()),
        _ => JsValue::Unknown(span),
      }
    } else {
      JsValue::Unknown(span)
    }
  }

  fn to_string(&self) -> JsWord {
    ryu_js::Buffer::new().format(self.value).into()
  }
}

// https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-thisnumbervalue
fn this_number_value(this: JsValue) -> Result<f64, ()> {
  match this {
    JsValue::Number(v) => Ok(v),
    JsValue::Object(obj) => {
      if let Some(num) = obj.as_any().downcast_ref::<NumberObject>() {
        Ok(num.value)
      } else {
        Err(())
      }
    }
    _ => Err(()),
  }
}

// https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tointegerorinfinity
fn to_integer_or_infinty(value: &JsValue) -> Result<f64, ()> {
  if let Ok(number) = to_number(value) {
    if number.is_nan() || number.is_zero() {
      return Ok(0.0);
    }
    if !number.is_finite() {
      return Ok(number);
    }
    Ok(number.trunc())
  } else {
    Err(())
  }
}

// https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.prototype.tostring
fn to_string(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let Ok(value) = this_number_value(this) {
    let radix = args.get(0).unwrap_or(&JsValue::Number(10.0));
    if let Ok(radix) = to_integer_or_infinty(radix) {
      if radix < 2.0 || radix > 36.0 {
        return JsValue::Unknown(span);
      }

      if radix == 10.0 {
        return JsValue::String(ryu_js::Buffer::new().format(value).into());
      }

      return JsValue::String(number_to_string(value, radix as u8));
    }
  }

  JsValue::Unknown(span)
}

// https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-tostring
fn number_to_string(mut value: f64, radix: u8) -> JsWord {
  if value.is_nan() {
    return "NaN".into();
  }

  if value.is_zero() {
    return "0".into();
  }

  if value.is_infinite() && value.is_sign_positive() {
    return "Infinity".into();
  }

  if value.is_infinite() && value.is_sign_negative() {
    return "-Infinity".into();
  }

  // https://github.com/boa-dev/boa/blob/e51fcd7f9637788c5e9e16f1e667f1fdfebef306/core/engine/src/builtins/number/mod.rs#L536
  // Character array used for conversion.
  // Temporary buffer for the result. We start with the decimal point in the
  // middle and write to the left for the integer part and to the right for the
  // fractional part. 1024 characters for the exponent and 52 for the mantissa
  // either way, with additional space for sign, decimal point and string
  // termination should be sufficient.
  const BUF_SIZE: usize = 2200;
  let mut buffer: [u8; BUF_SIZE] = [0; BUF_SIZE];
  let (int_buf, frac_buf) = buffer.split_at_mut(BUF_SIZE / 2);
  let mut fraction_cursor = 0;
  let negative = value.is_sign_negative();
  if negative {
    value = -value;
  }
  // Split the value into an integer part and a fractional part.
  // let mut integer = value.trunc();
  // let mut fraction = value.fract();
  let mut integer = value.floor();
  let mut fraction = value - integer;

  // We only compute fractional digits up to the input double's precision.
  let mut delta = 0.5 * (next_after(value, f64::MAX) - value);
  delta = next_after(0.0, f64::MAX).max(delta);
  assert!(delta > 0.0);
  if fraction >= delta {
    // Insert decimal point.
    frac_buf[fraction_cursor] = b'.';
    fraction_cursor += 1;
    loop {
      // Shift up by one digit.
      fraction *= f64::from(radix);
      delta *= f64::from(radix);
      // Write digit.
      let digit = fraction as u32;
      frac_buf[fraction_cursor] =
        std::char::from_digit(digit, radix as u32).expect("radix already checked") as u8;
      fraction_cursor += 1;
      // Calculate remainder.
      fraction -= f64::from(digit);
      // Round to even.
      if fraction + delta > 1.0
        && (fraction > 0.5 || (fraction - 0.5).abs() < f64::EPSILON && digit & 1 != 0)
      {
        loop {
          // We need to back trace already written digits in case of carry-over.
          fraction_cursor -= 1;
          if fraction_cursor == 0 {
            //              CHECK_EQ('.', buffer[fraction_cursor]);
            // Carry over to the integer part.
            integer += 1.;
          } else {
            let c: u8 = frac_buf[fraction_cursor];
            // Reconstruct digit.
            let digit = if c > b'9' { c - b'a' + 10 } else { c - b'0' };
            if digit + 1 >= radix {
              continue;
            }
            frac_buf[fraction_cursor] =
              std::char::from_digit(u32::from(digit + 1), u32::from(radix))
                .expect("digit was not a valid number in the given radix") as u8;
            fraction_cursor += 1;
          }
          break;
        }
        break;
      }
      if fraction < delta {
        break;
      }
    }
  }

  // Compute integer digits. Fill unrepresented digits with zero.
  let mut int_iter = int_buf.iter_mut().enumerate().rev();
  while FloatCore::integer_decode(integer / f64::from(radix)).1 > 0 {
    integer /= f64::from(radix);
    *int_iter.next().expect("integer buffer exhausted").1 = b'0';
  }

  loop {
    let remainder = integer % f64::from(radix);
    *int_iter.next().expect("integer buffer exhausted").1 =
      std::char::from_digit(remainder as u32, u32::from(radix))
        .expect("remainder not a digit in the given number") as u8;
    integer = (integer - remainder) / f64::from(radix);
    if integer <= 0f64 {
      break;
    }
  }
  // Add sign and terminate string.
  if negative {
    *int_iter.next().expect("integer buffer exhausted").1 = b'-';
  }
  assert!(fraction_cursor < BUF_SIZE);

  let integer_cursor = int_iter.next().expect("integer buffer exhausted").0 + 1;
  let fraction_cursor = fraction_cursor + BUF_SIZE / 2;
  String::from_utf8_lossy(&buffer[integer_cursor..fraction_cursor]).into()
}

// https://golang.org/src/math/nextafter.go
fn next_after(x: f64, y: f64) -> f64 {
  if x.is_nan() || y.is_nan() {
    f64::NAN
  } else if (x - y) == 0. {
    x
  } else if x == 0.0 {
    f64::from_bits(1).copysign(y)
  } else if y > x || x > 0.0 {
    f64::from_bits(x.to_bits() + 1)
  } else {
    f64::from_bits(x.to_bits() - 1)
  }
}

// https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.prototype.tofixed
fn to_fixed(this: JsValue, args: Vec<JsValue>, span: Span, _evaluator: &Evaluator) -> JsValue {
  if let Ok(value) = this_number_value(this) {
    let digits = args.get(0).unwrap_or(&JsValue::Number(0.0));
    if let Ok(digits) = to_integer_or_infinty(digits) {
      if digits < 0.0 || digits > 100.0 {
        return JsValue::Unknown(span);
      }

      return JsValue::String(
        ryu_js::Buffer::new()
          .format_to_fixed(value, digits as u8)
          .into(),
      );
    }
  }

  JsValue::Unknown(span)
}
