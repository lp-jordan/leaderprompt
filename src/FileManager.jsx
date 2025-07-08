import { useEffect, useState } from 'react';

function FileManager({ onScriptSelect, loadedProject, loadedScript }) {
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingScript, setRenamingScript] = useState(null);
  const [renameScriptValue, setRenameScriptValue] = useState('');
  const [openMenu, setOpenMenu] = useState(null);

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

  const startScriptRename = (projectName, scriptName) => {
    setRenamingScript({ project: projectName, script: scriptName });
    setRenameScriptValue(scriptName.replace(/\.[^/.]+$/, ''));
    setOpenMenu(null);
  };

  const cancelScriptRename = () => {
    setRenamingScript(null);
    setRenameScriptValue('');
  };

  const confirmScriptRename = async (projectName, oldName) => {
    if (!renameScriptValue.trim()) return;
    const success = await window.electronAPI.renameScript(
      projectName,
      oldName,
      renameScriptValue.trim()
    );
    if (!success) alert('Failed to rename script');
    cancelScriptRename();
    await loadProjects();
  };

  const toggleMenu = (projectName, scriptName) => {
    const key = `${projectName}/${scriptName}`;
    setOpenMenu(openMenu === key ? null : key);
  };

  const handleDeleteScript = async (projectName, scriptName) => {
    setOpenMenu(null);
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
              {project.scripts.map((script) => {
                const isLoaded =
                  loadedProject === project.name && loadedScript === script;
                const menuKey = `${project.name}/${script}`;
                const isRenaming =
                  renamingScript &&
                  renamingScript.project === project.name &&
                  renamingScript.script === script;
                return (
                  <li
                    key={script}
                    className={`script-item${isLoaded ? ' loaded' : ''}`}
                    style={{ position: 'relative' }}
                  >
                    {isRenaming ? (
                      <>
                        <input
                          type="text"
                          value={renameScriptValue}
                          onChange={(e) => setRenameScriptValue(e.target.value)}
                        />
                        <button onClick={() => confirmScriptRename(project.name, script)}>
                          Save
                        </button>
                        <button onClick={cancelScriptRename}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          className="script-button"
                          onClick={() => onScriptSelect(project.name, script)}
                        >
                          {script.replace(/\.[^/.]+$/, '')}
                        </button>
                        {isLoaded && <span className="loaded-indicator">(loaded)</span>}
                        <button
                          className="script-menu-button"
                          onClick={() => toggleMenu(project.name, script)}
                        >
                          ⋮
                        </button>
                        {openMenu === menuKey && (
                          <div className="script-menu">
                            <button onClick={() => startScriptRename(project.name, script)}>
                              Rename
                            </button>
                            <button onClick={() => handleDeleteScript(project.name, script)}>
                              Delete
                            </button>
                          </div>
                        )}
                      </>
                    )}
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

