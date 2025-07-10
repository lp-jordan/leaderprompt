import { useEffect, useRef, useState } from 'react';

function NameModal({ title, placeholder, onConfirm, onCancel }) {
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

  return (
    <div className="modal-overlay">
      <div className="modal-window">
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
          <button onClick={onCancel}>Cancel</button>
          <button onClick={() => onConfirm(value.trim())}>OK</button>
        </div>
      </div>
    </div>
  );
}

export default NameModal;
