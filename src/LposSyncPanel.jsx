import { useState, useEffect, useCallback } from 'react';
import './LposSyncPanel.css';

export default function LposSyncPanel({ onClose }) {
  const [serverUrl, setServerUrl] = useState('');
  const [apiToken,  setApiToken]  = useState('');
  const [status,    setStatus]    = useState(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [syncing,       setSyncing]       = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [remoteError,   setRemoteError]   = useState('');

  // Load existing config + current status on mount
  useEffect(() => {
    async function init() {
      const cfg = await window.electronAPI.lposGetConfig();
      setServerUrl(cfg.serverUrl || '');
      setApiToken(cfg.apiToken || '');
      const st = await window.electronAPI.lposGetStatus();
      setStatus(st);
    }
    void init();
    const unsub = window.electronAPI.onLposSyncUpdate((st) => setStatus(st));
    return unsub;
  }, []);

  const fetchRemoteProjects = useCallback(async (url) => {
    const target = (url || serverUrl).trim();
    if (!target) return;
    setLoadingRemote(true);
    setRemoteError('');
    const result = await window.electronAPI.lposGetRemoteProjects(target);
    setLoadingRemote(false);
    if (result?.error) { setRemoteError(result.error); return; }
    setRemoteProjects(result?.projects || []);
  }, [serverUrl]);

  async function handleSave() {
    const cfg = { serverUrl: serverUrl.trim(), apiToken: apiToken.trim() };
    await window.electronAPI.lposSaveConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSyncNow() {
    setSyncing(true);
    const st = await window.electronAPI.lposSyncNow();
    setStatus(st);
    setSyncing(false);
  }

  const statusDot = !status || status.status === 'idle' ? 'idle'
    : status.status === 'error' ? 'error' : 'ok';

  return (
    <div className="lpos-panel-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lpos-panel">
        <div className="lpos-panel-header">
          <span className="lpos-panel-title">LPOS Sync</span>
          <button className="lpos-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="lpos-panel-body">
          {/* Status bar */}
          <div className="lpos-status-row">
            <span className={`lpos-dot lpos-dot--${statusDot}`} />
            <span className="lpos-status-text">
              {statusDot === 'idle'  && 'Not yet synced'}
              {statusDot === 'ok'    && `Last sync: ${status?.lastSync ? new Date(status.lastSync).toLocaleTimeString() : '—'}`}
              {statusDot === 'error' && (status?.error || 'Sync error')}
            </span>
            <button
              className="lpos-btn lpos-btn--sm"
              onClick={handleSyncNow}
              disabled={syncing || !serverUrl.trim()}
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>

          {/* Server URL */}
          <label className="lpos-field-label">LPOS Server URL</label>
          <div className="lpos-url-row">
            <input
              className="lpos-input"
              type="text"
              placeholder="http://192.168.x.x:3000"
              value={serverUrl}
              onChange={(e) => { setServerUrl(e.target.value); setRemoteError(''); }}
              onBlur={() => { if (serverUrl.trim()) void fetchRemoteProjects(serverUrl); }}
            />
            <button
              className="lpos-btn lpos-btn--sm"
              onClick={() => void fetchRemoteProjects(serverUrl)}
              disabled={loadingRemote || !serverUrl.trim()}
            >
              {loadingRemote ? '…' : 'Connect'}
            </button>
          </div>
          {remoteError && <p className="lpos-error">{remoteError}</p>}

          <label className="lpos-field-label" style={{ marginTop: 14 }}>API Token</label>
          <input
            className="lpos-input"
            type="password"
            placeholder="Paste LPOS_LP_TOKEN value"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
          />
          <p className="lpos-hint">Set <code>LPOS_LP_TOKEN</code> in your LPOS <code>.env</code>, then paste the same value here.</p>

          <p className="lpos-hint" style={{ marginTop: 12 }}>
            Once connected, LeaderPrompt will automatically mirror all LPOS projects and sync scripts in both directions.
          </p>
        </div>

        <div className="lpos-panel-footer">
          <button className="lpos-btn lpos-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="lpos-btn lpos-btn--primary" onClick={handleSave}>
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
