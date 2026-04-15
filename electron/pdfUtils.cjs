const zlib = require('zlib');

let pdfJsPromise = null;

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfJsPromise;
}

function decodePdfLiteralString(input) {
  let result = '';

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char !== '\\') {
      result += char;
      continue;
    }

    const next = input[index + 1];
    if (!next) break;

    if (/[0-7]/.test(next)) {
      let octal = next;
      let offset = 2;
      while (offset <= 3 && /[0-7]/.test(input[index + offset] || '')) {
        octal += input[index + offset];
        offset += 1;
      }
      result += String.fromCharCode(parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    switch (next) {
      case 'n':
        result += '\n';
        break;
      case 'r':
        result += '\r';
        break;
      case 't':
        result += '\t';
        break;
      case 'b':
        result += '\b';
        break;
      case 'f':
        result += '\f';
        break;
      case '(':
      case ')':
      case '\\':
        result += next;
        break;
      case '\n':
      case '\r':
        break;
      default:
        result += next;
        break;
    }

    index += 1;
  }

  return result;
}

function decodeUtf16Be(bytes) {
  let text = '';
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const codePoint = (bytes[index] << 8) | bytes[index + 1];
    if (codePoint === 0) continue;
    text += String.fromCharCode(codePoint);
  }
  return text;
}

function decodeHexToText(hex, cmap = null) {
  const normalized = (hex || '').replace(/\s+/g, '');
  if (!normalized) return '';

  const evenHex = normalized.length % 2 === 0 ? normalized : normalized.slice(0, -1);
  const bytes = Buffer.from(evenHex, 'hex');
  if (!bytes.length) return '';

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.subarray(2));
  }

  if (cmap && cmap.size) {
    const keyLengths = Array.from(new Set(Array.from(cmap.keys()).map((key) => key.length))).sort((a, b) => b - a);
    let cursor = 0;
    let text = '';

    while (cursor < evenHex.length) {
      let matched = false;
      for (const length of keyLengths) {
        const chunk = evenHex.slice(cursor, cursor + length);
        if (chunk.length !== length) continue;
        const value = cmap.get(chunk.toUpperCase());
        if (!value) continue;
        text += value;
        cursor += length;
        matched = true;
        break;
      }

      if (!matched) {
        text += Buffer.from(evenHex.slice(cursor, cursor + 2), 'hex').toString('latin1');
        cursor += 2;
      }
    }

    return text;
  }

  const latinText = bytes.toString('latin1');
  if (/^[\x20-\x7E\s]+$/.test(latinText)) {
    return latinText;
  }

  if (bytes.length % 2 === 0) {
    return decodeUtf16Be(bytes);
  }

  return latinText;
}

function parseCMap(content) {
  const cmap = new Map();
  if (!content || (!content.includes('beginbfchar') && !content.includes('beginbfrange'))) {
    return cmap;
  }

  const addEntry = (src, value) => {
    if (!src || !value) return;
    const decoded = decodeHexToText(value);
    if (decoded) cmap.set(src.toUpperCase(), decoded);
  };

  for (const block of content.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const match of block[1].matchAll(/<([^>]+)>\s*<([^>]+)>/g)) {
      addEntry(match[1], match[2]);
    }
  }

  for (const block of content.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const match of block[1].matchAll(/<([^>]+)>\s*<([^>]+)>\s*(\[[^\]]+\]|<[^>]+>)/g)) {
      const startHex = match[1];
      const endHex = match[2];
      const target = match[3].trim();
      const start = parseInt(startHex, 16);
      const width = startHex.length;

      if (target.startsWith('[')) {
        const values = Array.from(target.matchAll(/<([^>]+)>/g), (entry) => entry[1]);
        values.forEach((value, index) => {
          const code = (start + index).toString(16).toUpperCase().padStart(width, '0');
          addEntry(code, value);
        });
        continue;
      }

      const base = parseInt(target.slice(1, -1), 16);
      const end = parseInt(endHex, 16);
      for (let code = start; code <= end; code += 1) {
        const source = code.toString(16).toUpperCase().padStart(width, '0');
        const mapped = (base + (code - start)).toString(16).toUpperCase();
        addEntry(source, mapped.length % 2 === 0 ? mapped : mapped.padStart(mapped.length + 1, '0'));
      }
    }
  }

  return cmap;
}

function mergeCMaps(contents) {
  const merged = new Map();
  for (const content of contents) {
    const cmap = parseCMap(content);
    for (const [key, value] of cmap.entries()) {
      merged.set(key, value);
    }
  }
  return merged;
}

