const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTimestampMarkers(value) {
  return value.replace(/\[[^\]]*-->[^\]]*\]\s*/g, ' ');
}

function stripWhisperNoise(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^whisper_/i.test(line))
    .filter((line) => !/^system_info:/i.test(line))
    .filter((line) => !/^main:/i.test(line))
    .filter((line) => !/^processing/i.test(line))
    .filter((line) => !/^initial prompt:/i.test(line))
    .filter((line) => !/^samples:/i.test(line));

  return normalizeWhitespace(stripTimestampMarkers(lines.join(' ')));
}

function buildWavBuffer(int16Samples, sampleRate = 16000) {
  const samples = Int16Array.from(int16Samples || []);
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * 2);
  }

  return buffer;
}

function makeTempWavPath() {
  const token = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  return path.join(os.tmpdir(), 'leaderprompt-whisper-' + token + '.wav');
}

async function transcribeWithWhisperCpp({
  executablePath,
  modelPath,
  samples,
  sampleRate = 16000,
  language = 'en',
  keepWavPath = '',
}) {
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error('whisper.cpp executable was not found.');
  }
  if (!modelPath || !fs.existsSync(modelPath)) {
    throw new Error('Whisper model file was not found.');
  }
  if (!Array.isArray(samples) || samples.length === 0) {
    return { text: '', stdout: '', stderr: '', durationMs: 0, wavPath: '' };
  }

  const wavPath = keepWavPath || makeTempWavPath();
  await fs.promises.writeFile(wavPath, buildWavBuffer(samples, sampleRate));

  const args = ['-m', modelPath, '-f', wavPath, '-l', language, '-nt'];
  const startedAt = Date.now();

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(executablePath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => reject(error));
      child.on('close', (code) => {
        const durationMs = Date.now() - startedAt;
        if (code !== 0) {
          const error = new Error(stripWhisperNoise(stderr) || 'whisper.cpp exited with code ' + code + '.');
          error.stdout = stdout;
          error.stderr = stderr;
          error.durationMs = durationMs;
          error.wavPath = wavPath;
          reject(error);
          return;
        }
        resolve({ stdout, stderr, durationMs });
      });
    });

    const text = stripWhisperNoise(result.stdout) || stripWhisperNoise(result.stderr);
    return {
      text,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      wavPath,
    };
  } finally {
    if (!keepWavPath) {
      await fs.promises.unlink(wavPath).catch(() => {});
    }
  }
}

module.exports = {
  buildWavBuffer,
  stripWhisperNoise,
  transcribeWithWhisperCpp,
};
