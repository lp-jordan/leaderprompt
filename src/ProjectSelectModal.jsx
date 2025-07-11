import { useEffect, useRef, useState } from 'react';

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

  return (
    <div className="modal-overlay">
      <div className="modal-window">
        <h3>Select Project</h3>
        <button onClick={onCreateNew}>Create New Project</button>
        {projects.length > 0 ? (
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
    </div>
  );
}

export default ProjectSelectModal;
