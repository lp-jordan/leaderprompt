export function createNotecardCacheKey({
  content,
  width,
  height,
  fontSize,
  lineHeight,
}) {
  return JSON.stringify({
    content,
    width,
    height,
    fontSize,
    lineHeight,
  });
}

export function generateNotecardSlides({
  content,
  width,
  height,
  fontSize,
  lineHeight,
}) {
  if (!content || width <= 0 || height <= 0) return [];

  const measure = document.createElement('div');
  measure.style.position = 'absolute';
  measure.style.visibility = 'hidden';
  measure.style.pointerEvents = 'none';
  measure.style.width = `${width}px`;
  measure.style.fontSize = `${fontSize}rem`;
  measure.style.lineHeight = String(lineHeight);
  measure.style.whiteSpace = 'normal';
  measure.style.inset = '-99999px auto auto -99999px';
  document.body.appendChild(measure);

  try {
    const parser = document.createElement('div');
    parser.innerHTML = content;
    const nodes = Array.from(parser.childNodes);

    const slides = [];
    let current = '';
    measure.innerHTML = '';

    for (const node of nodes) {
      const clone = node.cloneNode(true);
      measure.appendChild(clone);

      if (measure.scrollHeight > height && current) {
        slides.push(current);
        measure.innerHTML = '';
        measure.appendChild(clone);
        current = clone.outerHTML || clone.textContent || '';
      } else {
        current += clone.outerHTML || clone.textContent || '';
      }
    }

    if (current) slides.push(current);
    return slides;
  } finally {
    measure.remove();
  }
}
