import { useEffect } from 'react';

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

  return (
    <div className="modal-overlay">
      <div className="modal-window">
        {title && <h3>{title}</h3>}
        <p>{message}</p>
        <div className="modal-actions">
          <button onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}

export default MessageModal;
