import React, { useEffect, useRef, useState } from 'react';
import './ConfirmModal.css';

const ANIMATION_DURATION = 300; // ms

function ConfirmModal({ message, onConfirm, onCancel }) {
  const [visible, setVisible] = useState(false);
  const cancelButtonRef = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setVisible(true);
      cancelButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const closeThen = (cb) => {
    setVisible(false);
    setTimeout(cb, ANIMATION_DURATION);
  };

  const handleCancel = () => closeThen(onCancel);
  const handleConfirm = () => closeThen(onConfirm);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancel();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      handleConfirm();
    }
  };

  return (
    <div
      className={`confirm-modal-overlay ${visible ? 'visible' : ''}`}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        className={`confirm-modal ${visible ? 'visible' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Confirmation dialog"
      >
        <p>{message}</p>
        <div className="confirm-buttons">
          <button ref={cancelButtonRef} onClick={handleCancel}>Cancel</button>
          <button className="delete-button" onClick={handleConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
