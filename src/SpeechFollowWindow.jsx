import { useEffect, useMemo, useRef, useState } from 'react'
import './Prompter.css'
import './SpeechFollowWindow.css'

function truncateDebugText(value, maxLength = 220) {
  const text = String(value || '').trim()
  if (!text) return '--'
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

function SpeechFollowWindow() {
  const [snapshot, setSnapshot] = useState(null)
  const [connected, setConnected] = useState(false)
  const channelRef = useRef(null)

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined

    const channel = new BroadcastChannel('leaderprompt-speech-follow')
    channelRef.current = channel
    channel.onmessage = (event) => {
      const data = event.data || {}
      if (data.type === 'state') {
        setSnapshot(data.payload || null)
        setConnected(true)
      }
      if (data.type === 'prompter_closed') {
        setConnected(false)
      }
    }
    channel.postMessage({ type: 'request_state' })

    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [])

  const sendCommand = (command, payload = {}) => {
    channelRef.current?.postMessage({
      type: 'command',
      command,
      payload,
    })
  }

  const availableInputs = snapshot?.availableInputs || []
  const speechDebug = snapshot?.speechDebug || {}
  const highlightLog = snapshot?.highlightLog || []
  const selectedInputId = snapshot?.selectedInputId || ''
  const selectedInputLabel = snapshot?.selectedInputLabel || 'System Default'
  const speechOverlayRect = snapshot?.speechOverlayRect || null
  const speechMetrics = snapshot?.speechMetrics || {}
  const speechTraceMeta = snapshot?.speechTraceMeta || {}

  const matchStatus = useMemo(() => {
    const latestHighlight = highlightLog[0]
    if (latestHighlight?.outcome === 'visible_overlap_found') return 'Visible overlap live'
    if (latestHighlight?.outcome === 'visible_candidate_found') return 'Visible candidate'
    if (speechDebug.lastCandidateMatch?.candidateIndex >= 0) return 'Visible candidate'
    return 'No visible overlap yet'
  }, [highlightLog, speechDebug])

  const windowStatus = useMemo(() => {
    if (!connected) return 'Waiting for prompter'
    if (!snapshot?.speechFollow) return 'Speech follow idle'
    return snapshot?.speechFollowStatus || 'Speech follow active'
  }, [connected, snapshot])

  return (
    <div className="speech-follow-window-shell">
      <div className="speech-follow-window-header">
        <div>
          <span className="speech-follow-window-label">Advanced Speech Tools</span>
          <h1>Speech Follow Diagnostics</h1>
          <p>{windowStatus}</p>
        </div>
        <button
          type="button"
          className="toggle-btn"
          onClick={() => window.electronAPI?.closeSpeechFollowInspector?.()}
        >
          Close Advanced Tools
        </button>
      </div>

      <div className="speech-follow-window-body">
        <div className="speech-follow-window-card speech-follow-window-controls">
          <div className="speech-follow-buttons">
            <button
              type="button"
              className={`toggle-btn ${snapshot?.speechFollow ? 'active' : ''}`}
              onClick={() => sendCommand('toggle_speech_follow')}
              disabled={!connected || snapshot?.notecardMode}
            >
              {snapshot?.speechFollow ? 'Speech Follow On' : 'Speech Follow Off'}
            </button>
            <button
              type="button"
              className={`toggle-btn ${snapshot?.speechFollowMicOn ? 'active' : ''}`}
              onClick={() => sendCommand('toggle_mic')}
              disabled={!connected || !snapshot?.speechFollow}
            >
              {snapshot?.speechFollowMicOn ? 'Mic On' : 'Mic Off'}
            </button>
            <button
              type="button"
              className="toggle-btn"
              onClick={() => sendCommand('load_test_script')}
              disabled={!connected}
            >
              Load Test Script
            </button>
            <button
              type="button"
              className="toggle-btn"
              onClick={() => sendCommand('export_speech_snapshot')}
              disabled={!connected}
            >
              Export Snapshot
            </button>
            <button
              type="button"
              className="toggle-btn"
              onClick={() => sendCommand('clear_speech_trace')}
              disabled={!connected}
            >
              Clear Trace
            </button>
          </div>

          <label>
            Input Device
            <select
              value={selectedInputId}
              onChange={(event) => sendCommand('select_input', { deviceId: event.target.value })}
              disabled={!connected}
            >
              <option value="">System Default</option>
              {availableInputs.map((input) => (
                <option key={input.deviceId || input.label} value={input.deviceId}>
                  {input.label}
                </option>
              ))}
            </select>
          </label>

          <div className="speech-follow-window-status-grid">
            <div className="speech-follow-debug-card">
              <span className="speech-follow-preview-label">Input</span>
              <span className="speech-follow-debug-value">{selectedInputLabel}</span>
              <span className="speech-follow-debug-meta">
                {snapshot?.audioDetected ? 'Audio detected' : 'Listening for audio'} | Level {(snapshot?.micLevel ?? 0).toFixed(3)}
              </span>
            </div>
            <div className="speech-follow-debug-card">
              <span className="speech-follow-preview-label">Heard Words</span>
              <span className="speech-follow-debug-value">{truncateDebugText(snapshot?.heardPreview || 'No recognized words yet.', 96)}</span>
              <span className="speech-follow-debug-meta">Partial transcript</span>
            </div>
            <div className="speech-follow-debug-card">
              <span className="speech-follow-preview-label">Match</span>
              <span className="speech-follow-debug-value">{matchStatus}</span>
              <span className="speech-follow-debug-meta">
                Anchor {speechDebug.lastCandidateMatch?.candidateIndex ?? -1} | Token {speechDebug.lastCandidateMatch?.selectedHighlightToken || '--'}
              </span>
            </div>
            <div className="speech-follow-debug-card">
              <span className="speech-follow-preview-label">Pacing</span>
              <span className="speech-follow-debug-value">
                {Math.round(speechMetrics.wpm ?? 0)} WPM
              </span>
              <span className="speech-follow-debug-meta">
                Scroll {(speechMetrics.translatedScrollSpeed ?? 0).toFixed(2)} px/frame | Factor {(speechMetrics.speedFactor ?? 1).toFixed(2)}x
              </span>
            </div>
          </div>

          <div className="speech-follow-debug-pane">
            <span className="speech-follow-preview-label">Why It Is Or Isn't Highlighting</span>
            <pre>Reason: {highlightLog[0]?.reason || speechDebug.noCommitReason || 'visible_overlap_live'}
Heard: {truncateDebugText(speechDebug.lastPartialTranscript || speechDebug.lastFinalTranscript || '--', 220)}
Token: {highlightLog[0]?.token || speechDebug.lastCandidateMatch?.selectedHighlightToken || '--'}
Overlay source: {speechOverlayRect?.source || '--'}
Overlay line: {speechOverlayRect ? `${Math.round(speechOverlayRect.lineTop)}px x ${Math.round(speechOverlayRect.lineHeight)}px` : '--'}
Anchor text: {truncateDebugText(highlightLog[0]?.anchorText || speechDebug.lastMatchedAnchorText || speechDebug.lastCandidateMatch?.anchorTextSnippet || '--', 260)}</pre>
          </div>

          <div className="speech-follow-debug-pane">
            <span className="speech-follow-preview-label">Highlight Log</span>
            <pre>{highlightLog.length
              ? highlightLog.map((entry) => `[${entry.stage}] ${entry.outcome} | token=${entry.token || '--'} | anchor=${entry.anchorIndex ?? -1} | reason=${entry.reason || '--'} | source=${entry.overlaySource || '--'} | age=${entry.overlayAgeMs ?? '--'} | confidence=${entry.confidence ?? '--'} | scope=${entry.matchScope || '--'}`).join('\n')
              : 'No highlight decisions logged yet.'}</pre>
          </div>

          <div className="speech-follow-debug-pane">
            <span className="speech-follow-preview-label">Snapshot Trace</span>
            <pre>Entries: {speechTraceMeta.entries ?? 0}
Status: {speechTraceMeta.exportStatus || 'idle'}
Message: {speechTraceMeta.exportMessage || '--'}
Folder: {speechTraceMeta.snapshotDirectory || '--'}
Last export: {speechTraceMeta.lastExportAt || '--'}
Path: {speechTraceMeta.lastExportPath || '--'}

Exports include transcript events, visible candidates, match decisions, pacing, and applied scroll deltas.</pre>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SpeechFollowWindow
