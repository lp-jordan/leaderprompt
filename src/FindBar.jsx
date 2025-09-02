import { useCallback, useEffect, useRef, useState } from 'react';
import './FindBar.css';

function FindBar({ onClose, containerRef }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef(null);
  const barRef = useRef(null);
  const lastQueryRef = useRef('');

  const clearHighlights = useCallback(() => {
    const root = containerRef?.current || document.body;
    root.querySelectorAll('span.find-highlight').forEach((span) => {
      const text = document.createTextNode(span.textContent);
      span.replaceWith(text);
    });
  }, [containerRef]);

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
  }, [onClose, clearHighlights]);

  const highlightAll = (term) => {
    clearHighlights();
    if (!term) return [];
    const root = containerRef?.current || document.body;
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matched = [];
    const traverse = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match.index > lastIndex) {
            frag.appendChild(
              document.createTextNode(text.slice(lastIndex, match.index)),
            );
          }
          const span = document.createElement('span');
          span.className = 'find-highlight';
          span.textContent = match[0];
          frag.appendChild(span);
          matched.push(span);
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
        if (matched.length) node.replaceWith(frag);
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        node !== barRef.current &&
        !barRef.current?.contains(node) &&
        !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.tagName)
      ) {
        Array.from(node.childNodes).forEach(traverse);
      }
    };
    traverse(root);
    return matched;
  };

  const goTo = (index) => {
    if (!results.length) return;
    const clamped = (index + results.length) % results.length;
    results[currentIndex]?.classList.remove('active');
    const el = results[clamped];
    el.classList.add('active');
    const container = containerRef?.current;
    if (container) {
      container.scrollTo({
        top: el.offsetTop - container.clientHeight / 2,
        behavior: 'smooth',
      });
    } else {
      const fallback = el.closest('.script-viewer-content, .prompter-container');
      if (fallback) {
        fallback.scrollTo({
          top: el.offsetTop - fallback.clientHeight / 2,
          behavior: 'smooth',
        });
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    setCurrentIndex(clamped);
  };

  const handleSearch = () => {
    const res = highlightAll(query);
    setResults(res);
    setCurrentIndex(0);
    if (res.length) {
      res[0].classList.add('active');
      const container = containerRef?.current;
      if (container) {
        container.scrollTo({
          top: res[0].offsetTop - container.clientHeight / 2,
          behavior: 'smooth',
        });
      } else {
        const fallback = res[0].closest('.script-viewer-content, .prompter-container');
        if (fallback) {
          fallback.scrollTo({
            top: res[0].offsetTop - fallback.clientHeight / 2,
            behavior: 'smooth',
          });
        } else {
          res[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
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
