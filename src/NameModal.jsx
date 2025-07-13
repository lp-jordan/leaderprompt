import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function NameModal({ title, placeholder, onConfirm, onCancel, onBack }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm(value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="modal-actions">
          {onBack && <button onClick={onBack}>Back</button>}
          <button onClick={onCancel}>Cancel</button>
          <button onClick={() => onConfirm(value.trim())}>OK</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default NameModal;
