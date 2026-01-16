// @flow strict-local

import assert from 'assert';
import {Readable} from 'stream';
import {replaceStream} from '../../src/requests/WriteBundleRequest';
import {HASH_REF_PREFIX, HASH_REF_HASH_LEN} from '../../src/constants';

function createHashRef(id: string): string {
  // Pad or truncate the id to exactly HASH_REF_HASH_LEN characters
  const paddedId = id
    .padEnd(HASH_REF_HASH_LEN, '0')
    .slice(0, HASH_REF_HASH_LEN);
  return HASH_REF_PREFIX + paddedId;
}

function createReplacement(id: string): string {
  // Create a replacement string with the same length as a hash ref
  // This ensures replacements don't change output length unexpectedly
  return id
    .padEnd(HASH_REF_PREFIX.length + HASH_REF_HASH_LEN, '0')
    .slice(0, HASH_REF_PREFIX.length + HASH_REF_HASH_LEN);
}

function collectStream(stream: stream$Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function createReadableStream(data: string | Buffer): Readable {
  const readable = new Readable();
  readable.push(data);
  readable.push(null);
  return readable;
}

function createChunkedReadableStream(chunks: Array<string | Buffer>): Readable {
  const readable = new Readable({
    read() {},
  });
  // Emit chunks asynchronously
  setImmediate(() => {
    for (const chunk of chunks) {
      readable.push(chunk);
    }
    readable.push(null);
  });
  return readable;
}

describe('WriteBundleRequest', () => {
  describe('replaceStream', () => {
    it('should replace a single hash reference', async () => {
      const hashRef = createHashRef('abc123');
      const replacement = createReplacement('replaced1');
      const hashRefToNameHash = new Map([[hashRef, replacement]]);

      const input = `some content ${hashRef} more content`;
      const stream = createReadableStream(input).pipe(
        replaceStream(hashRefToNameHash),
      );
      const result = await collectStream(stream);

      assert.strictEqual(
        result.toString(),
        `some content ${replacement} more content`,
      );
    });

    it('should replace multiple hash references', async () => {
      const hashRef1 = createHashRef('abc123');
      const hashRef2 = createHashRef('def456');
      const replacement1 = createReplacement('replaced1');
      const replacement2 = createReplacement('replaced2');
      const hashRefToNameHash = new Map([
        [hashRef1, replacement1],
        [hashRef2, replacement2],
      ]);

      const input = `${hashRef1} middle ${hashRef2}`;
      const stream = createReadableStream(input).pipe(
        replaceStream(hashRefToNameHash),
      );
      const result = await collectStream(stream);

      assert.strictEqual(
        result.toString(),
        `${replacement1} middle ${replacement2}`,
      );
    });

    it('should leave unmatched hash references unchanged', async () => {
      const hashRef = createHashRef('abc123');
      const unknownHashRef = createHashRef('unknown');
      const replacement = createReplacement('replaced1');
      const hashRefToNameHash = new Map([[hashRef, replacement]]);

      const input = `${hashRef} and ${unknownHashRef}`;
      const stream = createReadableStream(input).pipe(
        replaceStream(hashRefToNameHash),
      );
      const result = await collectStream(stream);

      assert.strictEqual(
        result.toString(),
        `${replacement} and ${unknownHashRef}`,
      );
    });

    it('should handle hash references split across chunk boundaries', async () => {
      const hashRef = createHashRef('splitchunk');
      const replacement = createReplacement('replaced1');
      const hashRefToNameHash = new Map([[hashRef, replacement]]);

      // Split the hash reference across two chunks
      const splitPoint = HASH_REF_PREFIX.length + 5;
      const chunk1 = `prefix ${hashRef.slice(0, splitPoint)}`;
      const chunk2 = `${hashRef.slice(splitPoint)} suffix`;

      const stream = createChunkedReadableStream([chunk1, chunk2]).pipe(
        replaceStream(hashRefToNameHash),
      );
      const result = await collectStream(stream);

      assert.strictEqual(result.toString(), `prefix ${replacement} suffix`);
    });

    it('should handle content with no hash references', async () => {
      const hashRefToNameHash = new Map<string, string>();

      const input = 'just some regular content without any references';
      const stream = createReadableStream(input).pipe(
        replaceStream(hashRefToNameHash),
      );
      const result = await collectStream(stream);

      assert.strictEqual(result.toString(), input);
    });

    it('should handle empty input', async () => {
      const hashRefToNameHash = new Map<string, string>();

      const stream = createReadableStream('').pipe(
        replaceStream(hashRefToNameHash),
      );
      const result = await collectStream(stream);

      assert.strictEqual(result.toString(), '');
    });

    it('should copy output buffers to prevent corruption from buffer reuse', async () => {
      const hashRefToNameHash = new Map<string, string>();
      const transform = replaceStream(hashRefToNameHash);

      // First chunk is large enough to create a big 'replaced' buffer
      const chunk1 = Buffer.alloc(200, 0x41); // 'A' - creates 200-byte replaced buffer
      // Second chunk is smaller - will reuse the existing buffer
      const chunk2 = Buffer.alloc(100, 0x42); // 'B' - str will be 140 bytes, fits in 200

      const emittedBuffers: Buffer[] = [];

      // Process first chunk
      // $FlowFixMe[incompatible-call] - accessing internal _transform method for testing
      await new Promise<void>((resolve, reject) => {
        transform._transform(chunk1, 'buffer', (err, data) => {
          if (err) return reject(err);
          // $FlowFixMe[incompatible-call] - data is always Buffer in this context
          if (data != null) emittedBuffers.push(data);
          resolve();
        });
      });

      // Record the first buffer's content before processing the second chunk
      const firstBufferSnapshot = emittedBuffers[0]
        ? Array.from(emittedBuffers[0])
        : [];

      // Process second chunk - this reuses the internal 'replaced' buffer
      // and writes 'B' bytes starting at offset 0
      // $FlowFixMe[incompatible-call] - accessing internal _transform method for testing
      await new Promise<void>((resolve, reject) => {
        transform._transform(chunk2, 'buffer', (err, data) => {
          if (err) return reject(err);
          // $FlowFixMe[incompatible-call] - data is always Buffer in this context
          if (data != null) emittedBuffers.push(data);
          resolve();
        });
      });

      // Now check if the first emitted buffer is still intact
      const firstBufferNow = emittedBuffers[0]
        ? Array.from(emittedBuffers[0])
        : [];

      // Count how many bytes changed
      let corruptedBytes = 0;
      for (let i = 0; i < firstBufferSnapshot.length; i++) {
        if (firstBufferNow[i] !== firstBufferSnapshot[i]) {
          corruptedBytes++;
        }
      }

      assert.strictEqual(
        corruptedBytes,
        0,
        `First buffer was corrupted. ${corruptedBytes} bytes changed after processing second chunk.`,
      );

      // Verify first buffer contains only 'A's (0x41)
      const nonABytes = firstBufferNow.filter(b => b !== 0x41).length;
      assert.strictEqual(
        nonABytes,
        0,
        `First buffer should contain only 'A' bytes but found ${nonABytes} other bytes`,
      );
    });

    it('should handle multiple hash references in sequence', async () => {
      // Test multiple hash references processed in a single stream
      const hashRef1 = createHashRef('seqtest0001');
      const hashRef2 = createHashRef('seqtest0002');
      const hashRef3 = createHashRef('seqtest0003');
      const replacement1 = createReplacement('seqreplace1');
      const replacement2 = createReplacement('seqreplace2');
      const replacement3 = createReplacement('seqreplace3');
      const hashRefToNameHash = new Map([
        [hashRef1, replacement1],
        [hashRef2, replacement2],
        [hashRef3, replacement3],
      ]);

      const input = `start${hashRef1}mid1${hashRef2}mid2${hashRef3}end`;
      const stream = createReadableStream(input).pipe(
        replaceStream(hashRefToNameHash),
      );
      const result = await collectStream(stream);

      const expected = `start${replacement1}mid1${replacement2}mid2${replacement3}end`;
      assert.strictEqual(result.toString(), expected);
    });

    it('should handle binary data with embedded hash references', async () => {
      const hashRef = createHashRef('binarytest1');
      const replacement = createReplacement('binaryreplacement');
      const hashRefToNameHash = new Map([[hashRef, replacement]]);

      // Create binary data with embedded hash reference
      const binaryPrefix = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
      const binarySuffix = Buffer.from([0xfd, 0xfc, 0x03, 0x04, 0x05]);
      const hashRefBuffer = Buffer.from(hashRef);

      const input = Buffer.concat([binaryPrefix, hashRefBuffer, binarySuffix]);
      const stream = createReadableStream(input).pipe(
        replaceStream(hashRefToNameHash),
      );
      const result = await collectStream(stream);

      const expected = Buffer.concat([
        binaryPrefix,
        Buffer.from(replacement),
        binarySuffix,
      ]);
      assert.ok(result.equals(expected));
    });

    it('should not corrupt buffers emitted during flush', async () => {
      // Verifies the flush() method also emits independent buffer copies.
      const hashRefToNameHash = new Map<string, string>();
      const transform = replaceStream(hashRefToNameHash);

      const emittedBuffers: Buffer[] = [];

      // Process a chunk that will leave data in boundaryStr
      const chunk = Buffer.alloc(100, 0x43); // 'C'
      // $FlowFixMe[incompatible-call] - accessing internal _transform method for testing
      await new Promise<void>((resolve, reject) => {
        transform._transform(chunk, 'buffer', (err, data) => {
          if (err) return reject(err);
          // $FlowFixMe[incompatible-call] - data is always Buffer in this context
          if (data != null) emittedBuffers.push(data);
          resolve();
        });
      });

      // Now flush - this emits the remaining boundaryStr
      // $FlowFixMe[incompatible-call] - accessing internal _flush method for testing
      await new Promise<void>((resolve, reject) => {
        transform._flush((err, data) => {
          if (err) return reject(err);
          // $FlowFixMe[incompatible-call] - data is always Buffer in this context
          if (data != null) emittedBuffers.push(data);
          resolve();
        });
      });

      // Verify all emitted buffers are intact
      for (let i = 0; i < emittedBuffers.length; i++) {
        const buf = emittedBuffers[i];
        // All bytes should be 'C' (0x43)
        const nonCBytes = Array.from(buf).filter(b => b !== 0x43).length;
        assert.strictEqual(
          nonCBytes,
          0,
          `Buffer ${i} was corrupted: found ${nonCBytes} non-'C' bytes`,
        );
      }
    });

    it('should handle very large inputs with multiple buffer reallocations', async () => {
      // Test that large files with multiple hash references work correctly
      // This triggers multiple buffer reallocations as chunk sizes vary
      const hashRef1 = createHashRef('largetest001');
      const hashRef2 = createHashRef('largetest002');
      const replacement1 = createReplacement('largereplace1');
      const replacement2 = createReplacement('largereplace2');
      const hashRefToNameHash = new Map([
        [hashRef1, replacement1],
        [hashRef2, replacement2],
      ]);

      // Create large content with hash references scattered throughout
      const largePrefix = Buffer.alloc(50000, 0x58).toString(); // 'X' repeated
      const largeMid = Buffer.alloc(50000, 0x59).toString(); // 'Y' repeated
      const largeSuffix = Buffer.alloc(50000, 0x5a).toString(); // 'Z' repeated

      const input = `${largePrefix}${hashRef1}${largeMid}${hashRef2}${largeSuffix}`;
      const expected = `${largePrefix}${replacement1}${largeMid}${replacement2}${largeSuffix}`;

      const stream = createReadableStream(input).pipe(
        replaceStream(hashRefToNameHash),
      );
      const result = await collectStream(stream);

      assert.strictEqual(result.length, expected.length);
      assert.strictEqual(result.toString(), expected);
    });

    it('should produce consistent output with async chunk delays', async () => {
      const hashRef = createHashRef('asynctest01');
      const replacement = createReplacement('asynctest01');
      const hashRefToNameHash = new Map([[hashRef, replacement]]);

      const fullContent = `start ${hashRef} middle ${hashRef} end`;

      // Split into chunks larger than BOUNDARY_LENGTH (40 bytes)
      // to ensure the algorithm can handle hash refs spanning boundaries
      const chunkSize = 50;
      const chunks: string[] = [];
      for (let i = 0; i < fullContent.length; i += chunkSize) {
        chunks.push(fullContent.slice(i, i + chunkSize));
      }

      // Create a stream that emits chunks with real async delays
      const readable = new Readable({
        read() {},
      });

      const stream = readable.pipe(replaceStream(hashRefToNameHash));
      const resultPromise = collectStream(stream);

      // Emit chunks with actual delays to simulate real async behavior
      for (let i = 0; i < chunks.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
        readable.push(chunks[i]);
      }
      await new Promise(resolve => setTimeout(resolve, 5));
      readable.push(null);

      const result = await resultPromise;
      const expected = `start ${replacement} middle ${replacement} end`;

      assert.strictEqual(result.toString(), expected);
    });
  });
});