function extractPdfStrings(content, cmap) {
  const matches = [];
  const pushText = (value) => {
    if (!value) return;
    matches.push(value);
  };

  const pushMatches = (regex, transform = (match) => match[1]) => {
    for (const match of content.matchAll(regex)) {
      pushText(transform(match));
    }
  };

  pushMatches(/\(((?:\\.|[^\\()])*)\)\s*Tj/g, (match) => decodePdfLiteralString(match[1]));
  pushMatches(/\(((?:\\.|[^\\()])*)\)\s*'/g, (match) => decodePdfLiteralString(match[1]));
  pushMatches(/\d+\s+\d+\s+\(((?:\\.|[^\\()])*)\)\s*"/g, (match) => decodePdfLiteralString(match[1]));
  pushMatches(/<([^>]+)>\s*Tj/g, (match) => decodeHexToText(match[1], cmap));
  pushMatches(/<([^>]+)>\s*'/g, (match) => decodeHexToText(match[1], cmap));
  pushMatches(/\d+\s+\d+\s+<([^>]+)>\s*"/g, (match) => decodeHexToText(match[1], cmap));

  for (const block of content.matchAll(/\[(.*?)\]\s*TJ/gs)) {
    const parts = [];
    for (const part of block[1].matchAll(/\(((?:\\.|[^\\()])*)\)|<([^>]+)>/g)) {
      if (part[1]) parts.push(decodePdfLiteralString(part[1]));
      else if (part[2]) parts.push(decodeHexToText(part[2], cmap));
    }
    if (parts.length) pushText(parts.join(' '));
  }

  return matches;
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .reduce((parts, line) => {
      if (!line) {
        if (parts[parts.length - 1] !== '') parts.push('');
        return parts;
      }
      parts.push(line);
      return parts;
    }, [])
    .join('\n')
    .trim();
}

async function extractPdfTextWithPdfJs(buffer) {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: undefined,
  });

  try {
    const pdf = await loadingTask.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items || [];
      const lines = [];
      let currentLine = [];
      let lastY = null;
      let lastX = null;

      for (const item of items) {
        const text = item?.str || '';
        if (!text) continue;

        const transform = item.transform || [];
        const x = Number(transform[4] || 0);
        const y = Number(transform[5] || 0);
        const sameLine = lastY !== null && Math.abs(y - lastY) < 2;
        const needsNewLine = lastY !== null && !sameLine;
        const needsSpace = sameLine && lastX !== null && x - lastX > 3;

        if (needsNewLine && currentLine.length) {
          lines.push(currentLine.join('').trim());
          currentLine = [];
        } else if (needsSpace && currentLine.length) {
          currentLine.push(' ');
        }

        currentLine.push(text);
        lastY = y;
        lastX = x + Number(item.width || 0);
      }

      if (currentLine.length) {
        lines.push(currentLine.join('').trim());
      }

      const pageText = lines.filter(Boolean).join('\n');
      if (pageText) pages.push(pageText);
    }

    return normalizeExtractedText(pages.join('\n\n'));
  } finally {
    await loadingTask.destroy();
  }
}

function extractPdfTextFallback(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return '';

  const source = buffer.toString('latin1');
  const extractedBlocks = [];
  const decodedContents = [];
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;

  for (const match of source.matchAll(streamRegex)) {
    const rawBuffer = Buffer.from(match[1], 'latin1');
    const candidateBuffers = [rawBuffer];

    try {
      candidateBuffers.push(zlib.inflateSync(rawBuffer));
    } catch {}

    try {
      candidateBuffers.push(zlib.inflateRawSync(rawBuffer));
    } catch {}

    for (const candidate of candidateBuffers) {
      decodedContents.push(candidate.toString('latin1'));
    }
  }

  const cmap = mergeCMaps([source, ...decodedContents]);

  for (const content of decodedContents) {
    const parts = extractPdfStrings(content, cmap);
    if (parts.length) extractedBlocks.push(parts.join('\n'));
  }

  if (!extractedBlocks.length) {
    const fallback = extractPdfStrings(source, cmap).join('\n');
    return normalizeExtractedText(fallback);
  }

  return normalizeExtractedText(extractedBlocks.join('\n\n'));
}

async function extractPdfText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return '';

  try {
    const text = await extractPdfTextWithPdfJs(buffer);
    if (text) return text;
  } catch {
    // Fall through to the lightweight parser.
  }

  return extractPdfTextFallback(buffer);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text) {
  const normalized = normalizeExtractedText(text);
  if (!normalized) return '';

  return normalized
    .split(/\n\n+/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function buildPdfExportHtml(title, html) {
  const safeTitle = escapeHtml(title || 'LeaderPrompt Export');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      body {
        margin: 40px 48px;
        color: #18130d;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
        line-height: 1.5;
      }
      h1 {
        margin: 0 0 24px;
        font-size: 24px;
        line-height: 1.1;
      }
      p { margin: 0 0 12px; }
      ul, ol { margin: 0 0 12px 24px; }
      li { margin: 0 0 6px; }
      blockquote {
        margin: 0 0 12px;
        padding-left: 16px;
        border-left: 3px solid #d7aa63;
        color: #43362a;
      }
    </style>
  </head>
  <body>
    <h1>${safeTitle}</h1>
    ${html || '<p></p>'}
  </body>
</html>`;
}

module.exports = {
  buildPdfExportHtml,
  extractPdfText,
  textToHtml,
};
