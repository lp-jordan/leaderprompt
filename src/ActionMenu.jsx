import { useEffect, useRef, useState, useCallback, memo } from 'react';

function ActionMenu({ actions }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleAction = useCallback(
    (fn) => {
      fn();
      setOpen(false);
    },
    [],
  );

  return (
    <div className="menu-container" ref={menuRef}>
      <button className="menu-toggle" onClick={() => setOpen(!open)}>
        ☰
      </button>
      <ul className={`menu${open ? ' open' : ''}`}>
        {actions.map(({ label, onClick }, idx) => (
          <li key={idx}>
            <button onClick={() => handleAction(onClick)}>{label}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default memo(ActionMenu);
