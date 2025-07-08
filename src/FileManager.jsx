import { useEffect, useState } from 'react';
import ActionMenu from './ActionMenu';

function FileManager({ onScriptSelect, loadedProject, loadedScript }) {
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const [renamingProject, setRenamingProject] = useState(null);
  const [renamingScript, setRenamingScript] = useState(null);
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
    const success = await window.electronAPI.renameProject(oldName, renameValue.trim());
    if (!success) alert('Failed to rename project');
    cancelRename();
    await loadProjects();
  };

  const confirmRenameScript = async (projectName, oldName) => {
    if (!renameValue.trim()) return;
    const success = await window.electronAPI.renameScript(projectName, oldName, renameValue.trim());
    if (!success) alert('Failed to rename script');
    cancelRename();
    await loadProjects();
  };

  const handleDeleteProject = async (projectName) => {
    const deleted = await window.electronAPI.deleteProject(projectName);
    if (!deleted) alert('Failed to delete project');
    await loadProjects();
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
          <div className="project-group" key={project.name}>
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
                  <h4>{project.name}</h4>
                  <ActionMenu
                    actions={[
                      { label: 'Add File', onClick: () => handleImportClick(project.name) },
                      { label: 'Rename', onClick: () => startRenameProject(project.name) },
                      { label: 'Delete', onClick: () => handleDeleteProject(project.name) },
                    ]}
                  />
                </>
              )}
            </div>
            <ul>
              {project.scripts.map((script) => {
                const isLoaded =
                  loadedProject === project.name && loadedScript === script;
                const isRenaming =
                  renamingScript &&
                  renamingScript.projectName === project.name &&
                  renamingScript.scriptName === script;
                return (
                  <li
                    key={script}
                    className={`script-item${isLoaded ? ' loaded' : ''}`}
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
                        >
                          {script.replace(/\.[^/.]+$/, '')}
                        </button>
                        {isLoaded && (
                          <span className="loaded-indicator">(loaded)</span>
                        )}
                        <ActionMenu
                          actions={[
                            {
                              label: 'Rename',
                              onClick: () =>
                                startRenameScript(project.name, script),
                            },
                            {
                              label: 'Delete',
                              onClick: () =>
                                handleDeleteScript(project.name, script),
                            },
                          ]}
                        />
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

