/* eslint-disable */
// Modified version of https://github.com/oasislabs/wasm-sourcemap/blob/77242f93ebd010cf69515d988b984244a119dd9d/index.js

// Modifications Copyright 2019 Oasis Labs
// Redistribution and use in source and binary forms, with or without modification, are permitted
// provided that the following conditions are met:

// 1. Redistributions of source code must retain the above copyright notice, this list of conditions
//    and the following disclaimer.

// 2. Redistributions in binary form must reproduce the above copyright notice, this list of
//    conditions and the following disclaimer in the documentation and/or other materials provided
//    with the distribution.

// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
// IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
// FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
// CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
// DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
// WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY
// WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const url = require('url');

const section = 'sourceMappingURL';

// read a variable uint encoding from the buffer stream.
// return the int, and the next position in the stream.
function read_uint(buf, pos) {
  let n = 0;
  let shift = 0;
  let b = buf[pos];
  let outpos = pos + 1;
  while (b >= 128) {
    n = n | ((b - 128) << shift);
    b = buf[outpos];
    outpos++;
    shift += 7;
  }
  return [n + (b << shift), outpos];
}

// Write a buffer with a variable uint encoding of a number.
function encode_uint(n) {
  let result = [];
  while (n > 127) {
    result.push(128 | (n & 127));
    n = n >> 7;
  }
  result.push(n);
  return new Uint8Array(result);
}

function ab2str(buf) {
  let str = '';
  let bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

function str2ab(str) {
  let bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str[i].charCodeAt(0);
  }
  return bytes;
}

/**
 * Construct an array buffer representing a WASM 0-id
 * sections containing a given name and value pair.
 * @param {String} name
 * @param {String} value
 * @returns {Uint8Array}
 */
function WriteSection(name, value, valLenOverride) {
  const nameBuf = str2ab(name);
  const valBuf = str2ab(value);
  const nameLen = encode_uint(nameBuf.length);
  const valLen = encode_uint(valLenOverride ?? valBuf.length);
  const sectionLenDeclared =
    nameLen.length +
    nameBuf.length +
    valLen.length +
    (valLenOverride ?? valBuf.length);
  const sectionLenActual =
    nameLen.length + nameBuf.length + valLen.length + valBuf.length;
  const headerLen = encode_uint(sectionLenDeclared);
  let bytes = new Uint8Array(sectionLenActual + headerLen.length + 1);
  let pos = 1;
  bytes.set(headerLen, pos);
  pos += headerLen.length;
  bytes.set(nameLen, pos);
  pos += nameLen.length;
  bytes.set(nameBuf, pos);
  pos += nameBuf.length;
  const val_start = pos;
  bytes.set(valLen, pos);
  pos += valLen.length;
  bytes.set(valBuf, pos);
  return bytes;
}

/**
 * Search the module sections of a WASM buffer to find
 * a section with a given identifier.
 * @param {Buffer} buf
 * @param {String} id
 * @returns {Array.<Number>} An array with the index of
 *   the section, the length of the section, and the index
 *   of the beginning of the body of the section.
 */
function FindSection(buf, id) {
  let pos = 8;
  while (pos < buf.byteLength) {
    const sec_start = pos;
    const [sec_id, pos2] = read_uint(buf, pos);
    const [sec_size, body_pos] = read_uint(buf, pos2);
    pos = body_pos + sec_size;
    if (sec_id == 0) {
      const [name_len, name_pos] = read_uint(buf, body_pos);
      const name = buf.slice(name_pos, name_pos + name_len);
      const nameString = ab2str(name);
      if (nameString == id) {
        return [
          sec_start,
          sec_size + 1 + (body_pos - pos2),
          name_pos + name_len,
        ];
      }
    }
  }
  return [-1, null, null];
}

module.exports = {
  /**
   * GetSourceMapURL extracts the source map from a WASM buffer.
   * @param {Buffer} buf The WASM buffer
   * @returns {String|null} The linked sourcemap URL if present.
   */
  GetSourceMapURL: function (buf) {
    buf = new Uint8Array(buf);
    const [sec_start, _, uri_start] = FindSection(buf, section);
    if (sec_start == -1) {
      return null;
    }
    const [uri_len, uri_pos] = read_uint(buf, uri_start);
    return ab2str(buf.slice(uri_pos, uri_pos + uri_len));
  },
  RemoveSourceMapURL: function (buf) {
    buf = new Uint8Array(buf);
    const [sec_start, sec_size, _] = FindSection(buf, section);
    if (sec_start == -1) {
      return buf;
    }
    let strippedBuf = new Uint8Array(buf.length - sec_size);
    strippedBuf.set(buf.slice(0, sec_start));
    strippedBuf.set(buf.slice(sec_start + sec_size), sec_start);

    return strippedBuf;
  },
  SetSourceMapURL: function (buf, url, urlLenOverride) {
    const stripped = module.exports.RemoveSourceMapURL(buf);
    const newSection = WriteSection(section, url, urlLenOverride);

    const outBuf = new Uint8Array(stripped.length + newSection.length);
    outBuf.set(stripped);
    outBuf.set(newSection, stripped.length);

    return outBuf;
  },
  SetSourceMapURLRelativeTo: function (buf, relativeURL) {
    const originalURL = module.exports.GetSourceMapURL(buf);
    const newURL = url.resolve(relativeURL, originalURL);
    return module.exports.SetSourceMapURL(buf, newURL);
  },
};
