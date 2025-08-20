import {
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  useRef,
} from 'react';
import ConfirmModal from './ConfirmModal.jsx';
import { toast } from 'react-hot-toast';
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
  const [sortBy, setSortBy] = useState('');
  const [confirmState, setConfirmState] = useState(null);
  const [dragInfo, setDragInfo] = useState(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [hoverProject, setHoverProject] = useState(null);
  const [rootDrag, setRootDrag] = useState(false);


  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    if (!window.electronAPI?.getAllProjectsWithScripts) {
      console.error('electronAPI unavailable');
      return;
    }
    const result = await window.electronAPI.getAllProjectsWithScripts();
    if (result) {
      setProjects(result);
      setCollapsed((prev) => {
        const next = { ...prev };
        result.forEach((p) => {
          if (typeof next[p.name] === 'undefined') {
            next[p.name] = true;
          }
        });
        return next;
      });
    }
  };

  const handleNewProject = async () => {
    if (!newProjectName.trim()) return;

    if (!window.electronAPI?.createNewProject) {
      console.error('electronAPI unavailable');
      return;
    }
    const created = await window.electronAPI.createNewProject(newProjectName.trim());
    if (created) {
      setNewProjectName('');
      setShowNewProjectInput(false);
      loadProjects();
      toast.success('Project created');
    } else {
      console.error('Failed to create project');
      toast.error('Failed to create project');
    }
  };

  const handleImportClick = async (projectName) => {
    if (!window.electronAPI?.selectFiles || !window.electronAPI?.importScriptsToProject) {
      console.error('electronAPI unavailable');
      return;
    }
    const filePaths = await window.electronAPI.selectFiles();
    if (!filePaths) return;

    await window.electronAPI.importScriptsToProject(filePaths, projectName);
    await loadProjects();
    toast.success('Scripts imported');
  };

  const handleNewScript = async () => {
    const projectName = 'Quick Scripts';
    if (!window.electronAPI?.createNewScript) {
      console.error('electronAPI unavailable');
      return;
    }
    const result = await window.electronAPI.createNewScript(projectName, 'New Script');
    if (result && result.success) {
      await loadProjects();
      onScriptSelect(projectName, result.scriptName);
      toast.success('Script created');
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
    if (!window.electronAPI?.renameProject) {
      console.error('electronAPI unavailable');
      toast.error('Failed to rename project');
      cancelRename();
      return;
    }
    const success = await window.electronAPI.renameProject(
      oldName,
      renameValue.trim(),
    );
    if (!success) {
      console.error('Failed to rename project');
      toast.error('Failed to rename project');
    } else {
      toast.success('Project renamed');
    }
    cancelRename();
    await loadProjects();
  };

  const confirmRenameScript = async (projectName, oldName) => {
    if (!renameValue.trim()) return;
    let newName = renameValue.trim();
    if (!newName.toLowerCase().endsWith('.docx')) {
      newName += '.docx';
    }
    if (!window.electronAPI?.renameScript) {
      console.error('electronAPI unavailable');
      toast.error('Failed to rename script');
      cancelRename();
      return;
    }
    const success = await window.electronAPI.renameScript(
      projectName,
      oldName,
      newName,
    );
    if (!success) {
      console.error('Failed to rename script');
      toast.error('Failed to rename script');
    } else {
      toast.success('Script renamed');
    }
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
        if (!window.electronAPI?.deleteProject) {
          console.error('electronAPI unavailable');
          toast.error('Failed to delete project');
          return;
        }
        const deleted = await window.electronAPI.deleteProject(projectName);
        if (!deleted) {
          console.error('Failed to delete project');
          toast.error('Failed to delete project');
        } else {
          toast.success('Project deleted');
        }
        await loadProjects();
      },
    );
  };

  const handleDeleteScript = (projectName, scriptName) => {
    openConfirm(
      `Delete script "${scriptName}" from "${projectName}"?`,
      async () => {
        if (!window.electronAPI?.deleteScript) {
          console.error('electronAPI unavailable');
          toast.error('Failed to delete script');
          return;
        }
        const deleted = await window.electronAPI.deleteScript(projectName, scriptName);
        if (!deleted) {
          console.error('Failed to delete script');
          toast.error('Failed to delete script');
        } else {
          toast.success('Script deleted');
        }
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

  const handleDragStart = (projectName, index) => {
    setDragInfo({ projectName, index });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDragEnter = (index) => {
    setHoverIndex(index);
  };

  const handleDragLeave = (index) => {
    setHoverIndex((prev) => (prev === index ? null : prev));
  };

  const handleProjectDragEnter = (projectName) => {
    setHoverProject(projectName);
  };

  const handleProjectDragLeave = (projectName) => {
    setHoverProject((prev) => (prev === projectName ? null : prev));
  };

  const handleProjectDrop = (e, projectName) => {
    const proj = projects.find((p) => p.name === projectName);
    const index = proj ? proj.scripts.length : -1;
    handleDrop(e, projectName, index);
    setHoverProject(null);
  };

  const handleRootDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const getDroppedFolders = (dataTransfer) => {
    const items = Array.from(dataTransfer.items || []);
    const dirs = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        const file = item.getAsFile();
        if (file?.path) dirs.push(file.path);
      }
    }
    return dirs;
  };

  const handleRootDragEnter = (e) => {
    if (e.target === e.currentTarget) {
      const folders = getDroppedFolders(e.dataTransfer);
      if (folders.length) setRootDrag(true);
    }
  };

  const handleRootDragLeave = (e) => {
    if (e.target === e.currentTarget) setRootDrag(false);
  };

  const handleRootDrop = async (e) => {
    e.preventDefault();
    if (e.target !== e.currentTarget) return;
    setRootDrag(false);
    let paths = getDroppedFolders(e.dataTransfer);
    if (!paths.length) {
      paths = Array.from(e.dataTransfer.files || []).map((f) => f.path);
    }
    if (paths.length) {
      if (!window.electronAPI?.importFoldersAsProjects) {
        console.error('electronAPI unavailable');
        return;
      }
      await window.electronAPI.importFoldersAsProjects(paths);
      await loadProjects();
      toast.success('Projects imported');
    }
  };

  const handleDrop = async (e, projectName, index) => {
    e.preventDefault();
    e.stopPropagation();
    const external = e.dataTransfer.files && e.dataTransfer.files.length;
    if (external && !dragInfo) {
      let filePaths = Array.from(e.dataTransfer.files || [])
        .map((f) => f.path)
        .filter((p) => p?.toLowerCase().endsWith('.docx'));

      const folderPaths = getDroppedFolders(e.dataTransfer);
      if (folderPaths.length) {
        const items = Array.from(e.dataTransfer.items || []);
        const collected = [];
        const traverse = async (entry) => {
          if (entry.isFile) {
            await new Promise((resolve) =>
              entry.file((file) => {
                if (file.path && file.path.toLowerCase().endsWith('.docx')) {
                  collected.push(file.path);
                }
                resolve();
              })
            );
          } else if (entry.isDirectory) {
            const reader = entry.createReader();
            await new Promise((resolve) => {
              const readEntries = () => {
                reader.readEntries(async (entries) => {
                  if (!entries.length) {
                    resolve();
                    return;
                  }
                  for (const ent of entries) {
                    await traverse(ent);
                  }
                  readEntries();
                });
              };
              readEntries();
            });
          }
        };

        for (const item of items) {
          const entry = item.webkitGetAsEntry?.();
          if (entry?.isDirectory) await traverse(entry);
        }
        filePaths = Array.from(new Set([...filePaths, ...collected]));
      }

      if (!filePaths.length) return;
      if (!window.electronAPI?.importScriptsToProject) {
        console.error('electronAPI unavailable');
        return;
      }
      await window.electronAPI.importScriptsToProject(filePaths, projectName);
      await loadProjects();
      toast.success('Scripts imported');
      return;
    }
    if (!dragInfo) return;

    if (dragInfo.projectName === projectName) {
      let newOrder = null;
      setProjects((prev) =>
        prev.map((p) => {
          if (p.name !== projectName) return p;
          const scripts = [...p.scripts];
          const [moved] = scripts.splice(dragInfo.index, 1);
          let target = index;
          if (dragInfo.index < index) target -= 1;
          scripts.splice(target, 0, moved);
          newOrder = scripts.map((s) => s.name);
          return { ...p, scripts };
        }),
      );
      setDragInfo(null);
      if (newOrder) {
        if (!window.electronAPI?.reorderScripts) {
          console.error('electronAPI unavailable');
          return;
        }
        await window.electronAPI.reorderScripts(projectName, newOrder);
      }
    } else {
      const sourceProject = dragInfo.projectName;
      const sourceScripts =
        projects.find((p) => p.name === sourceProject)?.scripts || [];
      const scriptName = sourceScripts[dragInfo.index]?.name;
      if (!scriptName) {
        setDragInfo(null);
        return;
      }
      const destScripts =
        projects.find((p) => p.name === projectName)?.scripts.map((s) => s.name) || [];
      const destOrder = [...destScripts];
      if (index < 0 || index > destOrder.length) destOrder.push(scriptName);
      else destOrder.splice(index, 0, scriptName);
      setDragInfo(null);
      if (!window.electronAPI?.moveScript || !window.electronAPI?.reorderScripts) {
        console.error('electronAPI unavailable');
        return;
      }
      await window.electronAPI.moveScript(
        sourceProject,
        projectName,
        scriptName,
        index,
      );
      await window.electronAPI.reorderScripts(projectName, destOrder);
      await loadProjects();
    }
  };

  return (
    <div className="file-manager">
      <div className="file-manager-header">
        <div className="header-left">
          <h2 className="header-title">Projects</h2>
        </div>
      </div>
      <div className="header-buttons">
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

      <div
        className={`file-manager-list${rootDrag ? ' drop-target' : ''}`}
        onDragOver={handleRootDragOver}
        onDragEnter={handleRootDragEnter}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {projects.map((project) => (
          <div className="project-group" key={project.name}>
            <div
              className={`project-header${hoverProject === project.name ? ' drop-target' : ''}`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleProjectDrop(e, project.name)}
              onDragEnter={() => handleProjectDragEnter(project.name)}
              onDragLeave={() => handleProjectDragLeave(project.name)}
            >
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
                  <div
                    className="project-title"
                    onClick={() => toggleCollapse(project.name)}
                  >
                    <button
                      className="toggle-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(project.name);
                      }}
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
                    <select
                      className="sort-select"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                    >
                      <option value="" disabled>
                        Sort
                      </option>
                      <option value="name">Name</option>
                      <option value="date">Date Added</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <ul className={collapsed[project.name] ? 'collapsed' : ''}>
              {project.scripts
                .slice()
                .sort((a, b) => {
                  if (sortBy === 'name') {
                    return a.name.localeCompare(b.name);
                  }
                  if (sortBy === 'date') {
                    return (a.added || 0) - (b.added || 0);
                  }
                  return 0;
                })
                .map((script) => {
                  const index = project.scripts.findIndex((s) => s.name === script.name);
                  const scriptName = script.name;
                  const isPrompting =
                    loadedProject === project.name && loadedScript === scriptName;
                  const isLoaded =
                    currentProject === project.name && currentScript === scriptName;
                  const isRenaming =
                    renamingScript &&
                    renamingScript.projectName === project.name &&
                    renamingScript.scriptName === scriptName;
                  return (
                    <li
                      key={scriptName}
                      draggable
                      onDragStart={() => handleDragStart(project.name, index)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, project.name, index)}
                      onDragEnter={() => handleDragEnter(index)}
                      onDragLeave={() => handleDragLeave(index)}
                      onDragEnd={() => {
                        setDragInfo(null);
                        setHoverIndex(null);
                      }}
                      className={`script-item${
                        isPrompting ? ' prompting' : ''
                      }${isLoaded ? ' loaded' : ''}${
                        hoverIndex === index ? ' drop-target' : ''
                      }`}
                    >
                      {isRenaming ? (
                        <>
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                          />
                          <button onClick={() => confirmRenameScript(project.name, scriptName)}>Save</button>
                          <button onClick={cancelRename}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button
                            className="script-button"
                            onClick={() => onScriptSelect(project.name, scriptName)}
                            onMouseEnter={() => handleScriptMouseEnter(scriptName)}
                            onMouseLeave={handleScriptMouseLeave}
                          >
                            {scriptName.replace(/\.[^/.]+$/, '')}
                            {tooltipScript === scriptName && (
                              <span className="script-tooltip">{scriptName}</span>
                            )}
                          </button>
                          <div className="script-actions">
                            <button
                              className="icon-button"
                              onClick={() => startRenameScript(project.name, scriptName)}
                              aria-label="Rename"
                            >
                              <PencilIcon />
                            </button>
                            <button
                              className="icon-button"
                              onClick={() => handleDeleteScript(project.name, scriptName)}
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

