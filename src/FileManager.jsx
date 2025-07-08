import { useEffect, useState } from 'react';

function FileManager({ onScriptSelect, loadedProject, loadedScript }) {
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsed, setCollapsed] = useState({});

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
      alert('Failed to create project');
    }
  };

  const handleImportClick = async (projectName) => {
    const filePaths = await window.electronAPI.selectFiles();
    if (!filePaths) return;

    await window.electronAPI.importScriptsToProject(filePaths, projectName);
    await loadProjects();
  };

  const startRename = (name) => {
    setRenaming(name);
    setRenameValue(name);
  };

  const cancelRename = () => {
    setRenaming(null);
    setRenameValue('');
  };

  const confirmRename = async (oldName) => {
    if (!renameValue.trim()) return;
    const success = await window.electronAPI.renameProject(oldName, renameValue.trim());
    if (!success) alert('Failed to rename project');
    cancelRename();
    await loadProjects();
  };

  const toggleCollapse = (name) => {
    setCollapsed((prev) => ({
      ...prev,
      [name]: !prev[name],
    }));
  };

  const handleDeleteScript = async (projectName, scriptName) => {
    const deleted = await window.electronAPI.deleteScript(projectName, scriptName);
    if (!deleted) alert('Failed to delete script');
    await loadProjects();
  };

  return (
    <div className="file-manager">
      <div className="file-manager-header">
        <h3>Projects</h3>
        <button onClick={() => setShowNewProjectInput(!showNewProjectInput)}>+ New Project</button>
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
        {projects.map((project) => (
          <div
            className={`project-group${collapsed[project.name] ? ' collapsed' : ''}`}
            key={project.name}
          >
            <div className="project-header">
              <div className="project-title">
                <button
                  className="toggle-button"
                  onClick={() => toggleCollapse(project.name)}
                >
                  {collapsed[project.name] ? '▶' : '▼'}
                </button>
                {renaming === project.name ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                  />
                ) : (
                  <h4>{project.name}</h4>
                )}
              </div>
              <div className="project-controls">
                {renaming === project.name ? (
                  <>
                    <button onClick={() => confirmRename(project.name)}>Save</button>
                    <button onClick={cancelRename}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleImportClick(project.name)}>+</button>
                    <button onClick={() => startRename(project.name)}>Rename</button>
                  </>
                )}
              </div>
            </div>
            <ul>
              {project.scripts.map((script) => {
                const isLoaded =
                  loadedProject === project.name && loadedScript === script;
                return (
                  <li
                    key={script}
                    className={`script-item${isLoaded ? ' loaded' : ''}`}
                  >
                    <button
                      className="script-button"
                      onClick={() => onScriptSelect(project.name, script)}
                    >
                      {script.replace(/\.[^/.]+$/, '')}
                    </button>
                    {isLoaded && <span className="loaded-indicator">(loaded)</span>}
                    <button
                      className="delete-button"
                      onClick={() => handleDeleteScript(project.name, script)}
                    >
                      ✖
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default FileManager;

