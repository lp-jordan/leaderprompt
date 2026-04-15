import React, { useEffect, useRef, useState } from 'react';
import './NewProjectModal.css';

const ANIMATION_DURATION = 300;

function NewProjectModal({ clientNames = [], onConfirm, onCancel }) {
  const [visible, setVisible] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [clientValue, setClientValue] = useState(clientNames[0] || '');
  const [newClientName, setNewClientName] = useState('');
  const nameInputRef = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setVisible(true);
      nameInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const closeThen = (cb) => {
    setVisible(false);
    setTimeout(cb, ANIMATION_DURATION);
  };

  const handleCancel = () => closeThen(onCancel);

  const handleCreate = () => {
    const name = projectName.trim();
    if (!name) { nameInputRef.current?.focus(); return; }
    const resolvedClient = clientValue === '__new__' ? newClientName.trim() : clientValue;
    closeThen(() => onConfirm(name, resolvedClient));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
  };

  const handleFormKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
  };

  return (
    <div
      className={`npm-overlay${visible ? ' visible' : ''}`}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        className={`npm-card${visible ? ' visible' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="npm-title"
      >
        <h3 className="npm-title" id="npm-title">New Project</h3>

        <div className="npm-fields" onKeyDown={handleFormKeyDown}>
          <label className="npm-label" htmlFor="npm-name">Project name</label>
          <input
            id="npm-name"
            ref={nameInputRef}
            className="npm-input"
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Episode 4 — Reshoots"
          />

          <label className="npm-label" htmlFor="npm-client">Client</label>
          <select
            id="npm-client"
            className="npm-select"
            value={clientValue}
            onChange={(e) => setClientValue(e.target.value)}
          >
            <option value="">No client</option>
            {clientNames.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="__new__">+ New client…</option>
          </select>

          {clientValue === '__new__' && (
            <>
              <label className="npm-label" htmlFor="npm-new-client">New client name</label>
              <input
                id="npm-new-client"
                className="npm-input"
                type="text"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Client name"
                autoFocus
              />
            </>
          )}
        </div>

        <div className="npm-actions">
          <button className="surface-button surface-button-secondary" onClick={handleCancel}>Cancel</button>
          <button className="surface-button surface-button-primary" onClick={handleCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}

export default NewProjectModal;
