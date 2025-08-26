export function handleContextMenu(e, { editor, containerRef, openMenu, setSpellSuggestions }) {
  if (!editor) return;
  e.preventDefault();
  let sel = editor.state.selection;
  if (sel.empty) {
    const { $from } = sel;
    const text = $from.parent.textContent;
    const pos = $from.parentOffset;
    let start = pos;
    let end = pos;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    while (end < text.length && !/\s/.test(text[end])) end++;
    if (start !== end) {
      const from = sel.from - (pos - start);
      const to = sel.from + (end - pos);
      editor.commands.setTextSelection({ from, to });
      sel = editor.state.selection;
    }
  }
  const rect = containerRef.current?.getBoundingClientRect();
  if (rect) {
    openMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }
  const text = editor.state.doc.textBetween(sel.from, sel.to, ' ');
  const word = text.replace(/[\p{P}\p{S}]+$/u, '');
  if (word && !/\s/.test(word) && window.electronAPI?.spellCheck) {
    window.electronAPI.spellCheck(word).then((res) => {
      if (Array.isArray(res)) setSpellSuggestions(res);
      else setSpellSuggestions([]);
    });
  } else {
    setSpellSuggestions([]);
  }
}
