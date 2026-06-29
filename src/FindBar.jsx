import { useEffect, useRef, useState } from 'react';
import './FindBar.css';

// The rendered script lives inside one of these; the matching scroll container
// (the element that actually scrolls) is resolved separately below.
const SEARCH_ROOT_SELECTORS = ['.script-output', '.script-viewer-content'];
const SCROLL_CONTAINER_SELECTOR = '.script-viewer-content, .prompter-container';

// Treat non-breaking and other fixed-width spaces (and tabs) as ordinary spaces
// so a query typed with a normal space still matches text that was pasted or
// auto-formatted with an NBSP. Length is preserved 1:1 so match indices map
// straight back to DOM text offsets.
const normalize = (s) => s.replace(/[\u00A0\u2007\u202F\t]/g, ' ');

const getSearchRoot = () => {
  for (const sel of SEARCH_ROOT_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
};

// Layout distance from an element's top to its scroll container's content top,
// summed up the offsetParent chain so it is correct regardless of nesting and
// unaffected by any mirror/scale transform on the container (which only alters
// visual, not layout, geometry).
const offsetTopWithin = (el, container) => {
  let top = 0;
  let node = el;
  while (node && node !== container && container.contains(node)) {
    top += node.offsetTop;
    node = node.offsetParent;
  }
  return top;
};

function FindBar({ onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef(null);
  const barRef = useRef(null);
  const lastQueryRef = useRef('');

  useEffect(() => {
    inputRef.current?.focus();
    const handleClick = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) {
        clearHighlights();
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      clearHighlights();
    };
  }, [onClose]);

  const clearHighlights = () => {
    const roots = new Set();
    document.querySelectorAll('span.find-highlight').forEach((span) => {
      if (span.parentNode) roots.add(span.parentNode);
      span.replaceWith(document.createTextNode(span.textContent));
    });
    // Re-merge the text nodes we split apart, otherwise repeated searches leave
    // the script fragmented and future cross-fragment matches start to fail.
    const root = getSearchRoot();
    if (root) root.normalize();
    roots.forEach((node) => node.isConnected && node.normalize());
  };

  // Build one flat string of the script's text plus a map back to the DOM text
  // nodes, so a phrase is matched even when it is split across formatting spans,
  // <br>s or other inline markup — the per-node matching this replaces could
  // never see across those boundaries.
  const buildIndex = (root) => {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest?.('.find-bar')) return NodeFilter.FILTER_REJECT;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.nodeName)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      const raw = node.nodeValue;
      nodes.push({ node, start: text.length, end: text.length + raw.length });
      text += raw;
    }
    return { text, nodes };
  };

  const highlightAll = (term) => {
    clearHighlights();
    const root = getSearchRoot();
    if (!term || !root) return [];

    const { text, nodes } = buildIndex(root);
    const haystack = normalize(text).toLowerCase();
    const needle = normalize(term).toLowerCase();
    if (!needle) return [];

    // Locate every (non-overlapping) match in the flat string.
    const ranges = [];
    let from = 0;
    while (true) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + needle.length });
      from = idx + needle.length;
    }
    if (!ranges.length) return [];

    // Each match is one navigable result, but may map to several spans when it
    // crosses node boundaries — collect them so we can highlight/activate together.
    const matches = ranges.map(() => ({ spans: [] }));
    nodes.forEach(({ node, start: nodeStart, end: nodeEnd }) => {
      const overlaps = [];
      ranges.forEach((r, i) => {
        if (r.start < nodeEnd && r.end > nodeStart) overlaps.push(i);
      });
      if (!overlaps.length) return;

      const raw = node.nodeValue;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      overlaps.forEach((i) => {
        const r = ranges[i];
        const segStart = Math.max(r.start - nodeStart, 0);
        const segEnd = Math.min(r.end - nodeStart, raw.length);
        if (segStart > cursor) {
          frag.appendChild(document.createTextNode(raw.slice(cursor, segStart)));
        }
        const span = document.createElement('span');
        span.className = 'find-highlight';
        span.textContent = raw.slice(segStart, segEnd);
        frag.appendChild(span);
        matches[i].spans.push(span);
        cursor = segEnd;
      });
      if (cursor < raw.length) {
        frag.appendChild(document.createTextNode(raw.slice(cursor)));
      }
      node.replaceWith(frag);
    });

    return matches.filter((m) => m.spans.length);
  };

  const scrollToResult = (result) => {
    const el = result.spans[0];
    if (!el) return;
    const container = el.closest(SCROLL_CONTAINER_SELECTOR);
    if (container) {
      const top =
        offsetTopWithin(el, container) -
        container.clientHeight / 2 +
        el.offsetHeight / 2;
      container.scrollTo({ top, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const setActive = (result, on) => {
    result?.spans.forEach((span) => span.classList.toggle('active', on));
  };

  const goTo = (index) => {
    if (!results.length) return;
    const clamped = (index + results.length) % results.length;
    setActive(results[currentIndex], false);
    setActive(results[clamped], true);
    scrollToResult(results[clamped]);
    setCurrentIndex(clamped);
  };

  const handleSearch = () => {
    const res = highlightAll(query);
    setResults(res);
    setCurrentIndex(0);
    if (res.length) {
      setActive(res[0], true);
      scrollToResult(res[0]);
    }
  };

  const handleNext = () => {
    if (!results.length) return;
    goTo(currentIndex + 1);
    inputRef.current?.focus();
  };

  const handlePrev = () => {
    if (!results.length) return;
    goTo(currentIndex - 1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (query && query === lastQueryRef.current) {
        handleNext();
      } else {
        lastQueryRef.current = query;
        handleSearch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearHighlights();
      onClose?.();
    }
  };

  const counterText = results.length
    ? `${currentIndex + 1} of ${results.length}`
    : '0 of 0';

  return (
    <div className="find-bar" ref={barRef}>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
      />
      <div className="find-controls">
        <button onClick={handlePrev} disabled={!results.length}>&uarr;</button>
        <span className="find-counter">{counterText}</span>
        <button onClick={handleNext} disabled={!results.length}>&darr;</button>
      </div>
    </div>
  );
}

export default FindBar;
