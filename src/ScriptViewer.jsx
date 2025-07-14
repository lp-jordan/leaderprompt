import { useEffect, useRef, useCallback, useState } from 'react';
import './ScriptViewer.css';

function ScriptViewer({ projectName, scriptName, onCloseViewer, onPrompterClose }) {
  const contentRef = useRef(null);
  const saveTimeout = useRef(null);
  const prevSelection = useRef({ projectName: null, scriptName: null });
  const [scriptHtml, setScriptHtml] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const showLogo = !loaded;

  const handleInput = () => {
    if (contentRef.current) {
      const html = contentRef.current.innerHTML;
      setScriptHtml(html);
      window.electronAPI.sendUpdatedScript(html);
    }
  };

  const handleBlur = () => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    if (projectName && scriptName && scriptHtml) {
      saveTimeout.current = setTimeout(() => {
        window.electronAPI.saveScript(projectName, scriptName, scriptHtml);
      }, 500);
    }
  };

  const handleClose = useCallback(() => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    if (projectName && scriptName && scriptHtml) {
      window.electronAPI.saveScript(projectName, scriptName, scriptHtml);
    }
    setScriptHtml(null);
    setLoaded(false);
    window.electronAPI.sendUpdatedScript('');
    onPrompterClose?.();
    onCloseViewer?.();
  }, [projectName, scriptName, scriptHtml, onPrompterClose, onCloseViewer]);

  // Clear script if selection becomes null
  useEffect(() => {
    const hadSelection = prevSelection.current.projectName && prevSelection.current.scriptName;
    const hasSelection = projectName && scriptName;
    if (hadSelection && !hasSelection) {
      handleClose();
    }
    prevSelection.current = { projectName, scriptName };
  }, [projectName, scriptName]);

  // Load new script
  useEffect(() => {
    let cancelled = false;
    if (projectName && scriptName) {
      setLoaded(false);
      window.electronAPI
        .loadScript(projectName, scriptName)
        .then((html) => {
          if (!cancelled) {
            setScriptHtml(html);
            setLoaded(true);
          }
        })
        .catch((err) => {
          console.error('Failed to load script:', err);
        });
    } else {
      setScriptHtml(null);
      setLoaded(false);
      window.electronAPI.sendUpdatedScript('');
    }

    return () => {
      cancelled = true;
    };
  }, [projectName, scriptName]);

  // Keep DOM content in sync
  useEffect(() => {
    if (contentRef.current) {
      if (scriptHtml !== null && contentRef.current.innerHTML !== scriptHtml) {
        contentRef.current.innerHTML = scriptHtml;
      } else if (scriptHtml === null) {
        contentRef.current.innerHTML = '';
      }
    }
  }, [scriptHtml]);

  // Additional: always clear residual DOM content when showing logo
  useEffect(() => {
    if (showLogo && contentRef.current) {
      contentRef.current.innerHTML = '';
    }
  }, [showLogo]);

  return (
    <div className="script-viewer-content">
      {showLogo ? (
        <div className="load-placeholder">
          Welcome to LeaderPrompt. Please load or create a script.
        </div>
      ) : (
        <div
          ref={contentRef}
          className="script-content"
          contentEditable
          onBlur={handleBlur}
          onInput={handleInput}
        />
      )}
    </div>
  );
}

export default ScriptViewer;
