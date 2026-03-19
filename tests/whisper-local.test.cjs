const test = require('node:test');
const assert = require('node:assert');
const { buildWavBuffer, stripWhisperNoise } = require('../electron/whisperLocal.cjs');

test('buildWavBuffer creates a wav header for mono pcm data', () => {
  const buffer = buildWavBuffer([0, 32767, -32768], 16000);
  assert.strictEqual(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(buffer.toString('ascii', 8, 12), 'WAVE');
  assert.strictEqual(buffer.readUInt32LE(24), 16000);
  assert.strictEqual(buffer.readUInt16LE(22), 1);
});

test('stripWhisperNoise removes timestamps and log prefixes', () => {
  const cleaned = stripWhisperNoise('main: processing\n[00:00:00.000 --> 00:00:01.000] Hello there\n');
  assert.strictEqual(cleaned, 'Hello there');
});
