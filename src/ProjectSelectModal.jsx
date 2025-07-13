import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function ProjectSelectModal({ projects = [], onCreateNew, onSelect, onCancel }) {
  const [selected, setSelected] = useState(projects[0] || '');
  const selectRef = useRef(null);

  useEffect(() => {
    if (selectRef.current) selectRef.current.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selected) onSelect(selected);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()}>
        <h3>Select Script Location</h3>
        <button onClick={onCreateNew}>Create New Project</button>
        {projects.length > 0 ? (
          <>
            <h4>Existing Projects</h4>
            <select
              ref={selectRef}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              onKeyDown={handleKeyDown}
            >
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </>
        ) : (
          <p>No projects available. Create a new one.</p>
        )}
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={() => onSelect(selected)} disabled={!selected}>
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ProjectSelectModal;
