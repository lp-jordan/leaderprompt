import React from 'react';
import './ConfirmModal.css';

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="confirm-modal-overlay">
      <div className="confirm-modal">
        <p>{message}</p>
        <div className="confirm-buttons">
          <button onClick={onCancel}>Cancel</button>
          <button className="delete-button" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
