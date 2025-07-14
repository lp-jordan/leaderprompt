import {
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  useRef,
  useMemo,
} from 'react';
import ConfirmModal from './ConfirmModal.jsx';
// The old project ActionMenu has been replaced with inline buttons

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-.8 2.685 2.685-.8a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.5v15m7.5-7.5h-15"
      />
    </svg>
  );
}

const FileManager = forwardRef(function FileManager({
  onScriptSelect,
  loadedProject,
  loadedScript,
  currentProject,
  currentScript,
}, ref) {
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const [renamingProject, setRenamingProject] = useState(null);
  const [renamingScript, setRenamingScript] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const [tooltipScript, setTooltipScript] = useState(null);
  const tooltipTimerRef = useRef(null);
  const [sortBy, setSortBy] = useState('date');
  const [confirmState, setConfirmState] = useState(null);

  const sortedProjects = useMemo(() => {
    const arr = [...projects];
    arr.sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      return (b.added || 0) - (a.added || 0);
    });
    return arr;
  }, [projects, sortBy]);


  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    const result = await window.electronAPI.getAllProjectsWithScripts();
    if (result) {
      setProjects(result);
      setCollapsed((prev) => {
        const next = { ...prev };
        result.forEach((p) => {
          if (typeof next[p.name] === 'undefined') {
            next[p.name] = false;
          }
        });
        return next;
      });
    }
  };

  const handleNewProject = async () => {
    if (!newProjectName.trim()) return;

    const created = await window.electronAPI.createNewProject(newProjectName.trim());
    if (created) {
      setNewProjectName('');
      setShowNewProjectInput(false);
      loadProjects();
    } else {
      console.error('Failed to create project');
    }
  };

  const handleImportClick = async (projectName) => {
    const filePaths = await window.electronAPI.selectFiles();
    if (!filePaths) return;

    await window.electronAPI.importScriptsToProject(filePaths, projectName);
    await loadProjects();
  };

  const handleNewScript = async () => {
    let projectName = projects[0]?.name || 'Default';
    if (!projects.length) {
      await window.electronAPI.createNewProject(projectName);
      await loadProjects();
    }
    const result = await window.electronAPI.createNewScript(projectName, 'New Script');
    if (result && result.success) {
      await loadProjects();
      onScriptSelect(projectName, result.scriptName);
    }
  };


  useImperativeHandle(ref, () => ({
    newScript: handleNewScript,
    reload: loadProjects,
  }));

  const startRenameProject = (name) => {
    setRenamingScript(null);
    setRenamingProject(name);
    setRenameValue(name);
  };

  const startRenameScript = (projectName, scriptName) => {
    setRenamingProject(null);
    setRenamingScript({ projectName, scriptName });
    setRenameValue(scriptName);
  };

  const cancelRename = () => {
    setRenamingProject(null);
    setRenamingScript(null);
    setRenameValue('');
  };

  const confirmRenameProject = async (oldName) => {
    if (!renameValue.trim()) return;
    const success = await window.electronAPI.renameProject(
      oldName,
      renameValue.trim(),
    );
    if (!success) console.error('Failed to rename project');
    cancelRename();
    await loadProjects();
  };

  const confirmRenameScript = async (projectName, oldName) => {
    if (!renameValue.trim()) return;
    let newName = renameValue.trim();
    if (!newName.toLowerCase().endsWith('.docx')) {
      newName += '.docx';
    }
    const success = await window.electronAPI.renameScript(
      projectName,
      oldName,
      newName,
    );
    if (!success) console.error('Failed to rename script');
    cancelRename();
    await loadProjects();
  };


  const openConfirm = (message, action) => {
    setConfirmState({ message, action });
  };

  const handleDeleteProject = (projectName) => {
    openConfirm(
      `Delete project "${projectName}"? This will remove all its scripts.`,
      async () => {
        const deleted = await window.electronAPI.deleteProject(projectName);
        if (!deleted) console.error('Failed to delete project');
        await loadProjects();
      },
    );
  };

  const handleDeleteScript = (projectName, scriptName) => {
    openConfirm(
      `Delete script "${scriptName}" from "${projectName}"?`,
      async () => {
        const deleted = await window.electronAPI.deleteScript(projectName, scriptName);
        if (!deleted) console.error('Failed to delete script');
        await loadProjects();
      },
    );
  };

  const toggleCollapse = (projectName) => {
    setCollapsed((prev) => ({
      ...prev,
      [projectName]: !prev[projectName],
    }));
  };

  const handleScriptMouseEnter = (scriptName) => {
    tooltipTimerRef.current = setTimeout(() => {
      setTooltipScript(scriptName);
    }, 2000);
  };

  const handleScriptMouseLeave = () => {
    clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
    setTooltipScript(null);
  };

  return (
    <div className="file-manager">
      <div className="file-manager-header">
        <div className="header-left">
          <h2 className="header-title">Projects</h2>
        </div>
      </div>
      <div className="header-buttons">
        <select
          className="sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="date">Date Added</option>
          <option value="name">Name</option>
        </select>
        <button onClick={handleNewScript}>+ New Script</button>
        <button onClick={() => setShowNewProjectInput(!showNewProjectInput)}>
          + New Project
        </button>
      </div>

      {showNewProjectInput && (
        <div className="new-project-input">
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="Project name"
          />
          <button onClick={handleNewProject}>Create</button>
        </div>
      )}

      <div className="file-manager-list">
        {sortedProjects.map((project) => (
          <div
            className={`project-group${collapsed[project.name] ? ' collapsed' : ''}`}
            key={project.name}
          >
            <div className="project-header">
              {renamingProject === project.name ? (
                <>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                  />
                  <button onClick={() => confirmRenameProject(project.name)}>Save</button>
                  <button onClick={cancelRename}>Cancel</button>
                </>
              ) : (
                <>
                  <div className="project-title">
                    <button
                      className="toggle-button"
                      onClick={() => toggleCollapse(project.name)}
                    >
                      {collapsed[project.name] ? '▶' : '▼'}
                    </button>
                    <h4>{project.name}</h4>
                  </div>
                  <div className="project-actions">
                    <button
                      className="icon-button"
                      onClick={() => handleImportClick(project.name)}
                      aria-label="Add Script"
                    >
                      <PlusIcon />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => startRenameProject(project.name)}
                      aria-label="Rename"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => handleDeleteProject(project.name)}
                      aria-label="Delete"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </>
              )}
            </div>
            <ul>
              {project.scripts.map((script) => {
                const isPrompting =
                  loadedProject === project.name && loadedScript === script;
                const isLoaded =
                  currentProject === project.name && currentScript === script;
                const isRenaming =
                  renamingScript &&
                  renamingScript.projectName === project.name &&
                  renamingScript.scriptName === script;
                return (
                  <li
                    key={script}
                    className={`script-item${
                      isPrompting ? ' prompting' : ''
                    }${isLoaded ? ' loaded' : ''}`}
                  >
                    {isRenaming ? (
                      <>
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                        />
                        <button onClick={() => confirmRenameScript(project.name, script)}>Save</button>
                        <button onClick={cancelRename}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          className="script-button"
                          onClick={() => onScriptSelect(project.name, script)}
                          onMouseEnter={() => handleScriptMouseEnter(script)}
                          onMouseLeave={handleScriptMouseLeave}
                        >
                          {script.replace(/\.[^/.]+$/, '')}
                          {tooltipScript === script && (
                            <span className="script-tooltip">{script}</span>
                          )}
                        </button>
                        <div className="script-actions">
                          <button
                            className="icon-button"
                            onClick={() => startRenameScript(project.name, script)}
                            aria-label="Rename"
                          >
                            <PencilIcon />
                          </button>
                          <button
                            className="icon-button"
                            onClick={() => handleDeleteScript(project.name, script)}
                            aria-label="Delete"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {confirmState && (
        <ConfirmModal
          message={confirmState.message}
          onConfirm={() => {
            const { action } = confirmState;
            setConfirmState(null);
            action();
          }}
          onCancel={() => setConfirmState(null)}
        />
      )}

    </div>
  );
});

export default FileManager;

