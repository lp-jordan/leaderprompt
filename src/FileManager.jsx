import {
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  useRef,
} from 'react';
import ConfirmModal from './ConfirmModal.jsx';
import NewProjectModal from './NewProjectModal.jsx';
import { toast } from 'react-hot-toast';
import {
  parseDataTransferItems,
  buildImportPayload,
  isSupportedImportFile,
} from './utils/dragHelpers.js';

const CONTEXT_MENU_WIDTH = 196;
const CONTEXT_MENU_ITEM_HEIGHT = 38;
const CONTEXT_MENU_PADDING = 8;

const PROJECT_ACCENTS = [
  {
    accent: '#d7aa63',
    strong: '#ebbf75',
    quiet: 'rgba(215, 170, 99, 0.12)',
    avatar: 'linear-gradient(180deg, rgba(215, 170, 99, 0.24), rgba(126, 87, 28, 0.24))',
  },
  {
    accent: '#6c8fbe',
    strong: '#8fb0de',
    quiet: 'rgba(108, 143, 190, 0.12)',
    avatar: 'linear-gradient(180deg, rgba(108, 143, 190, 0.24), rgba(43, 71, 117, 0.26))',
  },
  {
    accent: '#77a18d',
    strong: '#95bea9',
    quiet: 'rgba(119, 161, 141, 0.12)',
    avatar: 'linear-gradient(180deg, rgba(119, 161, 141, 0.24), rgba(46, 87, 69, 0.26))',
  },
  {
    accent: '#a787c5',
    strong: '#c6a8e0',
    quiet: 'rgba(167, 135, 197, 0.12)',
    avatar: 'linear-gradient(180deg, rgba(167, 135, 197, 0.24), rgba(84, 57, 115, 0.26))',
  },
];

function DotsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
    </svg>
  );
}

function getProjectAccent(projectName, index) {
  if (!projectName) return PROJECT_ACCENTS[index % PROJECT_ACCENTS.length];
  const hash = Array.from(projectName).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return PROJECT_ACCENTS[hash % PROJECT_ACCENTS.length];
}

function getProjectInitials(name) {
  if (!name) return '??';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '??';
}

function normalizeScriptName(scriptName) {
  return scriptName.replace(/\.[^/.]+$/, '');
}

function matchesSearch(scriptName, query) {
  if (!query) return true;
  return normalizeScriptName(scriptName).toLowerCase().includes(query.toLowerCase());
}

