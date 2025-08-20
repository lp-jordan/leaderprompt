import React, { useEffect, useState } from 'react';
import './ConfirmModal.css';

const ANIMATION_DURATION = 300; // ms

function ConfirmModal({ message, onConfirm, onCancel }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // trigger visibility after mount
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const closeThen = (cb) => {
    setVisible(false);
    setTimeout(cb, ANIMATION_DURATION);
  };

  const handleCancel = () => closeThen(onCancel);
  const handleConfirm = () => closeThen(onConfirm);

  return (
    <div className={`confirm-modal-overlay ${visible ? 'visible' : ''}`}>
      <div className={`confirm-modal ${visible ? 'visible' : ''}`}>
        <p>{message}</p>
        <div className="confirm-buttons">
          <button onClick={handleCancel}>Cancel</button>
          <button className="delete-button" onClick={handleConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
