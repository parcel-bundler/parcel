const VLQ_SHIFT = 5;
const VLQ_CONTINUATION_BIT = 1 << VLQ_SHIFT;
const VLQ_VALUE_MASK = VLQ_CONTINUATION_BIT - 1;

const integerToChar = {};

export function encodeInteger(value) {
  let num = value;
  let result = '';
  let clamped;
  if (num < 0) {
    num = (-num << 1) | 1;
  } else {
    num <<= 1;
  }
  do {
    clamped = num & VLQ_VALUE_MASK;
    num >>= VLQ_SHIFT;
    if (num > 0) {
      clamped |= VLQ_CONTINUATION_BIT;
    }
    result += integerToChar[clamped];
  } while (num > 0);
  return result;
}

export function encodeVlq(value) {
  let answer = '',
    nextChunk,
    valueToEncode;
  const signBit = value < 0 ? 1 : 0;
  valueToEncode = (Math.abs(value) << 1) + signBit;
  while (valueToEncode || !answer) {
    nextChunk = valueToEncode & VLQ_VALUE_MASK;
    valueToEncode = valueToEncode >> VLQ_SHIFT;
    if (valueToEncode) {
      nextChunk |= VLQ_CONTINUATION_BIT;
    }
    answer += encodeBase64(nextChunk);
  }
  return answer;
}

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeBase64(value) {
  const encodedValue = BASE64_CHARS[value];
  if (encodedValue == null) {
    throw new Error(`Cannot Base64 encode value: ${value}`);
  }
  return encodedValue;
}
