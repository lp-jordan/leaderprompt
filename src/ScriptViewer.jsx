import './ScriptViewer.css';
import { useEffect, useRef, useState, useCallback } from 'react';
import TipTapEditor from './TipTapEditor.jsx';
import { toast } from 'react-hot-toast';

function ScriptViewer({
  projectName,
  scriptName,
  loadedProject,
  loadedScript,
  onPrompterOpen,
  onPrompterClose,
  onCloseViewer,
  onSend,
  onLoadedChange,
  onClose,
}) {
  const [scriptHtml, setScriptHtml] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const saveTimeout = useRef(null);
  const scriptHtmlRef = useRef(null);

useEffect(() => {
  let cancelled = false;
  if (projectName && scriptName) {
    setLoaded(false);
    window.electronAPI
      .loadScript(projectName, scriptName)
      .then((html) => {
        if (!cancelled) {
          setScriptHtml(html);
          scriptHtmlRef.current = html;
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
    setLoaded(false);
    window.electronAPI.sendUpdatedScript('');
  }
  return () => {
    cancelled = true;
  };
}, [projectName, scriptName]);

  const handleEdit = (html) => {
    setScriptHtml(html);
    scriptHtmlRef.current = html;
    if (projectName && scriptName) {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
      }
      saveTimeout.current = setTimeout(() => {
        window.electronAPI.saveScript(projectName, scriptName, html);
        saveTimeout.current = null;
      }, 300);
    }
    if (projectName === loadedProject && scriptName === loadedScript) {
      window.electronAPI.sendUpdatedScript(html);
    }
  };

  useEffect(() => {
    const cleanup = window.electronAPI.onScriptUpdated((html) => {
      if (html !== scriptHtmlRef.current) {
        setScriptHtml(html);
        scriptHtmlRef.current = html;
        if (projectName && scriptName) {
          if (saveTimeout.current) {
            clearTimeout(saveTimeout.current);
          }
          saveTimeout.current = setTimeout(() => {
            window.electronAPI.saveScript(projectName, scriptName, html);
            saveTimeout.current = null;
          }, 300);
        }
      }
    });
    return () => {
      cleanup?.();
    };
  }, [projectName, scriptName]);


  const handleSend = useCallback(() => {
    window.electronAPI.openPrompter(scriptHtml || '');
    onPrompterOpen?.(projectName, scriptName);
  }, [scriptHtml, projectName, scriptName, onPrompterOpen]);

  useEffect(() => {
    onSend?.(loaded && scriptHtml?.trim() ? () => handleSend() : null);
  }, [onSend, handleSend, loaded, scriptHtml]);

  useEffect(() => {
    const cleanup = window.electronAPI.onPrompterClosed(() => {
      onPrompterClose?.();
    });
    return () => {
      cleanup?.();
    };
  }, [onPrompterClose]);

  const handleClose = useCallback(() => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    if (projectName && scriptName && scriptHtmlRef.current) {
      window.electronAPI.saveScript(projectName, scriptName, scriptHtmlRef.current);
    }
    setScriptHtml(null);
    scriptHtmlRef.current = null;
    setLoaded(false);
    onPrompterClose?.();
    window.electronAPI.sendUpdatedScript('');
    onCloseViewer?.();
  }, [projectName, scriptName, onPrompterClose, onCloseViewer]);

  // Run cleanup only on unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => handleClose(), []);

  useEffect(() => {
    onLoadedChange?.(loaded);
  }, [loaded, onLoadedChange]);

  useEffect(() => {
    onClose?.(loaded && scriptName ? () => handleClose() : null);
  }, [onClose, handleClose, loaded, scriptName]);

  // Ensure the viewer properly cleans up when no script is selected
  const prevSelection = useRef({ projectName: null, scriptName: null });

  useEffect(() => {
    const hadSelection =
      prevSelection.current.projectName && prevSelection.current.scriptName;
    const hasSelection = projectName && scriptName;
    if (hadSelection && !hasSelection) {
      handleClose();
    }
    prevSelection.current = { projectName, scriptName };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, scriptName]);

  const showContent = loaded;

  return (
    <div className="script-viewer">
      <div className="viewer-header">
        <div className="header-left">
          <h2 className="header-title">Script Viewer</h2>
        </div>
      </div>
      {loaded && scriptName && (
        <div className="header-buttons">
          <div className="script-name">
            {scriptName.replace(/\.[^/.]+$/, '')}
          </div>
        </div>
      )}
      <div className="script-viewer-content">
        {showContent && (
          <TipTapEditor initialHtml={scriptHtml || ''} onUpdate={handleEdit} />
        )}
      </div>
    </div>
  );
}

export default ScriptViewer;
