import { useEffect, useState } from 'react';

function FileManager({ onScriptSelect }) {
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    const result = await window.electronAPI.getAllProjectsWithScripts();
    if (result) setProjects(result);
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
          <div className="project-group" key={project.name}>
            <div className="project-header">
              {renaming === project.name ? (
                <>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                  />
                  <button onClick={() => confirmRename(project.name)}>Save</button>
                  <button onClick={cancelRename}>Cancel</button>
                </>
              ) : (
                <>
                  <h4>{project.name}</h4>
                  <button onClick={() => handleImportClick(project.name)}>+</button>
                  <button onClick={() => startRename(project.name)}>Rename</button>
                </>
              )}
            </div>
            <ul>
              {project.scripts.map((script) => (
                <li key={script}>
                  <button onClick={() => onScriptSelect(project.name, script)}>
                    {script.replace(/\.[^/.]+$/, '')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default FileManager;
