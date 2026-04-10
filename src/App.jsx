import './App.css';
import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import FileManager from './FileManager';
import ScriptViewer from './ScriptViewer';
import LposSyncPanel from './LposSyncPanel';
import leaderLogo from './assets/LeaderPass-Logo-white.png';
import { parseDataTransferItems, buildImportPayload } from './utils/dragHelpers.js';

const FILE_MANAGER_BREAKPOINT = 1000;

function buildImportToast(result, fallback) {
  if (!result || typeof result === 'number') return fallback;
  const importedCount = result.importedCount || 0;
  const renamedCount = result.renamedCount || 0;
  if (renamedCount > 0) {
    return `${importedCount} script${importedCount === 1 ? '' : 's'} imported (${renamedCount} renamed)`;
  }
  return `${importedCount} script${importedCount === 1 ? '' : 's'} imported`;
}

function App() {
  const [selectedScript, setSelectedScript] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loadedScript, setLoadedScript] = useState(null);
  const [loadedProject, setLoadedProject] = useState(null);
  const fileManagerRef = useRef(null);
  const [sendCallback, setSendCallback] = useState(null);
  const [saveCallback, setSaveCallback] = useState(null);
  const [closeCallback, setCloseCallback] = useState(null);
  const [draftSession, setDraftSession] = useState(null);
  const [viewerLoaded, setViewerLoaded] = useState(false);
  const [showFileManager, setShowFileManager] = useState(() => window.innerWidth >= FILE_MANAGER_BREAKPOINT);
  const [leftDrag, setLeftDrag] = useState(false);
  const [showLposPanel, setShowLposPanel] = useState(false);
  const [lposSyncStatus, setLposSyncStatus] = useState('idle');
  const [lposConnected, setLposConnected] = useState(null); // null = unknown yet
  const [lpUpdate, setLpUpdate] = useState(null); // { version, downloadPageUrl }

  useEffect(() => {
    const handleResize = () => {
      setShowFileManager(window.innerWidth >= FILE_MANAGER_BREAKPOINT);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onLposSyncUpdate) return;
    const unsubStatus = window.electronAPI.onLposSyncUpdate((st) => {
      setLposSyncStatus(st?.status ?? 'idle');
    });
    const unsubConn = window.electronAPI.onLposConnectionChanged?.((data) => {
      setLposConnected(data?.connected ?? false);
    });
    const unsubScripts = window.electronAPI.onLposScriptsUpdated?.((data) => {
      toast.success(`Scripts updated from LPOS${data?.projectName ? ` — ${data.projectName}` : ''}`);
      if (fileManagerRef.current?.reload) void fileManagerRef.current.reload();
    });
    const unsubProjects = window.electronAPI.onLposProjectsUpdated?.(() => {
      if (fileManagerRef.current?.reload) void fileManagerRef.current.reload();
    });
    const unsubUpdate = window.electronAPI.onLpUpdateAvailable?.((data) => {
      setLpUpdate(data);
    });
    return () => { unsubStatus?.(); unsubScripts?.(); unsubConn?.(); unsubProjects?.(); unsubUpdate?.(); };
  }, []);

  const handleScriptSelect = (projectName, scriptName) => {
    if (draftSession?.id) {
      toast.error('Save or discard the current draft first');
      return;
    }
    setSelectedProject(projectName);
    setSelectedScript(scriptName);
  };

  const handlePrompterOpen = useCallback((projectName, scriptName) => {
    setLoadedProject(projectName);
    setLoadedScript(scriptName);
  }, []);

  const handlePrompterClose = useCallback(() => {
    setLoadedProject(null);
    setLoadedScript(null);
  }, []);

  const handleViewerClose = useCallback(() => {
    setSelectedProject(null);
    setSelectedScript(null);
    setDraftSession(null);
  }, []);

  const updateCloseCallback = useCallback((cb) => {
    setCloseCallback(() => cb);
  }, []);

  const updateSaveCallback = useCallback((cb) => {
    setSaveCallback(() => cb);
  }, []);

  const updateSendCallback = useCallback((cb) => {
    setSendCallback(() => cb);
  }, []);

  const handleCreateDraft = useCallback(() => {
    if (draftSession?.id) {
      toast.error('Save or discard the current draft first');
      return;
    }
    setSelectedProject(null);
    setSelectedScript(null);
    setDraftSession({
      id: String(Date.now()),
      title: 'Untitled Draft',
      isDirty: false,
    });
  }, [draftSession]);

  const handleDraftStateChange = useCallback((updates) => {
    setDraftSession((current) => (current ? { ...current, ...updates } : current));
  }, []);

  const handleDraftPersisted = useCallback(async (projectName, scriptName) => {
    setDraftSession(null);
    if (fileManagerRef.current?.reload) await fileManagerRef.current.reload();
    setSelectedProject(projectName);
    setSelectedScript(scriptName);
  }, []);

  const handleScriptRenamed = useCallback(async (projectName, oldScriptName, newScriptName) => {
    if (fileManagerRef.current?.reload) await fileManagerRef.current.reload();
    if (selectedProject === projectName && selectedScript === oldScriptName) {
      setSelectedScript(newScriptName);
    }
    if (loadedProject === projectName && loadedScript === oldScriptName) {
      setLoadedScript(newScriptName);
    }
  }, [loadedProject, loadedScript, selectedProject, selectedScript]);

  const handleLeftDragOver = (e) => {
    e.preventDefault();
  };

  const handleLeftDragEnter = (e) => {
    if (e.target.closest?.('.file-manager')) return;
    if (e.dataTransfer?.types?.includes('Files')) setLeftDrag(true);
    parseDataTransferItems(e.dataTransfer)
      .then(({ folders }) => {
        if (folders.length > 0 || e.dataTransfer.files?.length) {
          setLeftDrag(true);
        } else {
          setLeftDrag(false);
        }
      })
      .catch((err) => {
        console.error('Error parsing drag items', err);
        if (e.dataTransfer.files?.length) {
          setLeftDrag(true);
        } else {
          setLeftDrag(false);
        }
      });
  };

  const handleLeftDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setLeftDrag(false);
  };

  const handleLeftDrop = async (e) => {
    e.preventDefault();
    if (e.target.closest?.('.file-manager')) return;
    setLeftDrag(false);
    const { folders, files } = await parseDataTransferItems(e.dataTransfer);
    if (folders.length) {
      if (!window.electronAPI?.importFoldersDataAsProjects) {
        console.error('electronAPI unavailable');
        return;
      }
      const payload = await Promise.all(
        folders.map(async (f) => ({
          name: f.name,
          files: await buildImportPayload(f.files),
        })),
      );
      const result = await window.electronAPI.importFoldersDataAsProjects(payload);
      if (fileManagerRef.current?.reload) await fileManagerRef.current.reload();
      toast.success(buildImportToast(result, 'Projects imported'));
    } else {
      const payload = await buildImportPayload(files);
      if (payload.length) {
        const projectName = 'Quick Scripts';
        if (!window.electronAPI?.importFilesToProject) {
          console.error('electronAPI unavailable');
          toast.error('Unable to import scripts');
          return;
        }
        const result = await window.electronAPI.importFilesToProject(payload, projectName);
        if (fileManagerRef.current?.reload) await fileManagerRef.current.reload();
        toast.success(buildImportToast(result, 'Scripts imported'));
      } else if (files.length) {
        toast.error('Only .docx or .pdf files can be imported');
      }
    }
  };

  const actionStatus = draftSession?.id
    ? 'Unsaved draft'
    : sendCallback
      ? 'Ready to prompt'
      : closeCallback
        ? 'Script loaded'
        : 'Select or create a script';

  return (
    <div className="main-layout">
      <div className="page-glow page-glow-left" aria-hidden="true" />
      <div className="page-glow page-glow-right" aria-hidden="true" />
      {lposConnected === false && (
        <div className="lpos-offline-banner" role="status">
          <span className="lpos-offline-dot" />
          LPOS unreachable — showing cached projects
          <button className="lpos-offline-cfg" onClick={() => setShowLposPanel(true)}>Configure</button>
        </div>
      )}
      {lpUpdate?.version && (
        <div className="lpos-offline-banner lp-update-banner" role="status">
          <span className="lpos-offline-dot lp-update-dot" />
          LeaderPrompt {lpUpdate.version} is available
          {lpUpdate.downloadPageUrl && (
            <button
              className="lpos-offline-cfg"
              onClick={() => window.electronAPI?.openLpDownloadPage?.(lpUpdate.downloadPageUrl)}
            >
              Download
            </button>
          )}
          <button className="lpos-offline-cfg" onClick={() => setLpUpdate(null)}>Dismiss</button>
        </div>
      )}
      <div
        className={`left-panel surface-panel surface-panel-secondary ${showFileManager ? '' : 'collapsed'}${leftDrag ? ' drop-target' : ''}`}
        onDragOver={handleLeftDragOver}
        onDragEnter={handleLeftDragEnter}
        onDragLeave={handleLeftDragLeave}
        onDrop={handleLeftDrop}
      >
        {showFileManager && (
          <FileManager
            ref={fileManagerRef}
            onScriptSelect={handleScriptSelect}
            loadedProject={loadedProject}
            loadedScript={loadedScript}
            currentProject={selectedProject}
            currentScript={selectedScript}
            onRootDragStateChange={setLeftDrag}
            onCreateDraft={handleCreateDraft}
          />
        )}
      </div>

      <div className="right-panel">
        <div className="workspace-shell surface-panel surface-panel-primary">
          {!viewerLoaded && (
            <div className="load-placeholder surface-block">
              <span className="panel-kicker">Ready State</span>
              <strong>Welcome to LeaderPrompt.</strong>
              <span>Load a script, create a new one, or drag in `.docx` files to begin.</span>
            </div>
          )}

          <ScriptViewer
            projectName={selectedProject}
            scriptName={selectedScript}
            loadedProject={loadedProject}
            loadedScript={loadedScript}
            onPrompterOpen={handlePrompterOpen}
            onPrompterClose={handlePrompterClose}
            onCloseViewer={handleViewerClose}
            draftSession={draftSession}
            onDraftStateChange={handleDraftStateChange}
            onDraftPersisted={handleDraftPersisted}
            onScriptRenamed={handleScriptRenamed}
            onLoadedChange={setViewerLoaded}
            onClose={updateCloseCallback}
            onSave={updateSaveCallback}
            onSend={updateSendCallback}
          />

          <div className="workspace-logo-corner">
            <img src={leaderLogo} alt="LeaderPrompt Logo" className="main-logo" aria-hidden="true" />
            <button
              className={`lpos-sync-btn lpos-sync-btn--${lposSyncStatus}`}
              onClick={() => setShowLposPanel(true)}
              title="LPOS Sync Settings"
              aria-label="LPOS Sync Settings"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
              <span>LPOS</span>
            </button>
          </div>

          {showLposPanel && <LposSyncPanel onClose={() => setShowLposPanel(false)} />}
        </div>

        {(closeCallback || saveCallback || sendCallback) && (
          <div className="send-button-container surface-panel surface-status-strip">
            <div className="action-status-group">
              <span className="panel-kicker">Session Status</span>
              <span className={`status-pill ${sendCallback ? 'status-pill-active' : 'status-pill-idle'}`}>
                {actionStatus}
              </span>
            </div>
            <div className="action-button-group">
              {closeCallback && (
                <button
                  className="send-button send-button-secondary"
                  onClick={() => closeCallback && closeCallback()}
                >
                  {draftSession?.id ? 'Discard' : 'Close'}
                </button>
              )}
              {saveCallback && (
                <button
                  className="send-button send-button-primary"
                  onClick={() => saveCallback && saveCallback()}
                  disabled={!saveCallback}
                >
                  {draftSession?.id ? 'Save Draft' : 'Save'}
                </button>
              )}
              {!draftSession?.id && sendCallback && (
                <button
                  className="send-button send-button-primary"
                  onClick={() => sendCallback && sendCallback()}
                  disabled={!sendCallback}
                >
                  Let&apos;s Go!
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

