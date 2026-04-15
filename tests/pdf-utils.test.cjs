const test = require('node:test');
const assert = require('node:assert');
const {
  buildPdfExportHtml,
  extractPdfText,
  textToHtml,
} = require('../electron/pdfUtils.cjs');

test('extractPdfText pulls readable text from simple PDF text operators', async () => {
  const pseudoPdf = Buffer.from('%PDF-1.4\nBT\n(Hello world) Tj\n[(Line) 120 (Two)] TJ\nET\n');
  const text = await extractPdfText(pseudoPdf);

  assert.match(text, /Hello world/);
  assert.match(text, /Line Two/);
});

test('extractPdfText decodes hex strings and ToUnicode maps', async () => {
  const pseudoPdf = Buffer.from(
    '%PDF-1.4\n' +
    'beginbfchar\n' +
    '<0001> <0048>\n' +
    '<0002> <0069>\n' +
    'endbfchar\n' +
    'stream\n' +
    'BT\n' +
    '<00010002> Tj\n' +
    '<FEFF004F004B> Tj\n' +
    'ET\n' +
    'endstream\n'
  );
  const text = await extractPdfText(pseudoPdf);

  assert.match(text, /Hi/);
  assert.match(text, /OK/);
});

test('textToHtml converts paragraphs and line breaks', () => {
  const html = textToHtml('First line\nSecond line\n\nThird paragraph');
  assert.match(html, /<p>First line<br \/>Second line<\/p>/);
  assert.match(html, /<p>Third paragraph<\/p>/);
});

test('buildPdfExportHtml wraps content in printable document shell', () => {
  const html = buildPdfExportHtml('My Script', '<p>Hello</p>');
  assert.match(html, /<title>My Script<\/title>/);
  assert.match(html, /<h1>My Script<\/h1>/);
  assert.match(html, /<p>Hello<\/p>/);
});