function getDropPosition(clientY, rect) {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function buildImportToast(result, fallback = 'Scripts imported') {
  if (!result || typeof result === 'number') return fallback;
  const importedCount = result.importedCount || 0;
  const renamedCount = result.renamedCount || 0;
  if (renamedCount > 0) {
    return `${importedCount} script${importedCount === 1 ? '' : 's'} imported (${renamedCount} renamed)`;
  }
  return `${importedCount} script${importedCount === 1 ? '' : 's'} imported`;
}

function buildExportToast(result, noun) {
  if (!result?.success) return null;
  if (result.exportedCount) {
    return `${result.exportedCount} ${noun}${result.exportedCount === 1 ? '' : 's'} exported`;
  }
  return `${noun} exported`;
}

const FileManager = forwardRef(function FileManager({
  onScriptSelect,
  loadedProject,
  loadedScript,
  currentProject,
  currentScript,
  onRootDragStateChange,
  onCreateDraft,
}, ref) {
  const fileManagerRef = useRef(null);
  const tooltipTimerRef = useRef(null);
  const [projects, setProjects] = useState([]);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [clientNames, setClientNames] = useState([]);
  const [renamingProject, setRenamingProject] = useState(null);
  const [renamingScript, setRenamingScript] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsed, setCollapsed] = useState({});
  const [tooltipScript, setTooltipScript] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [sortBy, setSortBy] = useState({});
  const [confirmState, setConfirmState] = useState(null);
  const [dragInfo, setDragInfo] = useState(null);
  const [hoverScriptDrop, setHoverScriptDrop] = useState(null);
  const [hoverProjectDrop, setHoverProjectDrop] = useState(null);
  const [rootDrag, setRootDrag] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectMenu, setProjectMenu] = useState(null);
  const [scriptMenu, setScriptMenu] = useState(null);
  const [sortMenu, setSortMenu] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const closeMenus = () => {
      setProjectMenu(null);
      setScriptMenu(null);
      setSortMenu(null);
    };
    window.addEventListener('click', closeMenus);
    window.addEventListener('resize', closeMenus);
    return () => {
      window.removeEventListener('click', closeMenus);
      window.removeEventListener('resize', closeMenus);
    };
  }, []);


  useEffect(() => {
    const menuSelector = projectMenu
      ? '.context-popover.project-menu button'
      : scriptMenu
        ? '.context-popover.script-menu button'
        : sortMenu
          ? '.context-popover.sort-menu button'
          : '';
    if (!menuSelector) return undefined;
    const id = requestAnimationFrame(() => fileManagerRef.current?.querySelector(menuSelector)?.focus());
    return () => cancelAnimationFrame(id);
  }, [projectMenu, scriptMenu, sortMenu]);
  const getProjectSortMode = (projectName) => sortBy[projectName] || '';

  const getDisplayedScripts = (project) => {
    const sortMode = getProjectSortMode(project.name);
    const scripts = project.scripts.slice();
    if (sortMode === 'name') scripts.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortMode === 'date') scripts.sort((a, b) => (a.added || 0) - (b.added || 0));
    return scripts;
  };

  const getProjectMenuItemCount = (project) => (project?.archived ? 5 : 6);
  const getScriptMenuItemCount = () => 5;

  const getMenuPosition = (clientX, clientY, itemCount) => {
    const containerRect = fileManagerRef.current?.getBoundingClientRect();
    const menuHeight = itemCount * CONTEXT_MENU_ITEM_HEIGHT + CONTEXT_MENU_PADDING;
    const minLeft = (containerRect?.left ?? 0) + CONTEXT_MENU_PADDING;
    const maxLeft = (containerRect?.right ?? window.innerWidth) - CONTEXT_MENU_WIDTH - CONTEXT_MENU_PADDING;
    const minTop = (containerRect?.top ?? 0) + CONTEXT_MENU_PADDING;
    const maxTop = Math.min(
      window.innerHeight - menuHeight - CONTEXT_MENU_PADDING,
      (containerRect?.bottom ?? window.innerHeight) - menuHeight - CONTEXT_MENU_PADDING,
    );

    return {
      x: Math.max(minLeft, Math.min(clientX, maxLeft)),
      y: Math.max(minTop, Math.min(clientY, maxTop)),
    };
  };

  const loadProjects = async () => {
    if (!window.electronAPI?.getAllProjectsWithScripts) return;
    const result = await window.electronAPI.getAllProjectsWithScripts();
    if (result) {
      setProjects(result);
      setCollapsed((prev) => {
        const next = { ...prev };
        result.forEach((project) => {
          if (typeof next[project.name] === 'undefined') next[project.name] = true;
        });
        return next;
      });
    }
  };


  const handleMenuKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setProjectMenu(null);
      setScriptMenu(null);
      setSortMenu(null);
      return;
    }

    const items = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled)'));
    const currentIndex = items.indexOf(document.activeElement);
    if (!items.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(currentIndex + 1 + items.length) % items.length]?.focus();
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    }
    if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    }
    if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const handleProjectHeaderKeyDown = (event, projectName) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleCollapse(projectName);
    }
  };

  const handleRenameKeyDown = (event, onSave) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSave();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  };

  const handleNewProject = async (name, clientName) => {
    if (!window.electronAPI?.createNewProject) return;
    setShowNewProjectModal(false);
    const created = await window.electronAPI.createNewProject(name, clientName);
    if (created) {
      await loadProjects();
      toast.success('Project created');
    } else {
      toast.error('Failed to create project');
    }
  };

  const handleImportClick = async (projectName) => {
    if (!window.electronAPI?.selectFiles || !window.electronAPI?.importScriptsToProject) return;
    const filePaths = await window.electronAPI.selectFiles();
    if (!filePaths) return;
    const result = await window.electronAPI.importScriptsToProject(filePaths, projectName);
    await loadProjects();
    toast.success(buildImportToast(result));
  };

  const handleExportProject = async (projectName, format) => {
    setProjectMenu(null);
    const result = await window.electronAPI?.exportProject?.(projectName, format);
    if (!result || result.canceled) return;
    if (result.success) {
      toast.success(buildExportToast(result, 'script'));
    } else {
      toast.error(`Failed to export project as ${format.toUpperCase()}`);
    }
  };

  const handleExportScript = async (projectName, scriptName, format) => {
    setScriptMenu(null);
    const result = await window.electronAPI?.exportScript?.(projectName, scriptName, format);
    if (!result || result.canceled) return;
    if (result.success) {
      toast.success(`${format.toUpperCase()} exported`);
    } else {
      toast.error(`Failed to export script as ${format.toUpperCase()}`);
    }
  };

  const handleArchiveProject = (projectName) => {
    openConfirm(`Archive project "${projectName}"? You can restore it later.`, async () => {
      const archived = await window.electronAPI?.archiveProject?.(projectName);
      if (!archived) {
        toast.error('Failed to archive project');
        return;
      }
      if (currentProject === projectName) onScriptSelect(null, null);
      toast.success('Project archived');
      await loadProjects();
    });
  };

  const handleRestoreProject = async (projectName) => {
    setProjectMenu(null);
    const restored = await window.electronAPI?.restoreProject?.(projectName);
    if (!restored) {
      toast.error('Failed to restore project');
      return;
    }
    toast.success('Project restored');
    setShowArchived(false);
    await loadProjects();
  };

  const handleNewScript = () => {
    onCreateDraft?.();
    setShowArchived(false);
  };

  useImperativeHandle(ref, () => ({ newScript: handleNewScript, reload: loadProjects }));

  const startRenameProject = (name) => {
    setProjectMenu(null);
    setSortMenu(null);
    setRenamingScript(null);
    setRenamingProject(name);
    setRenameValue(name);
  };

  const startRenameScript = (projectName, scriptName) => {
    setScriptMenu(null);
    setSortMenu(null);
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
    if (!renameValue.trim() || !window.electronAPI?.renameProject) return;
    const success = await window.electronAPI.renameProject(oldName, renameValue.trim());
    toast[success ? 'success' : 'error'](success ? 'Project renamed' : 'Failed to rename project');
    cancelRename();
    await loadProjects();
  };

  const confirmRenameScript = async (projectName, oldName) => {
    if (!renameValue.trim() || !window.electronAPI?.renameScript) return;
    let newName = renameValue.trim();
    if (!newName.toLowerCase().endsWith('.docx')) newName += '.docx';
    const success = await window.electronAPI.renameScript(projectName, oldName, newName);
    toast[success ? 'success' : 'error'](success ? 'Script renamed' : 'Failed to rename script');
    cancelRename();
    await loadProjects();
  };

  const openConfirm = (message, action) => {
    setProjectMenu(null);
    setScriptMenu(null);
    setSortMenu(null);
    setConfirmState({ message, action });
  };

  const handleDeleteScript = (projectName, scriptName) => {
    openConfirm(`Delete script "${scriptName}" from "${projectName}"?`, async () => {
      if (!window.electronAPI?.deleteScript) return;
      const deleted = await window.electronAPI.deleteScript(projectName, scriptName);
      if (!deleted) toast.error('Failed to delete script');
      else {
        toast.success('Script deleted');
        if (currentProject === projectName && currentScript === scriptName) onScriptSelect(null, null);
      }
      await loadProjects();
    });
  };

  const toggleCollapse = (projectName) => {
    setCollapsed((prev) => ({ ...prev, [projectName]: !prev[projectName] }));
  };

  const handleScriptMouseEnter = (scriptName, e) => {
    setTooltipPosition({ x: e.clientX, y: e.clientY });
    tooltipTimerRef.current = setTimeout(() => setTooltipScript(scriptName), 1000);
  };

  const handleScriptMouseMove = (e) => {
    if (tooltipTimerRef.current || tooltipScript) setTooltipPosition({ x: e.clientX, y: e.clientY });
  };

  const handleScriptMouseLeave = () => {
    clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
    setTooltipScript(null);
  };

  const handleScriptDragStart = (event, projectName, scriptName) => {
    event.dataTransfer.effectAllowed = 'move';
    setSortBy((current) => ({ ...current, [projectName]: '' }));
    setDragInfo({ type: 'script', projectName, scriptName });
  };

  const handleProjectDragStart = (event, projectName) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    setDragInfo({ type: 'project', projectName });
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleScriptDragOver = (event, projectName, scriptName) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragInfo?.type === 'project') return;
    const position = getDropPosition(event.clientY, event.currentTarget.getBoundingClientRect());
    setHoverProjectDrop(null);
    setHoverScriptDrop({ projectName, scriptName, position });
  };

  const reorderVisibleProjects = (allProjects, sourceName, targetName, position) => {
    const targetArchived = allProjects.find((project) => project.name === targetName)?.archived;
    const visible = allProjects.filter((project) => project.archived === targetArchived);
    const visibleIndex = new Map(visible.map((project, index) => [project.name, index]));
    const sourceIndex = visibleIndex.get(sourceName);
    const targetIndex = visibleIndex.get(targetName);
    if (typeof sourceIndex !== 'number' || typeof targetIndex !== 'number') {
      return { changed: false, projects: allProjects };
    }

    const reordered = [...visible];
    const [moved] = reordered.splice(sourceIndex, 1);
    let insertAt = targetIndex;
    if (position === 'after') insertAt += 1;
    if (sourceIndex < targetIndex) insertAt -= 1;
    insertAt = Math.max(0, Math.min(insertAt, reordered.length));
    reordered.splice(insertAt, 0, moved);

    if (reordered.every((project, index) => project.name === visible[index]?.name)) {
      return { changed: false, projects: allProjects };
    }

    let visibleCursor = 0;
    return {
      changed: true,
      projects: allProjects.map((project) => (
        project.archived === targetArchived ? reordered[visibleCursor++] : project
      )),
    };
  };

  const handleProjectDragOver = (event, projectName) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragInfo?.type !== 'project') return;
    const position = getDropPosition(event.clientY, event.currentTarget.getBoundingClientRect());
    setHoverScriptDrop(null);
    setHoverProjectDrop({ projectName, position });
  };

  const handleProjectDrop = async (event, projectName) => {
    event.preventDefault();
    event.stopPropagation();
    const position = getDropPosition(event.clientY, event.currentTarget.getBoundingClientRect());

    if (dragInfo?.type === 'project') {
      const { changed, projects: nextProjects } = reorderVisibleProjects(
        projects,
        dragInfo.projectName,
        projectName,
        position,
      );
      setDragInfo(null);
      setHoverProjectDrop(null);
      setHoverScriptDrop(null);
      if (!changed) return;
      setProjects(nextProjects);
      await window.electronAPI?.reorderProjects?.(nextProjects.map((project) => project.name));
      return;
    }

    const project = projects.find((item) => item.name === projectName);
    const firstScript = project?.scripts[0] || null;
    const lastScript = project?.scripts[project.scripts.length - 1] || null;
    const appendToEnd = position === 'after';
    const anchorScript = appendToEnd ? lastScript?.name || null : firstScript?.name || null;
    await handleDrop(event, projectName, anchorScript, appendToEnd, appendToEnd ? 'after' : 'before');
    setHoverProjectDrop(null);
  };

  const handleRootDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const getDroppedFolders = async (dataTransfer) => {
    const { folders } = await parseDataTransferItems(dataTransfer);
    return folders.map((folder) => folder.name);
  };

  const handleRootDragEnter = (e) => {
    getDroppedFolders(e.dataTransfer).then((folders) => {
      const dragging = folders.length > 0;
      setRootDrag(dragging);
      onRootDragStateChange?.(dragging);
    });
  };

  const handleRootDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setRootDrag(false);
      onRootDragStateChange?.(false);
    }
  };

  const handleRootDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setRootDrag(false);
    onRootDragStateChange?.(false);
    const { folders, files } = await parseDataTransferItems(e.dataTransfer);
    if (folders.length > 0) {
      if (!window.electronAPI?.importFoldersDataAsProjects) {
        toast.error('Unable to import folders');
        return;
      }
      const payload = await Promise.all(
        folders.map(async (folder) => ({
          name: folder.name,
          files: await buildImportPayload(folder.files),
        })),
      );
      const result = await window.electronAPI.importFoldersDataAsProjects(payload);
      await loadProjects();
      toast.success(buildImportToast(result, 'Projects imported'));
      return;
    }
    const projectName = 'Quick Scripts';
    if (!window.electronAPI?.importFilesToProject) {
      toast.error('Unable to import scripts');
      return;
    }
    const filePayload = await buildImportPayload(files);
    if (!filePayload.length) {
      if (files.length) toast.error('Only .docx or .pdf files can be imported');
      return;
    }
    const result = await window.electronAPI.importFilesToProject(filePayload, projectName);
    await loadProjects();
    if ((result?.importedCount || result) > 0) toast.success(buildImportToast(result));
    else toast.error('No supported files were imported');
  };

  const handleDrop = async (e, projectName, beforeScriptName = null, appendToEnd = false, dropPosition = 'before') => {
    e.persist?.();
    const dataTransfer = e.dataTransfer;
    e.preventDefault();
    e.stopPropagation();
    const external = dataTransfer.files && dataTransfer.files.length;
    if (external && !dragInfo) {
      const { folders, files } = await parseDataTransferItems(dataTransfer);
      const allFiles = [...files, ...folders.flatMap((folder) => folder.files)];
      let payload = await buildImportPayload(allFiles);
      if (!payload.length) payload = await buildImportPayload(Array.from(dataTransfer.files || []));
      if (!payload.length) {
        toast.error('Only .docx or .pdf files can be imported');
        return;
      }
      if (!window.electronAPI?.importFilesToProject) return;
      const result = await window.electronAPI.importFilesToProject(payload, projectName);
      if ((result?.importedCount || result) > 0) {
        await loadProjects();
        toast.success(buildImportToast(result));
      }
      return;
    }
    if (!dragInfo) return;
    if (dragInfo.type !== 'script') return;
    setSortBy((current) => ({
      ...current,
      [dragInfo.projectName]: '',
      [projectName]: '',
    }));
    if (dragInfo.projectName === projectName) {
      if (beforeScriptName === dragInfo.scriptName) {
        setDragInfo(null);
        setHoverScriptDrop(null);
        setHoverProjectDrop(null);
        return;
      }
      let newOrder = null;
      setProjects((prev) => prev.map((project) => {
        if (project.name !== projectName) return project;
        const scripts = [...project.scripts];
        const fromIndex = scripts.findIndex((item) => item.name === dragInfo.scriptName);
        if (fromIndex < 0) return project;
        const [moved] = scripts.splice(fromIndex, 1);
        let targetIndex = appendToEnd || !beforeScriptName ? scripts.length : scripts.findIndex((item) => item.name === beforeScriptName);
        if (targetIndex < 0) targetIndex = scripts.length;
        if (!appendToEnd && beforeScriptName && dropPosition === 'after') targetIndex += 1;
        scripts.splice(targetIndex, 0, moved);
        newOrder = scripts.map((item) => item.name);
        return { ...project, scripts };
      }));
      setDragInfo(null);
      setHoverScriptDrop(null);
      if (newOrder && window.electronAPI?.reorderScripts) await window.electronAPI.reorderScripts(projectName, newOrder);
    } else {
      const sourceProject = dragInfo.projectName;
      const scriptName = dragInfo.scriptName;
      const destScripts = projects.find((project) => project.name === projectName)?.scripts.map((item) => item.name) || [];
      const destOrder = destScripts.filter((name) => name !== scriptName);
      let targetIndex = appendToEnd || !beforeScriptName ? destOrder.length : destOrder.findIndex((name) => name === beforeScriptName);
      if (targetIndex < 0) targetIndex = destOrder.length;
      if (!appendToEnd && beforeScriptName && dropPosition === 'after') targetIndex += 1;
      destOrder.splice(targetIndex, 0, scriptName);
      setDragInfo(null);
      setHoverScriptDrop(null);
      if (!window.electronAPI?.moveScript || !window.electronAPI?.reorderScripts) return;
      const moved = await window.electronAPI.moveScript(sourceProject, projectName, scriptName, targetIndex);
      if (!moved) {
        toast.error('Failed to move script');
        await loadProjects();
        return;
      }
      await window.electronAPI.reorderScripts(projectName, destOrder);
      await loadProjects();
    }
  };

  const handleDragEnd = () => {
    setDragInfo(null);
    setHoverScriptDrop(null);
    setHoverProjectDrop(null);
  };

  const handleProjectMenu = (e, project) => {
    e.preventDefault();
    e.stopPropagation();
    setScriptMenu(null);
    setSortMenu(null);
    setProjectMenu({
      projectName: project.name,
      archived: !!project.archived,
      ...getMenuPosition(e.clientX, e.clientY, getProjectMenuItemCount(project)),
    });
  };

  const handleScriptContextMenu = (e, projectName, scriptName) => {
    e.preventDefault();
    setProjectMenu(null);
    setSortMenu(null);
    setScriptMenu({ projectName, scriptName, ...getMenuPosition(e.clientX, e.clientY, getScriptMenuItemCount()) });
  };

  const handleSortMenu = (e, projectName) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectMenu(null);
    setScriptMenu(null);
    setSortMenu({ projectName, ...getMenuPosition(e.clientX, e.clientY, 3) });
  };

  const visibleProjects = projects.filter((project) => !!project.archived === showArchived);
  const totalScripts = visibleProjects.reduce((sum, project) => sum + project.scripts.length, 0);
  const archivedProjectCount = projects.filter((project) => project.archived).length;

  return (
    <div className="file-manager" ref={fileManagerRef}>
      <div className="library-header surface-block">
        <div className="library-header-copy">
          <h2 className="header-title">Scripts and Projects</h2>
        </div>
        <div className="library-header-actions">
          <button className="surface-button surface-button-secondary" onClick={handleNewScript}>New Script</button>
          <button
            className="surface-button surface-button-primary"
            onClick={async () => {
              if (window.electronAPI?.lposGetClientNames) {
                const names = await window.electronAPI.lposGetClientNames();
                setClientNames(names || []);
              }
              setShowNewProjectModal(true);
            }}
          >New Project</button>
        </div>
        <div className="library-toolbar-row">
          <span className="library-count">{totalScripts} total script{totalScripts === 1 ? '' : 's'}</span>
          <div className="library-view-toggle" role="tablist" aria-label="Library view">
            <button className={`library-view-pill${showArchived ? '' : ' active'}`} onClick={() => setShowArchived(false)}>Library</button>
            <button className={`library-view-pill${showArchived ? ' active' : ''}`} onClick={() => setShowArchived(true)}>Archive{archivedProjectCount ? ` (${archivedProjectCount})` : ''}</button>
          </div>
        </div>
        <div className="library-search-wrap compact">
          <input type="search" className="library-search-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={showArchived ? 'Search archived scripts' : 'Search all scripts'} aria-label="Search scripts" />
        </div>
      </div>

      <div className={`file-manager-list${rootDrag ? ' drop-target' : ''}`} onDragOver={handleRootDragOver} onDragEnter={handleRootDragEnter} onDragLeave={handleRootDragLeave} onDrop={handleRootDrop}>
        {!visibleProjects.length && <div className="library-empty-state surface-block">{showArchived ? 'No archived projects yet' : 'No projects yet'}</div>}
        {visibleProjects.map((project, projectIndex) => {
          const sortMode = getProjectSortMode(project.name);
          const displayedScripts = getDisplayedScripts(project);
          const visibleScripts = displayedScripts.filter((script) => matchesSearch(script.name, searchQuery));
          const isOpen = !collapsed[project.name];
          const accent = getProjectAccent(project.name, projectIndex);
          const projectStyle = {
            '--project-accent': accent.accent,
            '--project-accent-strong': accent.strong,
            '--project-accent-quiet': accent.quiet,
            '--project-avatar-bg': accent.avatar,
          };

          return (
            <div
              className={`project-group surface-block${isOpen ? ' open' : ''}${hoverProjectDrop?.projectName === project.name ? ` drop-${hoverProjectDrop.position}` : ''}`}
              key={project.name}
              style={projectStyle}
              onDragOver={(e) => handleProjectDragOver(e, project.name)}
              onDrop={(e) => handleProjectDrop(e, project.name)}
            >
              <div
                className={`project-header${dragInfo?.type !== 'project' && hoverProjectDrop?.projectName === project.name ? ' drop-target' : ''}`}
                role="button"
                tabIndex={0}
                aria-expanded={!collapsed[project.name]}
                onKeyDown={(e) => handleProjectHeaderKeyDown(e, project.name)}
                onClick={() => toggleCollapse(project.name)}
                onContextMenu={(e) => handleProjectMenu(e, project)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleProjectDrop(e, project.name)}
                draggable={!project.archived}
                onDragStart={(e) => handleProjectDragStart(e, project.name)}
                onDragEnd={handleDragEnd}
                title="Drag to reorder projects"
              >
                {renamingProject === project.name ? (
                  <div className="rename-row">
                    <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => handleRenameKeyDown(e, () => confirmRenameProject(project.name))} autoFocus />
                    <button className="surface-button surface-button-primary" onClick={() => confirmRenameProject(project.name)}>Save</button>
                    <button className="surface-button surface-button-secondary" onClick={cancelRename}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <div className="project-title">
                      <span className="project-avatar" aria-hidden="true">{getProjectInitials(project.name)}</span>
                      <div className="project-title-copy">
                        <h4 title={project.name}>{project.name}</h4>
                        <span className="project-meta">{displayedScripts.length} script{displayedScripts.length === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    <div className="project-header-controls" onClick={(e) => e.stopPropagation()}>
                      <button className="sort-trigger" onClick={(e) => handleSortMenu(e, project.name)}>Sort by</button>
                      <button className="icon-button quiet" onClick={(e) => handleProjectMenu(e, project)} aria-label="Project Options"><DotsIcon /></button>
                    </div>
                  </>
                )}
              </div>

              <ul className={`project-script-list${collapsed[project.name] ? ' collapsed' : ''}`}>
                {!collapsed[project.name] && visibleScripts.map((script, scriptIndex) => {
                  const scriptName = script.name;
                  const isPrompting = loadedProject === project.name && loadedScript === scriptName;
                  const isLoaded = currentProject === project.name && currentScript === scriptName;
                  const isRenaming = renamingScript && renamingScript.projectName === project.name && renamingScript.scriptName === scriptName;
                  return (
                    <li
                      key={scriptName}
                      draggable
                      onDragStart={(e) => handleScriptDragStart(e, project.name, scriptName)}
                      onDragOver={(e) => handleScriptDragOver(e, project.name, scriptName)}
                      onDrop={(e) => handleDrop(e, project.name, scriptName, false, getDropPosition(e.clientY, e.currentTarget.getBoundingClientRect()))}
                      onDragEnd={handleDragEnd}
                      className={`script-item${isPrompting ? ' prompting' : ''}${isLoaded ? ' loaded' : ''}${hoverScriptDrop?.projectName === project.name && hoverScriptDrop?.scriptName === scriptName ? ` drop-${hoverScriptDrop.position}` : ''}`}
                      title="Drag to reorder scripts"
                    >
                      {isRenaming ? (
                        <div className="rename-row">
                          <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
                          <button className="surface-button surface-button-primary" onClick={() => confirmRenameScript(project.name, scriptName)}>Save</button>
                          <button className="surface-button surface-button-secondary" onClick={cancelRename}>Cancel</button>
                        </div>
                      ) : (
                        <button className="script-button minimal" onClick={() => onScriptSelect(project.name, scriptName)} onContextMenu={(e) => handleScriptContextMenu(e, project.name, scriptName)} onMouseEnter={(e) => handleScriptMouseEnter(scriptName, e)} onMouseLeave={handleScriptMouseLeave} onMouseMove={handleScriptMouseMove} title={normalizeScriptName(scriptName)}>
                          <span className="script-row-index">{String(scriptIndex + 1).padStart(2, '0')}</span>
                          <span className="script-row-copy">
                            <span className="script-button-title truncate-text">{normalizeScriptName(scriptName)}</span>
                          </span>
                          <span className="script-state-tags">
                            {isPrompting && <span className="script-state-tag live">Live</span>}
                          </span>
                        </button>
                      )}
                    </li>
                  );
                })}
                {!collapsed[project.name] && visibleScripts.length === 0 && <li className="project-empty-state">{searchQuery ? 'No scripts match' : 'No scripts yet'}</li>}
              </ul>
            </div>
          );
        })}
      </div>

      {projectMenu && (
        <div className="context-popover surface-block project-menu" style={{ top: projectMenu.y, left: projectMenu.x }} onClick={(e) => e.stopPropagation()} onKeyDown={handleMenuKeyDown}>
          {!projectMenu.archived && <button onClick={() => handleImportClick(projectMenu.projectName)}><span className="menu-check" />Import script</button>}
          <button onClick={() => handleExportProject(projectMenu.projectName, 'docx')}><span className="menu-check" />Export project (.docx)</button>
          <button onClick={() => handleExportProject(projectMenu.projectName, 'pdf')}><span className="menu-check" />Export project (.pdf)</button>
          {projectMenu.archived ? (
            <button onClick={() => handleRestoreProject(projectMenu.projectName)}><span className="menu-check" />Restore project</button>
          ) : (
            <button onClick={() => handleArchiveProject(projectMenu.projectName)}><span className="menu-check" />Archive project</button>
          )}
          <button onClick={() => startRenameProject(projectMenu.projectName)}><span className="menu-check" />Rename project</button>
        </div>
      )}

      {sortMenu && (
        <div className="context-popover surface-block sort-menu" style={{ top: sortMenu.y, left: sortMenu.x }} onClick={(e) => e.stopPropagation()} onKeyDown={handleMenuKeyDown}>
          <button className={`sort-menu-option${getProjectSortMode(sortMenu.projectName) === '' ? ' active' : ''}`} onClick={() => { setSortBy((current) => ({ ...current, [sortMenu.projectName]: '' })); setSortMenu(null); }}>Manual order</button>
          <button className={`sort-menu-option${getProjectSortMode(sortMenu.projectName) === 'name' ? ' active' : ''}`} onClick={() => { setSortBy((current) => ({ ...current, [sortMenu.projectName]: 'name' })); setSortMenu(null); }}>Name</button>
          <button className={`sort-menu-option${getProjectSortMode(sortMenu.projectName) === 'date' ? ' active' : ''}`} onClick={() => { setSortBy((current) => ({ ...current, [sortMenu.projectName]: 'date' })); setSortMenu(null); }}>Date added</button>
        </div>
      )}

      {scriptMenu && (
        <div className="context-popover surface-block script-menu" style={{ top: scriptMenu.y, left: scriptMenu.x }} onClick={(e) => e.stopPropagation()} onKeyDown={handleMenuKeyDown}>
          <button onClick={() => { onScriptSelect(scriptMenu.projectName, scriptMenu.scriptName); setScriptMenu(null); }}><span className="menu-check" />Open</button>
          <button onClick={() => startRenameScript(scriptMenu.projectName, scriptMenu.scriptName)}><span className="menu-check" />Rename</button>
          <button onClick={() => handleExportScript(scriptMenu.projectName, scriptMenu.scriptName, 'docx')}><span className="menu-check" />Export (.docx)</button>
          <button onClick={() => handleExportScript(scriptMenu.projectName, scriptMenu.scriptName, 'pdf')}><span className="menu-check" />Export (.pdf)</button>
          <button className="danger" onClick={() => handleDeleteScript(scriptMenu.projectName, scriptMenu.scriptName)}><span className="menu-check" />Delete</button>
        </div>
      )}

      {confirmState && <ConfirmModal message={confirmState.message} onConfirm={() => { const { action } = confirmState; setConfirmState(null); action(); }} onCancel={() => setConfirmState(null)} />}
      {showNewProjectModal && (
        <NewProjectModal
          clientNames={clientNames}
          onConfirm={handleNewProject}
          onCancel={() => setShowNewProjectModal(false)}
        />
      )}
      {tooltipScript && <div className="script-tooltip" style={{ top: tooltipPosition.y, left: tooltipPosition.x }}>{tooltipScript}</div>}
    </div>
  );
});

export default FileManager;



