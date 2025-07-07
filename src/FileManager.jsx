import { useEffect, useState } from 'react';

function FileManager({ onScriptSelect }) {
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);

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
              <h4>{project.name}</h4>
              <button onClick={() => handleImportClick(project.name)}>+</button>
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
