import './ScriptViewer.css';
import { useEffect, useRef, useState, useCallback } from 'react';
import TipTapEditor from './TipTapEditor.jsx';
import { toast } from 'react-hot-toast';
import './utils/disableLinks.css';
import FindBar from './FindBar.jsx';
import './ConfirmModal.css';

const EMPTY_DRAFT_HTML = '<p></p>';

function ScriptViewer({
  projectName,
  scriptName,
  draftSession,
  loadedProject,
  loadedScript,
  onPrompterOpen,
  onPrompterClose,
  onCloseViewer,
  onSend,
  onLoadedChange,
  onClose,
  onSave,
  onDraftStateChange,
  onDraftPersisted,
  onScriptRenamed,
}) {
  const [scriptHtml, setScriptHtml] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [saveDraftDialog, setSaveDraftDialog] = useState({
    open: false,
    mode: 'existing',
    existingProjectName: '',
    newProjectName: '',
    scriptName: 'Untitled Script',
    existingProjects: [],
    saving: false,
  });
  const saveTimeout = useRef(null);
  const draftProjectInputRef = useRef(null);
  const draftScriptInputRef = useRef(null);
  const scriptHtmlRef = useRef(null);
  const onSendRef = useRef(onSend);
  const onSaveRef = useRef(onSave);
  const onCloseRef = useRef(onClose);
  const onPrompterOpenRef = useRef(onPrompterOpen);
  const onPrompterCloseRef = useRef(onPrompterClose);
  const onCloseViewerRef = useRef(onCloseViewer);
  const onDraftStateChangeRef = useRef(onDraftStateChange);
  const onDraftPersistedRef = useRef(onDraftPersisted);
  const onScriptRenamedRef = useRef(onScriptRenamed);
  const projectNameRef = useRef(projectName);
  const scriptNameRef = useRef(scriptName);
  const lastSavedHtmlRef = useRef(null);
  const draftSessionRef = useRef(draftSession);

  const isDraft = Boolean(draftSession?.id && !projectName && !scriptName);

  const scheduleSave = useCallback((html, project = projectNameRef.current, script = scriptNameRef.current) => {
    if (draftSessionRef.current?.id) return;
    if (!project || !script || html == null || html === lastSavedHtmlRef.current) return;
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
    }
    saveTimeout.current = setTimeout(() => {
      if (!window.electronAPI?.saveScript) {
        console.error('electronAPI unavailable');
        return;
      }
      window.electronAPI.saveScript(project, script, html);
      lastSavedHtmlRef.current = html;
      saveTimeout.current = null;
    }, 300);
  }, []);

  const flushSave = useCallback((project = projectNameRef.current, script = scriptNameRef.current) => {
    if (draftSessionRef.current?.id) return;
    if (!project || !script || scriptHtmlRef.current == null) return;
    if (scriptHtmlRef.current === lastSavedHtmlRef.current) return;
    if (!window.electronAPI?.saveScript) {
      console.error('electronAPI unavailable');
      return;
    }
    window.electronAPI.saveScript(project, script, scriptHtmlRef.current);
    lastSavedHtmlRef.current = scriptHtmlRef.current;
  }, []);

  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onPrompterOpenRef.current = onPrompterOpen;
  }, [onPrompterOpen]);

  useEffect(() => {
    onPrompterCloseRef.current = onPrompterClose;
  }, [onPrompterClose]);

  useEffect(() => {
    onCloseViewerRef.current = onCloseViewer;
  }, [onCloseViewer]);

  useEffect(() => {
    onDraftStateChangeRef.current = onDraftStateChange;
  }, [onDraftStateChange]);

  useEffect(() => {
    onDraftPersistedRef.current = onDraftPersisted;
  }, [onDraftPersisted]);

  useEffect(() => {
    onScriptRenamedRef.current = onScriptRenamed;
  }, [onScriptRenamed]);

  useEffect(() => {
    projectNameRef.current = projectName;
    scriptNameRef.current = scriptName;
    draftSessionRef.current = draftSession;
  }, [draftSession, projectName, scriptName]);

  useEffect(() => {
    let timeout;
    if (loaded) {
      setShowEditor(true);
    } else {
      timeout = setTimeout(() => setShowEditor(false), 200);
    }
    return () => clearTimeout(timeout);
  }, [loaded]);


  useEffect(() => {
    if (!saveDraftDialog.open) return undefined;
    const id = requestAnimationFrame(() => {
      if (saveDraftDialog.mode === 'new') {
        draftProjectInputRef.current?.focus();
      } else {
        draftProjectInputRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [saveDraftDialog.mode, saveDraftDialog.open]);
  useEffect(() => {
    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSaveRef.current?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (isDraft) {
      setLoaded(false);
      const initialHtml = EMPTY_DRAFT_HTML;
      setScriptHtml(initialHtml);
      scriptHtmlRef.current = initialHtml;
      lastSavedHtmlRef.current = null;
      onDraftStateChangeRef.current?.({ isDirty: false });
      setLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    if (projectName && scriptName) {
      setLoaded(false);
      lastSavedHtmlRef.current = null;
      if (!window.electronAPI?.loadScript) {
        console.error('electronAPI unavailable');
        toast.error('Failed to load script');
        return () => {
          cancelled = true;
        };
      }
      window.electronAPI
        .loadScript(projectName, scriptName)
        .then((html) => {
          if (!cancelled) {
            setScriptHtml(html);
            scriptHtmlRef.current = html;
            lastSavedHtmlRef.current = html;
            setLoaded(true);
          }
        })
        .catch((err) => {
          console.error('Failed to load script:', err);
          toast.error('Failed to load script');
        });
    } else {
      setScriptHtml(null);
      scriptHtmlRef.current = null;
      lastSavedHtmlRef.current = null;
      setLoaded(false);
      if (window.electronAPI?.sendUpdatedScript) {
        window.electronAPI.sendUpdatedScript('');
      }
    }

    return () => {
      cancelled = true;
    };
  }, [isDraft, projectName, scriptName]);

  const handleEdit = useCallback((html) => {
    if (html === scriptHtmlRef.current) return;
    setScriptHtml(html);
    scriptHtmlRef.current = html;

    if (draftSessionRef.current?.id) {
      onDraftStateChangeRef.current?.({ isDirty: true });
      return;
    }

    scheduleSave(html);
    if (projectNameRef.current === loadedProject && scriptNameRef.current === loadedScript) {
      if (!window.electronAPI?.sendUpdatedScript) {
        console.error('electronAPI unavailable');
        return;
      }
      window.electronAPI.sendUpdatedScript(html);
    }
  }, [loadedProject, loadedScript, scheduleSave]);

  useEffect(() => {
    if (!window.electronAPI?.onScriptUpdated) {
      console.error('electronAPI unavailable');
      return;
    }
    const cleanup = window.electronAPI.onScriptUpdated((html) => {
      if (draftSessionRef.current?.id) return;
      if (html === scriptHtmlRef.current) return;
      setScriptHtml(html);
      scriptHtmlRef.current = html;
      scheduleSave(html);
    });
    return () => {
      cleanup?.();
    };
  }, [scheduleSave]);

  const handleSend = useCallback(() => {
    if (draftSessionRef.current?.id) return;
    if (!window.electronAPI?.openPrompter) {
      console.error('electronAPI unavailable');
      return;
    }
    window.electronAPI.openPrompter(scriptHtmlRef.current || '', projectNameRef.current);
    onPrompterOpenRef.current?.(projectNameRef.current, scriptNameRef.current);
  }, []);

  const openDraftSaveDialog = useCallback(async () => {
    if (!draftSessionRef.current?.id) {
      flushSave();
      return;
    }

    const existingProjects = await window.electronAPI?.getAllProjectsWithScripts?.() || [];
    setSaveDraftDialog({
      open: true,
      mode: existingProjects.length ? 'existing' : 'new',
      existingProjectName: existingProjects[0]?.name || '',
      newProjectName: '',
      scriptName: draftSessionRef.current.title || 'Untitled Script',
      existingProjects,
      saving: false,
    });
  }, [flushSave]);

  const closeDraftSaveDialog = useCallback(() => {
    setSaveDraftDialog((current) => ({ ...current, open: false, saving: false }));
  }, []);

  const confirmDraftSave = useCallback(async () => {
    const destinationProject = (saveDraftDialog.mode === 'new'
      ? saveDraftDialog.newProjectName
      : saveDraftDialog.existingProjectName).trim();
    const desiredScriptName = saveDraftDialog.scriptName.trim();
    if (!destinationProject || !desiredScriptName) {
      toast.error('Choose a project and script name');
      return;
    }

    setSaveDraftDialog((current) => ({ ...current, saving: true }));

    try {
      if (!saveDraftDialog.existingProjects.some((project) => project.name === destinationProject)) {
        const createdProject = await window.electronAPI?.createNewProject?.(destinationProject);
        if (!createdProject) {
          toast.error('Failed to create project');
          setSaveDraftDialog((current) => ({ ...current, saving: false }));
          return;
        }
      }

      const createdScript = await window.electronAPI?.createNewScript?.(destinationProject, desiredScriptName);
      if (!createdScript?.success) {
        toast.error('Failed to create script');
        setSaveDraftDialog((current) => ({ ...current, saving: false }));
        return;
      }

      await window.electronAPI?.saveScript?.(
        destinationProject,
        createdScript.scriptName,
        scriptHtmlRef.current || EMPTY_DRAFT_HTML,
      );
      lastSavedHtmlRef.current = scriptHtmlRef.current || EMPTY_DRAFT_HTML;
      onDraftStateChangeRef.current?.({ isDirty: false });
      setSaveDraftDialog((current) => ({ ...current, open: false, saving: false }));
      await onDraftPersistedRef.current?.(destinationProject, createdScript.scriptName);
      toast.success('Draft saved');
    } catch (error) {
      console.error('Failed to save draft:', error);
      toast.error('Failed to save draft');
      setSaveDraftDialog((current) => ({ ...current, saving: false }));
    }
  }, [saveDraftDialog]);


  const handleSaveDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDraftSaveDialog();
    }
    if (event.key === 'Enter' && !saveDraftDialog.saving) {
      event.preventDefault();
      confirmDraftSave();
    }
  };

  const handleDiscardDraft = useCallback(() => {
    setScriptHtml(null);
    scriptHtmlRef.current = null;
    setLoaded(false);
    onDraftStateChangeRef.current?.({ isDirty: false });
    if (window.electronAPI?.sendUpdatedScript) {
      window.electronAPI.sendUpdatedScript('');
    }
    onCloseViewerRef.current?.();
  }, []);

  useEffect(() => {
    onSendRef.current?.(!draftSession?.id && loaded && scriptHtml?.trim() ? handleSend : null);
  }, [draftSession?.id, handleSend, loaded, scriptHtml]);

  useEffect(() => {
    onSaveRef.current?.(draftSession?.id && loaded ? openDraftSaveDialog : null);
  }, [draftSession?.id, loaded, openDraftSaveDialog]);

  useEffect(() => {
    if (!window.electronAPI?.onPrompterClosed) {
      console.error('electronAPI unavailable');
      return;
    }
    const cleanup = window.electronAPI.onPrompterClosed(() => {
      onPrompterCloseRef.current?.();
    });
    return () => {
      cleanup?.();
    };
  }, []);

  const handleClose = useCallback(() => {
    if (draftSessionRef.current?.id) {
      handleDiscardDraft();
      return;
    }

    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }

    flushSave();
    setScriptHtml(null);
    scriptHtmlRef.current = null;
    setLoaded(false);
    onPrompterCloseRef.current?.();
    if (window.electronAPI?.sendUpdatedScript) {
      window.electronAPI.sendUpdatedScript('');
    }
    onCloseViewerRef.current?.();
  }, [flushSave, handleDiscardDraft]);

  useEffect(() => () => handleClose(), [handleClose]);

  useEffect(() => {
    onLoadedChange?.(loaded);
  }, [loaded, onLoadedChange]);

  useEffect(() => {
    onCloseRef.current?.(loaded ? (draftSession?.id ? handleDiscardDraft : handleClose) : null);
  }, [draftSession?.id, handleClose, handleDiscardDraft, loaded]);

  const activeScriptName = isDraft ? draftSession?.title || 'Untitled Draft' : scriptName?.replace(/\.[^/.]+$/, '');
  const viewerClass = `script-viewer-content disable-links${loaded ? ' visible' : ''}`;

  useEffect(() => {
    setTitleInput(activeScriptName || '');
    setIsRenamingTitle(false);
  }, [activeScriptName]);

  const commitTitleRename = useCallback(async () => {
    const nextTitle = titleInput.trim();
    if (!nextTitle) {
      toast.error('Script title cannot be empty');
      return;
    }

    if (isDraft) {
      onDraftStateChangeRef.current?.({ title: nextTitle });
      setIsRenamingTitle(false);
      return;
    }

    const currentProject = projectNameRef.current;
    const currentScript = scriptNameRef.current;
    if (!currentProject || !currentScript) {
      setIsRenamingTitle(false);
      return;
    }

    let nextScriptName = nextTitle;
    if (!nextScriptName.toLowerCase().endsWith('.docx')) nextScriptName += '.docx';
    if (nextScriptName === currentScript) {
      setIsRenamingTitle(false);
      return;
    }

    flushSave();
    const success = await window.electronAPI?.renameScript?.(currentProject, currentScript, nextScriptName);
    if (!success) {
      toast.error('Failed to rename script');
      return;
    }

    setIsRenamingTitle(false);
    await onScriptRenamedRef.current?.(currentProject, currentScript, nextScriptName);
    toast.success('Script renamed');
  }, [flushSave, isDraft, titleInput]);

  const handleTitleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTitleRename();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setTitleInput(activeScriptName || '');
      setIsRenamingTitle(false);
    }
  };

  return (
    <div className="script-viewer">
      {findOpen && <FindBar onClose={() => setFindOpen(false)} />}
      {saveDraftDialog.open ? (
        <div className="confirm-modal-overlay visible" onKeyDown={handleSaveDialogKeyDown}>
          <div className="confirm-modal visible script-save-dialog" role="dialog" aria-modal="true" aria-label="Save draft dialog">
            <span className="panel-kicker">Save Draft</span>
            <p>Choose where this draft should live before autosave takes over.</p>
            <div className="script-save-mode-grid">
              <button
                type="button"
                className={`script-save-mode${saveDraftDialog.mode === 'existing' ? ' active' : ''}`}
                onClick={() => setSaveDraftDialog((current) => ({ ...current, mode: 'existing' }))}
                disabled={!saveDraftDialog.existingProjects.length}
              >
                Existing Project
              </button>
              <button
                type="button"
                className={`script-save-mode${saveDraftDialog.mode === 'new' ? ' active' : ''}`}
                onClick={() => setSaveDraftDialog((current) => ({ ...current, mode: 'new' }))}
              >
                New Project
              </button>
            </div>
            {saveDraftDialog.mode === 'existing' ? (
              <label className="script-save-field">
                <span>Existing project</span>
                <select
                  ref={draftProjectInputRef}
                  value={saveDraftDialog.existingProjectName}
                  onChange={(event) => setSaveDraftDialog((current) => ({ ...current, existingProjectName: event.target.value }))}
                >
                  {saveDraftDialog.existingProjects.map((project) => (
                    <option key={project.name} value={project.name}>{project.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="script-save-field">
                <span>New project name</span>
                <input
                  ref={draftProjectInputRef}
                  type="text"
                  value={saveDraftDialog.newProjectName}
                  onChange={(event) => setSaveDraftDialog((current) => ({ ...current, newProjectName: event.target.value }))}
                  placeholder="Create a new project"
                />
              </label>
            )}
<label className="script-save-field">
              <span>Script name</span>
              <input
                ref={draftScriptInputRef}
                type="text"
                value={saveDraftDialog.scriptName}
                onChange={(event) => setSaveDraftDialog((current) => ({ ...current, scriptName: event.target.value }))}
                placeholder="Untitled Script"
              />
            </label>
            <div className="confirm-buttons">
              <button onClick={closeDraftSaveDialog} disabled={saveDraftDialog.saving}>Cancel</button>
              <button className="surface-button surface-button-primary" onClick={confirmDraftSave} disabled={saveDraftDialog.saving}>
                {saveDraftDialog.saving ? 'Saving...' : 'Save Draft'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="viewer-topbar surface-block">
        <div className="viewer-topbar-copy">
          <span className="panel-kicker">Active Workspace</span>
          <h1 className="viewer-title">Script Viewer</h1>
        </div>
        {loaded && activeScriptName && (
          <div className="viewer-script-summary">
            <span className="panel-kicker">{isDraft ? 'Draft' : 'Loaded Script'}</span>
            {isRenamingTitle ? (
              <input
                className="script-title-input"
                type="text"
                value={titleInput}
                onChange={(event) => setTitleInput(event.target.value)}
                onBlur={commitTitleRename}
                onKeyDown={handleTitleKeyDown}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className="script-name script-name-button"
                title="Click to rename"
                onClick={() => setIsRenamingTitle(true)}
              >
                {activeScriptName}
              </button>
            )}
            <span className="viewer-status">{isDraft ? 'Manual save required before autosave begins' : 'Ready for edits and prompting'}</span>
          </div>
        )}
      </div>
      <div className={viewerClass}>
        {showEditor && <TipTapEditor initialHtml={scriptHtml || ''} onUpdate={handleEdit} />}
      </div>
    </div>
  );
}

export default ScriptViewer;
