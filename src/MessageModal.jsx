import { useEffect } from 'react';
import { createPortal } from 'react-dom';

function MessageModal({ title = 'Message', message, onClose }) {
  useEffect(() => {
    const handle = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()}>
        {title && <h3>{title}</h3>}
        <p>{message}</p>
        <div className="modal-actions">
          <button onClick={onClose}>OK</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default MessageModal;
