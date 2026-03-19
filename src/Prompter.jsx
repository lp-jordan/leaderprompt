import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { toast } from 'react-hot-toast'
import TipTapEditor from './TipTapEditor.jsx'
import './Prompter.css'
import './utils/disableLinks.css'
import FindBar from './FindBar.jsx'
import useProjectSettings from './hooks/useProjectSettings.js'
import {
  createNotecardCacheKey,
  generateNotecardSlides,
} from './utils/notecardSlides.js'
import {
  createLocalSpeechRecognizer,
  getAvailableAudioInputs,
} from './utils/localSpeechRecognizer.js'
import {
  buildAlignmentAnchorsFromNodes,
  buildRollingTranscript,
  findNearestAnchorIndex,
  tokenizeText,
} from './utils/speechAlignment.js'
import {
  computeRollingWordsPerMinute,
  countIncrementalTranscriptWords,
  mapWpmToSpeedFactor,
  trimSpeechPaceSamples,
} from './utils/speechPacing.js'
import { measureTokenLineOverlay } from './utils/speechOverlay.js'

const MARGIN_MIN = 0
const MARGIN_MAX = 600
const DEFAULT_MARGIN = (MARGIN_MAX - MARGIN_MIN) * 0.4
const SPEED_MIN = 0.25
const SPEED_MAX = 10
const DEFAULT_SPEECH_EYELINE_RATIO = 0.38
const SPEECH_EYELINE_MIN = 0.15
const SPEECH_EYELINE_MAX = 0.85
const SPEECH_SCROLL_CONFIG = {
  baselineMin: 0,
  idleCrawlSpeed: 0.04,
  idleGraceMs: 650,
  idleDecayMs: 1600,
  wpmWindowMs: 3600,
  referenceWpm: 145,
  minSpeedFactor: 0.85,
  maxSpeedFactor: 2.15,
  speedCurve: 0.8,
}
const SPEECH_MIN_VISIBLE_MATCH_CONFIDENCE = 0.18
const SPEECH_OVERLAY_LAST_GOOD_TTL_MS = 900
const SPEECH_TRACE_LIMIT = 400

const SPEECH_TEST_SCRIPT_HTML = `
  <p>Welcome to the LeaderPrompt speech follow test.</p>
  <p>Today we are checking whether the transcript stays aligned with the script.</p>
  <p>The goal is to keep the currently spoken word near the center of the screen.</p>
  <p>If the system is working well, the prompt should speed up when I move ahead.</p>
  <p>It should slow down when I pause or repeat a sentence.</p>
  <p>Now I will start this sentence over.</p>
  <p>Now I will start this sentence over.</p>
  <p>Then I will continue into the next paragraph without stopping.</p>
  <p>This second paragraph gives us a few repeated words to test matching.</p>
  <p>We save the script, we send the script, and we review the script again.</p>
  <p>The recognizer should not jump wildly when the same word shows up more than once.</p>
  <p>If I skip ahead to the next line, the controller should catch up smoothly.</p>
  <p>This final paragraph is for restart behavior.</p>
  <p>Sometimes a speaker begins a thought, stops, and starts the sentence over.</p>
  <p>Sometimes a speaker begins a thought, stops, and starts the sentence over.</p>
  <p>After that restart, the prompter should recover and keep moving forward.</p>
`

const SPEECH_TEST_CHECKPOINTS = [
  { label: 'Steady read', success: 'Anchor advances and speed stays near baseline.' },
  { label: 'Pause mid-sentence', success: 'Transcript stalls and speed slows or holds.' },
  { label: 'Repeat sentence', success: 'Match stays local and does not jump wildly.' },
  { label: 'Restart sentence', success: 'Rewind only happens after stable evidence.' },
  { label: 'Skip ahead', success: 'Anchor re-matches and speed increases to catch up.' },
]

const DEFAULT_SETTINGS = {
  autoscroll: false,
  speed: 1,
  margin: DEFAULT_MARGIN,
  fontSize: 2,
  mirrorX: false,
  mirrorY: false,
  shadowStrength: 8,
  strokeWidth: 0,
  lineHeight: 1.6,
  textAlign: 'left',
  notecardMode: false,
  transparentMode: false,
  speechFollow: false,
  speechEyelineRatio: DEFAULT_SPEECH_EYELINE_RATIO,
}

function collectAnchorNodes(root) {
  if (!root) return []
  const nodes = Array.from(
    root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre'),
  ).filter((node) => node.textContent?.trim())
  return nodes.length ? nodes : [root]
}

function buildLineAnchorsFromRoot(root) {
  if (!root) return []

  const text = root.innerText || root.textContent || ''
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length <= 1) return []

  const styles = window.getComputedStyle(root)
  const lineHeightValue = parseFloat(styles.lineHeight)
  const fontSizeValue = parseFloat(styles.fontSize) || 16
  const lineHeightPx = Number.isFinite(lineHeightValue) ? lineHeightValue : fontSizeValue * 1.4

  return lines.map((line, index) => ({
    index,
    text: line,
    normalizedText: normalizeText(line),
    tokens: tokenizeText(line),
    element: {
      offsetTop: index * lineHeightPx,
      offsetHeight: lineHeightPx,
    },
    synthetic: true,
  }))
}

function buildSpeechAnchors(root) {
  if (!root) return []

  const nodes = collectAnchorNodes(root)
  if (nodes.length === 1 && nodes[0] === root) {
    const lineAnchors = buildLineAnchorsFromRoot(root)
    if (lineAnchors.length) return lineAnchors
  }

  return buildAlignmentAnchorsFromNodes(nodes)
}

function getVisibleAnchors(anchors, container, overscan = 1) {
  if (!anchors?.length || !container) return anchors || []

  const top = container.scrollTop
  const bottom = top + container.clientHeight
  const visible = anchors.filter((anchor) => {
    const elementTop = anchor.element?.offsetTop || 0
    const elementHeight = anchor.element?.offsetHeight || 0
    const elementBottom = elementTop + Math.max(elementHeight, 1)
    return elementBottom >= top && elementTop <= bottom
  })

  if (!visible.length) return anchors

  const firstIndex = Math.max(0, visible[0].index - overscan)
  const lastIndex = Math.min(anchors.length - 1, visible[visible.length - 1].index + overscan)
  return anchors.slice(firstIndex, lastIndex + 1)
}

const SPEECH_TEST_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'hers', 'him', 'his', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my',
  'of', 'on', 'or', 'our', 'ours', 'she', 'so', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'us', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your', 'yours',
])

function isInformativeSpeechToken(token) {
  return token && token.length >= 3 && !SPEECH_TEST_STOPWORDS.has(token)
}

function selectVisibleOverlapToken(transcript, anchor) {
  const transcriptTokens = tokenizeText(transcript).filter(isInformativeSpeechToken)
  const anchorTokenSet = new Set((anchor?.tokens || []).filter(isInformativeSpeechToken))

  for (let index = transcriptTokens.length - 1; index >= 0; index -= 1) {
    const token = transcriptTokens[index]
    if (anchorTokenSet.has(token)) return token
  }

  return ''
}

function findVisibleOverlapMatch(anchors, transcript, preferredAnchorIndex = 0) {
  const transcriptTokens = tokenizeText(transcript).filter(isInformativeSpeechToken)
  if (!anchors?.length || !transcriptTokens.length) return null

  const transcriptCounts = new Map()
  transcriptTokens.forEach((token) => {
    transcriptCounts.set(token, (transcriptCounts.get(token) || 0) + 1)
  })

  let bestMatch = null

  anchors.forEach((anchor) => {
    const anchorTokens = (anchor.tokens || []).filter(isInformativeSpeechToken)
    if (!anchorTokens.length) return

    const anchorCounts = new Map()
    anchorTokens.forEach((token) => {
      anchorCounts.set(token, (anchorCounts.get(token) || 0) + 1)
    })

    let overlapCount = 0
    transcriptCounts.forEach((count, token) => {
      overlapCount += Math.min(count, anchorCounts.get(token) || 0)
    })

    if (!overlapCount) return

    const selectedHighlightToken = selectVisibleOverlapToken(transcript, anchor)
    if (!selectedHighlightToken) return

    const candidate = {
      matchedAnchor: anchor,
      candidateIndex: anchor.index,
      direction:
        anchor.index > preferredAnchorIndex
          ? 'forward'
          : anchor.index < preferredAnchorIndex
            ? 'rewind'
            : 'hold',
      confidence: overlapCount / transcriptTokens.length,
      selectedHighlightToken,
      anchorTextSnippet: anchor.text || '',
      overlapCount,
      distance: Math.abs((anchor.index ?? 0) - preferredAnchorIndex),
    }

    if (
      !bestMatch ||
      candidate.overlapCount > bestMatch.overlapCount ||
      (candidate.overlapCount === bestMatch.overlapCount && candidate.distance < bestMatch.distance)
    ) {
      bestMatch = candidate
    }
  })

  return bestMatch
}

const SPEECH_INPUT_STORAGE_KEY = 'leaderprompt-selected-mic'

function loadSelectedInputId() {
  try {
    return localStorage.getItem(SPEECH_INPUT_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function saveSelectedInputId(deviceId) {
  try {
    if (!deviceId) localStorage.removeItem(SPEECH_INPUT_STORAGE_KEY)
    else localStorage.setItem(SPEECH_INPUT_STORAGE_KEY, deviceId)
  } catch {}
}
const SPEECH_WINDOW_STORAGE_KEY = 'leaderprompt-speech-window-open'

function loadSpeechWindowPreference() {
  try {
    return localStorage.getItem(SPEECH_WINDOW_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function saveSpeechWindowPreference(value) {
  try {
    localStorage.setItem(SPEECH_WINDOW_STORAGE_KEY, value ? 'true' : 'false')
  } catch {}
}

function formatDebugValue(value) {
  if (value === undefined || value === null || value === '') return '--'
  return String(value)
}

function truncateDebugText(value, maxLength = 220) {
  const text = String(value || '').trim()
  if (!text) return '--'
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

function clampSpeechEyelineRatio(value) {
  return Math.min(SPEECH_EYELINE_MAX, Math.max(SPEECH_EYELINE_MIN, Number(value) || DEFAULT_SPEECH_EYELINE_RATIO))
}

function getSpeechEyelineOffset(container, ratio) {
  return (container?.clientHeight || 0) * clampSpeechEyelineRatio(ratio)
}

function formatSpeechFollowState(state, errorMessage) {
  if (errorMessage && state === 'mic_error') return errorMessage

  switch (state) {
    case 'listening':
      return 'Listening for speech'
    case 'hearing_speech':
      return 'Hearing speech'
    case 'aligned':
      return 'Following your place'
    case 'recovering':
      return 'Reacquiring your place'
    case 'mic_error':
      return 'Local speech follow unavailable'
    default:
      return 'Speech follow idle'
  }
}

function formatSpeechWpm(value) {
  return `${Math.round(Number.isFinite(value) ? value : 0)} WPM`
}

function formatSpeechScrollSpeed(value) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(2)} px/frame`
}

function getSpeechFollowPresentationState({
  whisperReady,
  speechFollow,
  speechFollowState,
  speechFollowMicOn,
  notecardMode,
  isEditing,
  missingSelectedInput,
}) {
  if (!whisperReady) return 'unavailable'
  if (notecardMode || isEditing || speechFollowState === 'mic_error' || missingSelectedInput) {
    return 'attention_required'
  }
  if (!speechFollow) return 'off'
  if (speechFollowState === 'aligned') return 'following'
  if (speechFollowState === 'hearing_speech') return 'listening'
  if (speechFollowMicOn && speechFollowState === 'listening') return 'starting'
  if (speechFollowMicOn) return 'ready'
  return 'ready'
}

function getSpeechFollowPresentationCopy(state) {
  switch (state) {
    case 'starting':
      return 'Starting speech follow...'
    case 'ready':
      return 'Ready'
    case 'listening':
      return 'Listening for your voice'
    case 'following':
      return 'Following your place'
    case 'attention_required':
      return 'Microphone needs attention'
    case 'unavailable':
      return "Speech follow isn't available in this build"
    default:
      return 'Off'
  }
}

function Prompter() {
  const [content, setContent] = useState('')
  const [projectName, setProjectName] = useState(null)
  const [slides, setSlides] = useState([])
  const [currentSlide, setCurrentSlide] = useState(0)
  const [mainSettingsOpen, setMainSettingsOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [speechFollowState, setSpeechFollowState] = useState('idle')
  const [speechFollowMicOn, setSpeechFollowMicOn] = useState(false)
  const [speechError, setSpeechError] = useState('')
  const [micLevel, setMicLevel] = useState(0)
  const [heardPreview, setHeardPreview] = useState('')
  const [availableInputs, setAvailableInputs] = useState([])
  const [selectedInputId, setSelectedInputId] = useState(loadSelectedInputId)
  const [speechWindowOpen, setSpeechWindowOpen] = useState(loadSpeechWindowPreference)
  const [speechAdvancedOpen, setSpeechAdvancedOpen] = useState(false)
  const [whisperReady, setWhisperReady] = useState(false)
  const [speechAlignmentFocus, setSpeechAlignmentFocus] = useState({ anchorIndex: -1, token: '' })
  const [speechOverlayRect, setSpeechOverlayRect] = useState(null)
  const [containerViewport, setContainerViewport] = useState({ scrollTop: 0, clientHeight: 0 })
  const [freezeSpeechScroll, setFreezeSpeechScroll] = useState(false)
  const [speechTestCheckpoint, setSpeechTestCheckpoint] = useState(0)
  const [speechMetrics, setSpeechMetrics] = useState({
    wpm: 0,
    speedFactor: 1,
    translatedScrollSpeed: 0,
  })
  const [speechTraceMeta, setSpeechTraceMeta] = useState({
    entries: 0,
    snapshotDirectory: '',
    exportStatus: 'idle',
    exportMessage: '',
    lastExportPath: '',
    lastExportAt: '',
  })
  const [speechDebug, setSpeechDebug] = useState({
    engineSource: '',
    executablePath: '',
    modelPath: '',
    chunkId: '',
    chunkSeconds: 0,
    sampleCount: 0,
    rms: 0,
    durationMs: 0,
    transcript: '',
    lastPartialTranscript: '',
    lastFinalTranscript: '',
    rollingTranscript: '',
    rawOutput: '',
    stderr: '',
    wavPath: '',
    eventType: 'idle',
    controllerMode: 'idle',
    currentSpeed: 0,
    targetSpeed: 0,
    baselineSpeed: 0,
    correctionAmount: 0,
    eyelineDelta: 0,
    targetLineCenter: 0,
    smoothedTargetLineCenter: 0,
    targetSourceTransition: '',
    spokenWpm: 0,
    speedFactor: 1,
    anchorIndex: -1,
    lastCandidateMatch: null,
    lastCommittedMatch: null,
    noCommitReason: '',
    lastScrollCorrection: null,
    lastMatchedAnchorText: '',
  })
  const [speechDebugLog, setSpeechDebugLog] = useState([])
  const [highlightLog, setHighlightLog] = useState([])
  const containerRef = useRef(null)
  const outputRef = useRef(null)
  const editorRef = useRef(null)
  const editorContainerRef = useRef(null)
  const isEditingRef = useRef(isEditing)
  const pendingRemoteHtmlRef = useRef(null)
  const updateTimeoutRef = useRef(null)
  const mountedRef = useRef(false)
  const slideCacheRef = useRef(new Map())
  const anchorsRef = useRef([])
  const recognizerRef = useRef(null)
  const recentTranscriptSegmentsRef = useRef([])
  const currentAnchorIndexRef = useRef(0)
  const speechTargetAnchorRef = useRef(null)
  const speechScrollSpeedRef = useRef(0)
  const speechStatusUpdateRef = useRef(0)
  const suppressManualScrollUntilRef = useRef(0)
  const manualSuspendUntilRef = useRef(0)
  const speechWindowChannelRef = useRef(null)
  const highlightClearTimeoutRef = useRef(null)
  const lastMeasuredSpeechOverlayRef = useRef(null)
  const lastSpeechInputAtRef = useRef(0)
  const speechPaceSamplesRef = useRef([])
  const lastPaceTranscriptRef = useRef('')
  const speechWpmRef = useRef(0)
  const lastOverlayLogKeyRef = useRef('')
  const speechTraceRef = useRef([])
  const speechTraceSequenceRef = useRef(0)

  const { settings, updateSettings, resetSettings } = useProjectSettings(
    projectName,
    DEFAULT_SETTINGS,
  )

  const {
    autoscroll,
    speed,
    margin,
    fontSize,
    mirrorX,
    mirrorY,
    shadowStrength,
    strokeWidth,
    lineHeight,
    textAlign,
    notecardMode,
    transparentMode,
    speechFollow,
    speechEyelineRatio,
  } = settings

  const speechFollowStatus = formatSpeechFollowState(speechFollowState, speechError)
  const clampedSpeechEyelineRatio = clampSpeechEyelineRatio(speechEyelineRatio)
  const speechEyelineTop =
    containerViewport.scrollTop + containerViewport.clientHeight * clampedSpeechEyelineRatio
  const selectedInputLabel =
    availableInputs.find((input) => input.deviceId === selectedInputId)?.label ||
    'System default microphone'
  const audioDetected = speechFollowMicOn && micLevel > 0.055
  const missingSelectedInput =
    Boolean(selectedInputId) &&
    !availableInputs.some((input) => input.deviceId === selectedInputId)
  const speechFollowPresentationState = getSpeechFollowPresentationState({
    whisperReady,
    speechFollow,
    speechFollowState,
    speechFollowMicOn,
    notecardMode,
    isEditing,
    missingSelectedInput,
  })
  const speechFollowPresentationCopy =
    getSpeechFollowPresentationCopy(speechFollowPresentationState)
  const showSpeechDebug = import.meta.env.DEV
  const speechFollowActive =
    speechFollow && speechFollowMicOn && !notecardMode && !isEditing

  const syncContainerViewport = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    setContainerViewport((current) => (
      current.scrollTop === container.scrollTop && current.clientHeight === container.clientHeight
        ? current
        : { scrollTop: container.scrollTop, clientHeight: container.clientHeight }
    ))
  }, [])

  const handleSpeechEyelineMouseDown = useCallback((event) => {
    event.preventDefault()

    const updateEyeline = (clientY) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (!rect.height) return
      const nextRatio = clampSpeechEyelineRatio((clientY - rect.top) / rect.height)
      updateSettings({ speechEyelineRatio: nextRatio })
    }

    updateEyeline(event.clientY)

    const handleMove = (moveEvent) => updateEyeline(moveEvent.clientY)
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [updateSettings])

  const refreshAudioInputs = useCallback(async () => {
    try {
      const inputs = await getAvailableAudioInputs()
      setAvailableInputs(inputs)
      if (selectedInputId && !inputs.some((input) => input.deviceId === selectedInputId)) {
        setSelectedInputId('')
      }
    } catch {
      setAvailableInputs([])
    }
  }, [selectedInputId])

  const refreshWhisperConfig = useCallback(async () => {
    try {
      const config = await window.electronAPI?.getWhisperConfig?.()
      setWhisperReady(Boolean(config?.configured))
      setSpeechDebug((current) => ({
        ...current,
        engineSource: config?.source || '',
        executablePath: config?.executablePath || '',
        modelPath: config?.modelPath || '',
      }))
    } catch {
      setWhisperReady(false)
    }
  }, [])

  useEffect(() => {
    saveSelectedInputId(selectedInputId)
  }, [selectedInputId])

  useEffect(() => {
    refreshAudioInputs()
    refreshWhisperConfig()
    if (!navigator?.mediaDevices?.addEventListener) return undefined
    const handleDeviceChange = () => refreshAudioInputs()
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
  }, [refreshAudioInputs, refreshWhisperConfig])
  useEffect(() => {
    saveSpeechWindowPreference(speechWindowOpen)
    if (!window.electronAPI) return
    if (speechWindowOpen) {
      window.electronAPI.openSpeechFollowInspector?.()
    } else {
      window.electronAPI.closeSpeechFollowInspector?.()
    }
  }, [speechWindowOpen])

  useEffect(() => {
    if (!window.electronAPI?.onSpeechFollowInspectorClosed) return undefined
    return window.electronAPI.onSpeechFollowInspectorClosed(() => {
      setSpeechWindowOpen(false)
    })
  }, [])

  const appendHighlightLog = useCallback((entry) => {
    if (!entry) return

    const nextEntry = {
      id: String(Date.now()) + Math.random().toString(16).slice(2),
      timestamp: new Date().toISOString(),
      ...entry,
    }

    setHighlightLog((current) => [nextEntry, ...current].slice(0, 30))
    window.electronAPI?.prompterDebugLog?.('[highlight]', nextEntry)
  }, [])

  const clearSpeechOverlay = useCallback(() => {
    lastMeasuredSpeechOverlayRef.current = null
    setSpeechAlignmentFocus({ anchorIndex: -1, token: '' })
    setSpeechOverlayRect(null)
  }, [])

  const measureSpeechOverlay = useCallback((trigger = 'measure') => {
    if (isEditing || notecardMode) {
      setSpeechOverlayRect(null)
      return null
    }

    const anchorIndex = speechAlignmentFocus.anchorIndex
    const token = speechAlignmentFocus.token || ''
    if (anchorIndex < 0) {
      setSpeechOverlayRect(null)
      return null
    }

    const anchor = anchorsRef.current[anchorIndex]
    const container = containerRef.current
    if (!anchor || !container) {
      setSpeechOverlayRect(null)
      return null
    }

    const measured = token
      ? measureTokenLineOverlay({
          anchorElement: anchor.element,
          token,
          containerElement: container,
          eyelineRatio: clampedSpeechEyelineRatio,
        })
      : { ok: false, reason: 'no_token' }

    const now = Date.now()
    let nextOverlay = null
    let reason = measured.reason || 'overlay_unavailable'

    if (measured.ok) {
      nextOverlay = {
        anchorIndex,
        token,
        ...measured.overlay,
        measuredAt: now,
        source: 'token_rect',
      }
      lastMeasuredSpeechOverlayRef.current = nextOverlay
      if (
        speechTargetAnchorRef.current &&
        speechTargetAnchorRef.current.index === anchorIndex &&
        nextOverlay.source === 'token_rect'
      ) {
      }
      reason = trigger
    } else {
      const lastOverlay = lastMeasuredSpeechOverlayRef.current
      const canReuseLastRect =
        lastOverlay &&
        lastOverlay.anchorIndex === anchorIndex &&
        lastOverlay.token === token &&
        now - lastOverlay.measuredAt <= SPEECH_OVERLAY_LAST_GOOD_TTL_MS

      if (canReuseLastRect) {
        nextOverlay = {
          ...lastOverlay,
          source: 'last_good_rect',
        }
        reason = measured.reason || 'last_good_rect'
      } else {
        const lineHeightValue = typeof anchor.element?.nodeType === 'number'
          ? parseFloat(window.getComputedStyle(anchor.element).lineHeight)
          : Number.NaN
        const fallbackHeight = Number.isFinite(lineHeightValue)
          ? lineHeightValue
          : Math.max(anchor.element?.offsetHeight || 0, 24)

        nextOverlay = {
          anchorIndex,
          token,
          lineTop: anchor.element?.offsetTop || 0,
          lineHeight: Math.max(fallbackHeight, 24),
          lineLeft: 0,
          lineWidth: container.clientWidth || 0,
          measuredAt: now,
          source: 'anchor_fallback',
        }
      }
    }

    setSpeechOverlayRect((current) => {
      if (
        current &&
        nextOverlay &&
        current.anchorIndex === nextOverlay.anchorIndex &&
        current.token === nextOverlay.token &&
        current.lineTop === nextOverlay.lineTop &&
        current.lineHeight === nextOverlay.lineHeight &&
        current.lineLeft === nextOverlay.lineLeft &&
        current.lineWidth === nextOverlay.lineWidth &&
        current.source === nextOverlay.source
      ) {
        return current
      }
      return nextOverlay
    })

    const logKey = `${nextOverlay?.source || 'none'}:${anchorIndex}:${token}:${reason}`
    if (lastOverlayLogKeyRef.current !== logKey) {
      lastOverlayLogKeyRef.current = logKey
      appendHighlightLog({
        stage: 'render',
        outcome: nextOverlay ? 'overlay_placed' : 'overlay_hidden',
        anchorIndex,
        token,
        reason,
        anchorText: anchor.text || '',
        overlaySource: nextOverlay?.source || 'none',
        overlayAgeMs:
          nextOverlay?.source === 'last_good_rect' && lastMeasuredSpeechOverlayRef.current
            ? now - lastMeasuredSpeechOverlayRef.current.measuredAt
            : 0,
      })
    }

    return nextOverlay
  }, [appendHighlightLog, clampedSpeechEyelineRatio, isEditing, notecardMode, speechAlignmentFocus])

  const scheduleHighlightClear = useCallback(() => {
    if (highlightClearTimeoutRef.current) {
      window.clearTimeout(highlightClearTimeoutRef.current)
    }

    highlightClearTimeoutRef.current = window.setTimeout(() => {
      clearSpeechOverlay()
      appendHighlightLog({
        stage: 'render',
        outcome: 'highlight_cleared',
        reason: 'highlight_timeout',
      })
      highlightClearTimeoutRef.current = null
    }, 1600)
  }, [appendHighlightLog, clearSpeechOverlay])

  useEffect(() => () => {
    if (highlightClearTimeoutRef.current) {
      window.clearTimeout(highlightClearTimeoutRef.current)
    }
  }, [])

  const pushSpeechDebugEvent = useCallback((event) => {
    if (!showSpeechDebug || !event) return
    setSpeechDebug((current) => ({
      ...current,
      eventType: event.type || current.eventType,
      chunkId: event.chunkId || current.chunkId,
      chunkSeconds: event.chunkSeconds ?? current.chunkSeconds,
      sampleCount: event.sampleCount ?? current.sampleCount,
      rms: event.rms ?? current.rms,
      durationMs: event.durationMs ?? current.durationMs,
      transcript: event.transcript ?? current.transcript,
      rawOutput: event.rawOutput ?? current.rawOutput,
      stderr: event.stderr ?? current.stderr,
      wavPath: event.wavPath ?? current.wavPath,
      executablePath: event.executablePath || current.executablePath,
      modelPath: event.modelPath || current.modelPath,
    }))
    setSpeechDebugLog((current) => [
      {
        id: String(Date.now()) + Math.random().toString(16).slice(2),
        timestamp: event.timestamp || new Date().toISOString(),
        summary:
          event.type === 'transcription_result'
            ? (event.transcript || '[blank result]')
            : event.type === 'transcription_error'
              ? event.message || 'Transcription error'
              : event.type === 'chunk_queued'
                ? 'Chunk queued'
                : event.type || 'speech event',
        ...event,
      },
      ...current,
    ].slice(0, 24))
  }, [showSpeechDebug])

  const clearSpeechDebugLog = useCallback(() => {
    setSpeechDebugLog([])
    setHighlightLog([])
  }, [])

  const appendSpeechTrace = useCallback((type, details = {}) => {
    const container = containerRef.current
    const entry = {
      id: ++speechTraceSequenceRef.current,
      type,
      timestamp: new Date().toISOString(),
      projectName: projectName || '',
      speechFollow,
      speechFollowState,
      scrollTop: container?.scrollTop ?? 0,
      clientHeight: container?.clientHeight ?? 0,
      currentAnchorIndex: currentAnchorIndexRef.current,
      metrics: {
        wpm: Number((speechWpmRef.current || 0).toFixed(2)),
        speedFactor: Number((speechMetrics.speedFactor || 1).toFixed(3)),
        translatedScrollSpeed: Number((speechMetrics.translatedScrollSpeed || 0).toFixed(3)),
      },
      overlay: speechOverlayRect
        ? {
            anchorIndex: speechOverlayRect.anchorIndex,
            token: speechOverlayRect.token,
            lineTop: speechOverlayRect.lineTop,
            lineHeight: speechOverlayRect.lineHeight,
            source: speechOverlayRect.source,
          }
        : null,
      ...details,
    }

    speechTraceRef.current = [...speechTraceRef.current, entry].slice(-SPEECH_TRACE_LIMIT)
    setSpeechTraceMeta((current) => ({
      ...current,
      entries: speechTraceRef.current.length,
    }))
  }, [projectName, speechFollow, speechFollowState, speechMetrics.speedFactor, speechMetrics.translatedScrollSpeed, speechOverlayRect])

  const clearSpeechTrace = useCallback(() => {
    speechTraceRef.current = []
    speechTraceSequenceRef.current = 0
    setSpeechTraceMeta((current) => ({
      ...current,
      entries: 0,
    }))
  }, [])

  const resetSpeechPace = useCallback(() => {
    speechPaceSamplesRef.current = []
    lastPaceTranscriptRef.current = ''
    speechWpmRef.current = 0
    setSpeechMetrics({
      wpm: 0,
      speedFactor: 1,
      translatedScrollSpeed: 0,
    })
  }, [])

  const recordSpeechPace = useCallback((transcript, nowMs = Date.now()) => {
    const previousTranscript = lastPaceTranscriptRef.current
    const nextTranscript = String(transcript || '').trim()
    const incrementalWords = countIncrementalTranscriptWords(previousTranscript, nextTranscript)

    if (incrementalWords > 0) {
      speechPaceSamplesRef.current = trimSpeechPaceSamples(
        [...speechPaceSamplesRef.current, { timeMs: nowMs, wordCount: incrementalWords }],
        nowMs,
        SPEECH_SCROLL_CONFIG.wpmWindowMs,
      )
      speechWpmRef.current = computeRollingWordsPerMinute(
        speechPaceSamplesRef.current,
        nowMs,
        SPEECH_SCROLL_CONFIG.wpmWindowMs,
      )
    } else {
      speechPaceSamplesRef.current = trimSpeechPaceSamples(
        speechPaceSamplesRef.current,
        nowMs,
        SPEECH_SCROLL_CONFIG.wpmWindowMs,
      )
      speechWpmRef.current = computeRollingWordsPerMinute(
        speechPaceSamplesRef.current,
        nowMs,
        SPEECH_SCROLL_CONFIG.wpmWindowMs,
      )
    }

    lastPaceTranscriptRef.current = nextTranscript
    setSpeechMetrics((current) => ({
      ...current,
      wpm: speechWpmRef.current,
    }))
  }, [])

  useEffect(() => {
    isEditingRef.current = isEditing
    if (!isEditing && pendingRemoteHtmlRef.current !== null) {
      setContent(pendingRemoteHtmlRef.current)
      pendingRemoteHtmlRef.current = null
    }
  }, [isEditing])

  const handleEditorReady = (editor) => {
    editorRef.current = editor
    if (containerRef.current) {
      editor.view.dom.scrollTop = containerRef.current.scrollTop
    }
  }

  const handleEdit = useCallback((html) => {
    if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current)
    updateTimeoutRef.current = setTimeout(() => {
      if (!isEditingRef.current) setContent(html)
      if (!window.electronAPI?.sendUpdatedScript) {
        console.error('electronAPI unavailable')
        return
      }
      window.electronAPI.sendUpdatedScript(html)
    }, 50)
  }, [])

  const flushEdit = useCallback(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
      updateTimeoutRef.current = null
    }
    const html = editorRef.current?.getHTML()
    if (html === undefined || html === content) return
    setContent(html)
    if (!window.electronAPI?.sendUpdatedScript) {
      console.error('electronAPI unavailable')
      return
    }
    window.electronAPI.sendUpdatedScript(html)
  }, [content])

  const handleBlur = useCallback(() => {
    if (!isEditingRef.current) return
    flushEdit()
    setIsEditing(false)
  }, [flushEdit])

  useEffect(() => {
    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [handleBlur])

  const toggleEditing = () => {
    if (isEditing) {
      flushEdit()
      editorRef.current?.commands.blur()
      setIsEditing(false)
      return
    }

    setIsEditing(true)
    setMainSettingsOpen(false)
    const scrollTop = containerRef.current?.scrollTop || 0
    setTimeout(() => {
      const container = containerRef.current
      const editor = editorRef.current
      if (!container || !editor) return
      editor.view.dom.scrollTop = scrollTop
      const rect = container.getBoundingClientRect()
      const pos = editor.view.posAtCoords({
        left: rect.left + 1,
        top: rect.top + 1,
      })
      editor
        .chain()
        .setTextSelection(pos?.pos ?? 0)
        .focus(undefined, { scrollIntoView: false })
        .run()
    }, 0)
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const syncScroll = () => {
      const editor = editorRef.current
      if (editor) {
        editor.view.dom.scrollTop = container.scrollTop
      }

      syncContainerViewport()

      if (speechAlignmentFocus.anchorIndex >= 0) {
        window.requestAnimationFrame(() => {
          measureSpeechOverlay('scroll')
        })
      }

      if (!speechFollowActive) return
      if (Date.now() <= suppressManualScrollUntilRef.current) return

      manualSuspendUntilRef.current = Date.now() + 1600
      syncContainerViewport()

      currentAnchorIndexRef.current = findNearestAnchorIndex(
        anchorsRef.current,
        container.scrollTop,
        container.clientHeight,
        clampedSpeechEyelineRatio,
      )
      setSpeechFollowState('recovering')
    }

    container.addEventListener('scroll', syncScroll)
    return () => container.removeEventListener('scroll', syncScroll)
  }, [clampedSpeechEyelineRatio, measureSpeechOverlay, speechAlignmentFocus.anchorIndex, speechFollowActive, syncContainerViewport])

  useEffect(() => {
    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const startResize = async (e, edge) => {
    e.preventDefault()
    const startX = e.screenX
    const startY = e.screenY
    if (
      !window.electronAPI?.getPrompterBounds ||
      !window.electronAPI?.setPrompterBounds
    ) {
      console.error('electronAPI unavailable')
      return
    }
    const bounds = await window.electronAPI.getPrompterBounds()
    if (!bounds) return

    const onMove = (ev) => {
      const dx = ev.screenX - startX
      const dy = ev.screenY - startY
      const newBounds = { ...bounds }

      if (edge.includes('right')) newBounds.width = Math.max(100, bounds.width + dx)
      if (edge.includes('bottom')) newBounds.height = Math.max(100, bounds.height + dy)
      if (edge.includes('left')) {
        newBounds.width = Math.max(100, bounds.width - dx)
        newBounds.x = bounds.x + dx
      }
      if (edge.includes('top')) {
        newBounds.height = Math.max(100, bounds.height - dy)
        newBounds.y = bounds.y + dy
      }

      window.electronAPI.setPrompterBounds(newBounds)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    const handleLoaded = (data) => {
      window.electronAPI?.prompterDebugLog?.('load-script received', {
        type: typeof data,
        project: typeof data === 'object' ? data?.project || null : null,
        htmlLength: typeof data === 'string' ? data.length : data?.html?.length || 0,
      })
      recentTranscriptSegmentsRef.current = []
      currentAnchorIndexRef.current = 0
      speechTargetAnchorRef.current = null
      lastSpeechInputAtRef.current = 0
      resetSpeechPace()
      speechScrollSpeedRef.current = 0
      clearSpeechOverlay()
      clearSpeechTrace()
      setSpeechFollowState(speechFollow ? 'listening' : 'idle')
      setSpeechError('')
      setHeardPreview('')
      if (!data) return
      if (typeof data === 'string') {
        setContent(data)
        return
      }
      setContent(data.html || '')
      setProjectName(data.project || null)
      slideCacheRef.current.clear()
    }

    const handleUpdated = (html) => {
      window.electronAPI?.prompterDebugLog?.('update-script received', { htmlLength: html?.length || 0, isEditing: isEditingRef.current })
      if (isEditingRef.current) {
        pendingRemoteHtmlRef.current = html
        return
      }
      setContent((current) => (current === html ? current : html))
    }

    if (
      !window.electronAPI?.onScriptLoaded ||
      !window.electronAPI?.onScriptUpdated ||
      !window.electronAPI?.getCurrentScript
    ) {
      console.error('electronAPI unavailable')
      return
    }

    const cleanupLoaded = window.electronAPI.onScriptLoaded(handleLoaded)
    const cleanupUpdated = window.electronAPI.onScriptUpdated(handleUpdated)
    window.electronAPI.getCurrentScript().then((data) => {
      window.electronAPI?.prompterDebugLog?.('getCurrentScript resolved', {
        hasData: Boolean(data),
        type: typeof data,
        project: typeof data === 'object' ? data?.project || null : null,
        htmlLength: typeof data === 'string' ? data.length : data?.html?.length || 0,
      })
      if (!data) return
      if (typeof data === 'string') {
        setContent(data)
        return
      }
      setContent(data.html || '')
      setProjectName(data.project || null)
      slideCacheRef.current.clear()
    })

    return () => {
      cleanupLoaded?.()
      cleanupUpdated?.()
    }
  }, [clearSpeechOverlay, clearSpeechTrace, resetSpeechPace, speechFollow])

  useEffect(() => {
    recentTranscriptSegmentsRef.current = []
    speechTargetAnchorRef.current = null
    lastSpeechInputAtRef.current = 0
    resetSpeechPace()
    speechScrollSpeedRef.current = 0
    clearSpeechOverlay()
    clearSpeechTrace()
    setSpeechError('')
    setMicLevel(0)
    setHeardPreview('')
    setSpeechDebug((current) => ({
      ...current,
      chunkId: '',
      chunkSeconds: 0,
      sampleCount: 0,
      rms: 0,
      durationMs: 0,
      transcript: '',
      lastPartialTranscript: '',
      lastFinalTranscript: '',
      rollingTranscript: '',
      rawOutput: '',
      stderr: '',
      wavPath: '',
      eventType: 'idle',
      controllerMode: 'idle',
      currentSpeed: 0,
      targetSpeed: 0,
      baselineSpeed: 0,
      correctionAmount: 0,
      eyelineDelta: 0,
      targetLineCenter: 0,
      smoothedTargetLineCenter: 0,
      targetSourceTransition: '',
      spokenWpm: 0,
      speedFactor: 1,
      anchorIndex: -1,
      lastCandidateMatch: null,
      lastCommittedMatch: null,
      noCommitReason: '',
      lastScrollCorrection: null,
      lastMatchedAnchorText: '',
    }))
    setSpeechDebugLog([])
  }, [clearSpeechOverlay, clearSpeechTrace, content, projectName, resetSpeechPace])

  useEffect(() => {
    if (notecardMode && speechFollow) {
      updateSettings({ speechFollow: false })
      setSpeechFollowMicOn(false)
      setSpeechFollowState('idle')
      setSpeechError('Speech follow is unavailable in notecard mode.')
    }
  }, [notecardMode, speechFollow, updateSettings])

  useEffect(() => {
    if (isEditing && speechFollowActive) {
      setSpeechFollowState('idle')
    }
  }, [isEditing, speechFollowActive])

  useEffect(() => {
    if (isEditing || notecardMode || !outputRef.current) {
      anchorsRef.current = []
      speechTargetAnchorRef.current = null
      lastSpeechInputAtRef.current = 0
      resetSpeechPace()
      return
    }

    const frame = window.requestAnimationFrame(() => {
      anchorsRef.current = buildSpeechAnchors(outputRef.current)
      currentAnchorIndexRef.current = findNearestAnchorIndex(
        anchorsRef.current,
        containerRef.current?.scrollTop || 0,
        containerRef.current?.clientHeight || 0,
        clampedSpeechEyelineRatio,
      )
      syncContainerViewport()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [clampedSpeechEyelineRatio, content, fontSize, lineHeight, margin, measureSpeechOverlay, resetSpeechPace, syncContainerViewport, textAlign, isEditing, notecardMode])


  useEffect(() => {
    if (isEditing || notecardMode) {
      setSpeechOverlayRect(null)
      return undefined
    }

    const frame = window.requestAnimationFrame(() => {
      measureSpeechOverlay('focus_change')
    })

    return () => window.cancelAnimationFrame(frame)
  }, [content, fontSize, isEditing, lineHeight, margin, measureSpeechOverlay, mirrorX, mirrorY, notecardMode, textAlign])

  useEffect(() => {
    const handleResize = () => {
      syncContainerViewport()
      measureSpeechOverlay('resize')
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [measureSpeechOverlay, syncContainerViewport])

  useEffect(() => {
    syncContainerViewport()
    if (!speechFollowActive) return

    const frame = window.requestAnimationFrame(() => {
      measureSpeechOverlay('eyeline_change')
    })

    return () => window.cancelAnimationFrame(frame)
  }, [clampedSpeechEyelineRatio, measureSpeechOverlay, speechFollowActive, syncContainerViewport])

  const commitSpeechMatch = useCallback((match) => {
    const anchor = match?.matchedAnchor
    const container = containerRef.current
    if (!anchor?.element || !container) return

    currentAnchorIndexRef.current = anchor.index
    const desiredScrollTop = Math.max(
      0,
      anchor.element.offsetTop - getSpeechEyelineOffset(container, clampedSpeechEyelineRatio),
    )
    const highlightToken = match.selectedHighlightToken || ''

    speechTargetAnchorRef.current = {
      index: anchor.index,
      direction: match.direction,
      confidence: match.confidence,
      desiredScrollTop,
    }

    setSpeechAlignmentFocus({
      anchorIndex: highlightToken ? anchor.index : -1,
      token: highlightToken,
    })
    setSpeechDebug((current) => ({
      ...current,
      anchorIndex: anchor.index,
      lastCommittedMatch: {
        candidateIndex: match.candidateIndex ?? anchor.index,
        direction: match.direction,
        confidence: match.confidence,
        selectedHighlightToken: highlightToken,
      },
      lastMatchedAnchorText: match.anchorTextSnippet || anchor.text || '',
      noCommitReason: '',
    }))
    setSpeechFollowState('aligned')
  }, [clampedSpeechEyelineRatio])

  const processTranscript = useCallback((text, isFinal = false) => {
    if (!text || !anchorsRef.current.length) return

    const nextSegments = [...recentTranscriptSegmentsRef.current, text]
    recentTranscriptSegmentsRef.current = nextSegments.slice(-6)
    const rollingTranscript = buildRollingTranscript(
      recentTranscriptSegmentsRef.current,
      isFinal ? 180 : 140,
    )
    if (!rollingTranscript) return

    const nowMs = Date.now()
    lastSpeechInputAtRef.current = nowMs
    const incrementalWords = countIncrementalTranscriptWords(
      lastPaceTranscriptRef.current,
      String(text || '').trim(),
    )
    recordSpeechPace(text, nowMs)

    if (Date.now() < manualSuspendUntilRef.current) {
      currentAnchorIndexRef.current = findNearestAnchorIndex(
        anchorsRef.current,
        containerRef.current?.scrollTop || 0,
        containerRef.current?.clientHeight || 0,
        clampedSpeechEyelineRatio,
      )
      syncContainerViewport()
    }

    const matchingAnchors = getVisibleAnchors(anchorsRef.current, containerRef.current, 1)
    const match = findVisibleOverlapMatch(
      matchingAnchors,
      rollingTranscript,
      currentAnchorIndexRef.current,
    )
    const hasSuitableMatch = Boolean(
      match?.matchedAnchor &&
      (match.selectedHighlightToken || '') &&
      (match.confidence ?? 0) >= SPEECH_MIN_VISIBLE_MATCH_CONFIDENCE
    )

    appendHighlightLog({
      stage: 'match',
      outcome: match?.matchedAnchor ? 'visible_candidate_found' : 'no_visible_overlap',
      transcript: rollingTranscript,
      anchorIndex: match?.candidateIndex ?? -1,
      token: match?.selectedHighlightToken || '',
      confidence: Number((match?.confidence ?? 0).toFixed(3)),
      reason: match?.matchedAnchor ? 'visible_overlap' : 'no_visible_overlap',
      anchorText: match?.anchorTextSnippet || '',
      matchScope: 'visible_only',
    })
    appendSpeechTrace('transcript', {
      transcript: text,
      isFinal,
      rollingTranscript,
      incrementalWords,
      visibleAnchors: matchingAnchors.slice(0, 8).map((anchor) => ({
        index: anchor.index,
        text: (anchor.text || '').slice(0, 140),
      })),
      match: match?.matchedAnchor ? {
        candidateIndex: match.candidateIndex ?? match.matchedAnchor.index,
        direction: match.direction,
        confidence: Number((match.confidence ?? 0).toFixed(3)),
        selectedHighlightToken: match.selectedHighlightToken || '',
        anchorTextSnippet: (match.anchorTextSnippet || '').slice(0, 180),
      } : null,
    })

    setSpeechDebug((current) => ({
      ...current,
      lastPartialTranscript: isFinal ? current.lastPartialTranscript : text,
      lastFinalTranscript: isFinal ? text : current.lastFinalTranscript,
      rollingTranscript,
      lastCandidateMatch: match?.matchedAnchor ? {
        candidateIndex: match.candidateIndex ?? match.matchedAnchor.index,
        confidence: match.confidence,
        direction: match.direction,
        selectedHighlightToken: match.selectedHighlightToken || '',
        anchorTextSnippet: match.anchorTextSnippet || '',
        currentAnchorIndex: currentAnchorIndexRef.current,
      } : null,
    }))

    if (!hasSuitableMatch) {
      speechTargetAnchorRef.current = null
      appendHighlightLog({
        stage: 'decision',
        outcome: match?.matchedAnchor ? 'not_committed' : 'no_visible_overlap',
        transcript: rollingTranscript,
        anchorIndex: match?.candidateIndex ?? -1,
        token: match?.selectedHighlightToken || '',
        confidence: Number((match?.confidence ?? 0).toFixed(3)),
        reason: match?.matchedAnchor ? 'low_visible_overlap' : 'no_visible_overlap',
        anchorText: match?.anchorTextSnippet || '',
      })
      setSpeechDebug((current) => ({
        ...current,
        noCommitReason: match?.matchedAnchor ? 'low_visible_overlap' : 'no_visible_overlap',
      }))
      setSpeechFollowState(match?.matchedAnchor ? 'hearing_speech' : 'recovering')
      return
    }

    setSpeechAlignmentFocus({
      anchorIndex: match.matchedAnchor.index,
      token: match.selectedHighlightToken || '',
    })
    scheduleHighlightClear()
    appendHighlightLog({
      stage: 'decision',
      outcome: 'committed',
      transcript: rollingTranscript,
      anchorIndex: match.candidateIndex ?? match.matchedAnchor.index,
      token: match.selectedHighlightToken || '',
      confidence: Number((match.confidence ?? 0).toFixed(3)),
      reason: 'visible_overlap',
      anchorText: match.anchorTextSnippet || '',
    })

    commitSpeechMatch({
      ...match,
      transcript: rollingTranscript,
    })
  }, [appendHighlightLog, appendSpeechTrace, clampedSpeechEyelineRatio, commitSpeechMatch, recordSpeechPace, scheduleHighlightClear, syncContainerViewport])

  useEffect(() => {
    if (!speechFollowActive || !content?.trim()) {
      recognizerRef.current?.destroy?.()
      recognizerRef.current = null
      if (!speechFollow) {
        setSpeechFollowState('idle')
        setSpeechError('')
      }
      setMicLevel(0)
      speechScrollSpeedRef.current = 0
      speechTargetAnchorRef.current = null
      resetSpeechPace()
      clearSpeechOverlay()
      if (highlightClearTimeoutRef.current) {
        window.clearTimeout(highlightClearTimeoutRef.current)
        highlightClearTimeoutRef.current = null
      }
      return undefined
    }

    const recognizer = createLocalSpeechRecognizer({
      deviceId: selectedInputId,
      onPartialText: (text) => {
        setHeardPreview(text)
        processTranscript(text, false)
      },
      onFinalText: (text) => {
        setHeardPreview(text)
        processTranscript(text, true)
      },
      onLevel: setMicLevel,
      onStateChange: (state) => {
        setSpeechFollowState(state)
        if (state !== 'mic_error') setSpeechError('')
      },
      onError: (message) => {
        setSpeechError(message)
        setSpeechFollowState('mic_error')
      },
      onDebugEvent: pushSpeechDebugEvent,
    })

    recognizerRef.current = recognizer
    recognizer.start().then((result) => {
      if (!result?.ok) {
        setSpeechFollowMicOn(false)
      }
    })

    return () => {
      recognizer.destroy()
      recognizerRef.current = null
      setMicLevel(0)
    }
  }, [clearSpeechOverlay, content, processTranscript, pushSpeechDebugEvent, resetSpeechPace, selectedInputId, speechFollow, speechFollowActive])

  useEffect(() => {
    if (!speechFollowActive || notecardMode || isEditing) return undefined

    let requestId
    const step = () => {
      const container = containerRef.current
      if (!container) {
        requestId = requestAnimationFrame(step)
        return
      }

      const now = Date.now()
      const canAutoAdjust = now >= manualSuspendUntilRef.current
      const railSpeed = Math.max(SPEECH_SCROLL_CONFIG.baselineMin, speed)
      const silenceMs = lastSpeechInputAtRef.current ? now - lastSpeechInputAtRef.current : Number.POSITIVE_INFINITY
      const idleFactor = silenceMs <= SPEECH_SCROLL_CONFIG.idleGraceMs
        ? 1
        : Math.max(0, 1 - ((silenceMs - SPEECH_SCROLL_CONFIG.idleGraceMs) / SPEECH_SCROLL_CONFIG.idleDecayMs))
      const effectiveWpm = speechWpmRef.current * idleFactor
      const speedFactor = mapWpmToSpeedFactor(effectiveWpm, SPEECH_SCROLL_CONFIG)
      const translatedScrollSpeed = Math.max(
        SPEECH_SCROLL_CONFIG.idleCrawlSpeed,
        railSpeed * speedFactor * idleFactor,
      )
      const speechTarget = speechTargetAnchorRef.current
      const overlayMatchesTarget =
        speechOverlayRect &&
        speechTarget &&
        speechOverlayRect.anchorIndex === speechTarget.index
      let desiredScrollTop = container.scrollTop + translatedScrollSpeed

      if (speechTarget) {
        const eyelineOffset = getSpeechEyelineOffset(container, clampedSpeechEyelineRatio)
        const lineCenter = overlayMatchesTarget
          ? speechOverlayRect.lineTop + speechOverlayRect.lineHeight / 2
          : speechTarget.desiredScrollTop + eyelineOffset
        desiredScrollTop = Math.max(0, lineCenter - eyelineOffset)
      }

      const distance = desiredScrollTop - container.scrollTop
      const maxStep = Math.max(translatedScrollSpeed * 1.8, 0.12)
      const stepDistance = speechTarget
        ? Math.sign(distance) * Math.min(Math.abs(distance), maxStep)
        : translatedScrollSpeed
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      const nextScrollTop = Math.max(0, Math.min(maxScrollTop, container.scrollTop + stepDistance))

      speechScrollSpeedRef.current = stepDistance

      if (Date.now() - speechStatusUpdateRef.current > 120) {
        speechStatusUpdateRef.current = Date.now()
        setSpeechMetrics({
          wpm: effectiveWpm,
          speedFactor,
          translatedScrollSpeed,
        })
        appendSpeechTrace('scroll', {
          controllerMode: speechTarget ? 'follow_visible_match' : 'pace_only',
          actualScrollDelta: Number(stepDistance.toFixed(3)),
          targetScrollTop: Number(desiredScrollTop.toFixed(2)),
          nextScrollTop: Number(nextScrollTop.toFixed(2)),
          eyelineErrorPx: Number(distance.toFixed(2)),
          matchedAnchorIndex: speechTarget?.index ?? -1,
          overlaySource: overlayMatchesTarget ? speechOverlayRect?.source || 'overlay' : 'pace_only',
          silenceMs: Number.isFinite(silenceMs) ? silenceMs : null,
        })
        setSpeechDebug((current) => ({
          ...current,
          controllerMode: speechTarget ? 'follow_visible_match' : 'pace_only',
          currentSpeed: speechScrollSpeedRef.current,
          targetSpeed: translatedScrollSpeed,
          baselineSpeed: railSpeed,
          correctionAmount: distance,
          eyelineDelta: distance,
          targetLineCenter: desiredScrollTop,
          smoothedTargetLineCenter: desiredScrollTop,
          targetSourceTransition: overlayMatchesTarget ? speechOverlayRect?.source || 'overlay' : 'pace_only',
          spokenWpm: effectiveWpm,
          speedFactor,
          anchorIndex: speechTargetAnchorRef.current?.index ?? currentAnchorIndexRef.current,
          lastScrollCorrection: {
            applied: Math.abs(stepDistance) > 0.01,
            reason: speechTarget ? 'follow_visible_match' : 'pace_only',
            frozen: false,
            baseSpeed: railSpeed,
            targetSpeed: translatedScrollSpeed,
            currentSpeed: speechScrollSpeedRef.current,
          },
        }))
      }

      if (canAutoAdjust && Math.abs(nextScrollTop - container.scrollTop) > 0.01) {
        suppressManualScrollUntilRef.current = Date.now() + 90
        container.scrollTop = nextScrollTop
      }

      requestId = requestAnimationFrame(step)
    }

    requestId = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(requestId)
    }
  }, [appendSpeechTrace, clampedSpeechEyelineRatio, isEditing, notecardMode, speed, speechFollowActive, speechOverlayRect])

  useEffect(() => {
    if (!autoscroll || speechFollowActive || notecardMode || isEditing) return undefined
    let requestId
    const step = () => {
      if (containerRef.current) {
        containerRef.current.scrollTop += speed
      }
      requestId = requestAnimationFrame(step)
    }
    requestId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(requestId)
  }, [autoscroll, speed, speechFollowActive, notecardMode, isEditing])

  const notecardSource = useMemo(
    () => (isEditing && editorRef.current ? editorRef.current.getHTML() : content),
    [content, isEditing],
  )

  useEffect(() => {
    if (!notecardMode || !containerRef.current) return undefined

    const container = containerRef.current
    const height = container.clientHeight
    const width = container.clientWidth - margin * 2
    const cacheKey = createNotecardCacheKey({
      content: notecardSource,
      width,
      height,
      fontSize,
      lineHeight,
    })

    if (slideCacheRef.current.has(cacheKey)) {
      setSlides(slideCacheRef.current.get(cacheKey))
      setCurrentSlide(0)
      return undefined
    }

    let cancelled = false
    let timeoutId = null
    let idleId = null

    const compute = () => {
      const nextSlides = generateNotecardSlides({
        content: notecardSource,
        width,
        height,
        fontSize,
        lineHeight,
      })
      if (cancelled) return
      slideCacheRef.current.set(cacheKey, nextSlides)
      setSlides(nextSlides)
      setCurrentSlide(0)
    }

    const scheduleCompute = () => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(compute, { timeout: 200 })
      } else {
        timeoutId = window.setTimeout(compute, 75)
      }
    }

    timeoutId = window.setTimeout(scheduleCompute, 50)

    return () => {
      cancelled = true
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [fontSize, lineHeight, margin, notecardMode, notecardSource])

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0
  }, [currentSlide])

  useEffect(() => {
    if (!notecardMode) {
      setSlides([])
      setCurrentSlide(0)
    }
  }, [notecardMode])

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      window.electronAPI?.prompterDebugLog?.('mounted', {
        hash: window.location.hash,
        hasPrompterReady: Boolean(window.electronAPI?.prompterReady),
      })
      if (!window.electronAPI?.prompterReady) {
        console.error('electronAPI unavailable')
        return
      }
      window.electronAPI.prompterReady()
    }
  }, [])

  const setSetting = (key, value) => {
    updateSettings({ [key]: value })
  }

  const handleToggleSpeechFollow = () => {
    if (notecardMode) return
    if (speechFollow) {
      updateSettings({ speechFollow: false })
      setSpeechFollowMicOn(false)
      setSpeechFollowState('idle')
      setSpeechError('')
      return
    }

    if (!whisperReady) {
      setSpeechError('Local speech follow is not installed in this build yet.')
      setSpeechFollowState('mic_error')
      return
    }

    updateSettings({ speechFollow: true, autoscroll: true })
    setFreezeSpeechScroll(false)
    setSpeechFollowMicOn(true)
    setSpeechError('')
    setSpeechFollowState('listening')
  }

  const handleToggleMic = () => {
    if (!speechFollow) return
    setSpeechFollowMicOn((current) => {
      const next = !current
      setSpeechFollowState(next ? 'listening' : 'idle')
      if (!next) {
        setSpeechError('')
        setMicLevel(0)
        setHeardPreview('')
      } else {
        refreshAudioInputs()
      }
      return next
    })
  }

  const handleRunSpeechTest = async () => {
    await recognizerRef.current?.debugTranscribeNow?.()
  }

  const handleRetrySpeechFollow = useCallback(async () => {
    await refreshAudioInputs()
    setSpeechError('')

    if (!whisperReady || notecardMode) return

    if (speechFollow && recognizerRef.current?.restart) {
      setSpeechFollowMicOn(true)
      setSpeechFollowState('listening')
      const result = await recognizerRef.current.restart(selectedInputId)
      if (!result?.ok) {
        setSpeechFollowMicOn(false)
      }
      return
    }

    handleToggleSpeechFollow()
  }, [notecardMode, refreshAudioInputs, selectedInputId, speechFollow, whisperReady])

  const handleSelectInputId = useCallback(async (nextDeviceId) => {
    setSelectedInputId(nextDeviceId)
    setSpeechError('')
    await refreshAudioInputs()
    if (speechFollowActive && recognizerRef.current?.restart) {
      const result = await recognizerRef.current.restart(nextDeviceId)
      if (!result?.ok) {
        setSpeechFollowMicOn(false)
      }
    }
  }, [refreshAudioInputs, speechFollowActive])

  const loadSpeechTestScript = () => {
    recentTranscriptSegmentsRef.current = []
    speechTargetAnchorRef.current = null
    speechScrollSpeedRef.current = 0
    clearSpeechOverlay()
    clearSpeechTrace()
    setContent(SPEECH_TEST_SCRIPT_HTML)
    setProjectName('Speech Follow Test')
    slideCacheRef.current.clear()
    setSpeechDebugLog([])
    setHighlightLog([])
    setSpeechDebug((current) => ({
      ...current,
      lastPartialTranscript: '',
      lastFinalTranscript: '',
      rollingTranscript: '',
      lastCandidateMatch: null,
      lastCommittedMatch: null,
      noCommitReason: '',
      lastScrollCorrection: null,
      lastMatchedAnchorText: '',
    }))
  }

  const simulateMatchOffset = (offset) => {
    if (!anchorsRef.current.length) return
    const baseIndex = speechDebug.lastCommittedMatch?.candidateIndex ?? currentAnchorIndexRef.current
    const targetIndex = Math.max(0, Math.min(anchorsRef.current.length - 1, baseIndex + offset))
    const anchor = anchorsRef.current[targetIndex]
    if (!anchor) return
    commitSpeechMatch({
      matchedAnchor: anchor,
      candidateIndex: targetIndex,
      confidence: 0.99,
      direction: offset < 0 ? 'rewind' : offset > 0 ? 'forward' : 'hold',
      anchorTextSnippet: anchor.text || '',
      selectedHighlightToken: anchor.tokens?.[0] || '',
      transcript: anchor.text || '',
      simulated: true,
    })
  }

  const handleExportSpeechSnapshot = useCallback(async () => {
    setSpeechTraceMeta((current) => ({
      ...current,
      exportStatus: 'saving',
      exportMessage: 'Saving snapshot...',
    }))

    const payload = {
      snapshotName: projectName || 'speech-follow',
      projectName: projectName || '',
      state: {
        speechFollow,
        speechFollowState,
        speechFollowStatus,
        speechFollowMicOn,
        heardPreview,
        selectedInputId,
        selectedInputLabel,
        speechMetrics,
        speechTraceMeta: {
          ...speechTraceMeta,
          entries: speechTraceRef.current.length,
        },
      },
      settings: {
        speed,
        speechEyelineRatio: clampedSpeechEyelineRatio,
        minVisibleMatchConfidence: SPEECH_MIN_VISIBLE_MATCH_CONFIDENCE,
        speechScrollConfig: SPEECH_SCROLL_CONFIG,
      },
      debug: {
        speechDebug,
        highlightLog,
      },
      trace: speechTraceRef.current,
    }

    const result = await window.electronAPI?.exportSpeechFollowSnapshot?.(payload)
    if (!result?.success) {
      const message = result?.error || 'Failed to export speech snapshot.'
      setSpeechTraceMeta((current) => ({
        ...current,
        exportStatus: 'error',
        exportMessage: message,
      }))
      toast.error(message)
      return result
    }

    setSpeechTraceMeta((current) => ({
      ...current,
      entries: speechTraceRef.current.length,
      snapshotDirectory: result.snapshotDirectory || current.snapshotDirectory,
      exportStatus: 'success',
      exportMessage: `Snapshot saved to ${result.filePath}`,
      lastExportPath: result.filePath || '',
      lastExportAt: new Date().toISOString(),
    }))
    toast.success(`Speech snapshot saved`)
    return result
  }, [
    clampedSpeechEyelineRatio,
    heardPreview,
    highlightLog,
    projectName,
    selectedInputId,
    selectedInputLabel,
    speechDebug,
    speechFollow,
    speechFollowMicOn,
    speechFollowState,
    speechFollowStatus,
    speechMetrics,
    speechTraceMeta,
    speed,
  ])

  const currentCheckpoint = SPEECH_TEST_CHECKPOINTS[speechTestCheckpoint]
  const stageStatus = {
    audio: audioDetected,
    transcript: Boolean(speechDebug.lastPartialTranscript || speechDebug.lastFinalTranscript),
    match: Boolean(speechDebug.lastCandidateMatch?.candidateIndex >= 0 || speechDebug.lastCommittedMatch?.candidateIndex >= 0),
    scroll: Boolean(speechDebug.lastScrollCorrection?.applied),
  }
  const speechWpmLabel = formatSpeechWpm(speechMetrics.wpm)
  const speechScrollSpeedLabel = formatSpeechScrollSpeed(speechMetrics.translatedScrollSpeed)
  const speechMeterValue = Math.max(
    0,
    Math.min(1, (speechMetrics.wpm || 0) / Math.max(1, SPEECH_SCROLL_CONFIG.referenceWpm * 1.6)),
  )
  const showSpeechRecoveryTray =
    !whisperReady || speechFollowState === 'mic_error' || notecardMode || isEditing || missingSelectedInput

  const speechWindowSnapshot = useMemo(() => ({
    projectName,
    speechFollow,
    speechFollowMicOn,
    speechFollowState,
    speechFollowStatus,
    whisperReady,
    audioDetected,
    micLevel,
    heardPreview,
    availableInputs,
    selectedInputId,
    selectedInputLabel,
    freezeSpeechScroll,
    speechTestCheckpoint,
    checkpoints: SPEECH_TEST_CHECKPOINTS,
    currentCheckpoint,
    stageStatus,
    speechMetrics,
    speechTraceMeta: {
      ...speechTraceMeta,
      entries: speechTraceRef.current.length,
    },
    showSpeechDebug,
    notecardMode,
    isEditing,
    speechDebug,
    speechDebugLog,
    highlightLog,
    speechOverlayRect,
  }), [
    projectName,
    speechFollow,
    speechFollowMicOn,
    speechFollowState,
    speechFollowStatus,
    whisperReady,
    audioDetected,
    micLevel,
    heardPreview,
    availableInputs,
    selectedInputId,
    selectedInputLabel,
    freezeSpeechScroll,
    speechTestCheckpoint,
    currentCheckpoint,
    stageStatus,
    speechMetrics,
    speechTraceMeta,
    showSpeechDebug,
    notecardMode,
    isEditing,
    speechDebug,
    speechDebugLog,
    highlightLog,
    speechOverlayRect,
  ])

  useEffect(() => {
    const channel = speechWindowChannelRef.current
    if (!channel) return
    channel.postMessage({ type: 'state', payload: speechWindowSnapshot })
  }, [speechWindowSnapshot])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined

    const channel = new BroadcastChannel('leaderprompt-speech-follow')
    speechWindowChannelRef.current = channel

    channel.onmessage = async (event) => {
      const data = event.data || {}
      if (data.type === 'request_state') {
        channel.postMessage({ type: 'state', payload: speechWindowSnapshot })
        return
      }
      if (data.type !== 'command') return

      switch (data.command) {
        case 'toggle_speech_follow':
          handleToggleSpeechFollow()
          break
        case 'toggle_mic':
          handleToggleMic()
          break
        case 'select_input':
          await handleSelectInputId(data.payload?.deviceId || '')
          break
        case 'toggle_freeze_scroll':
          setFreezeSpeechScroll((current) => !current)
          break
        case 'load_test_script':
          loadSpeechTestScript()
          break
        case 'run_test_chunk':
          await handleRunSpeechTest()
          break
        case 'clear_debug_log':
          clearSpeechDebugLog()
          break
        case 'clear_speech_trace':
          clearSpeechTrace()
          break
        case 'export_speech_snapshot':
          await handleExportSpeechSnapshot()
          break
        case 'previous_checkpoint':
          setSpeechTestCheckpoint((current) => Math.max(0, current - 1))
          break
        case 'next_checkpoint':
          setSpeechTestCheckpoint((current) => Math.min(SPEECH_TEST_CHECKPOINTS.length - 1, current + 1))
          break
        case 'simulate_match':
          simulateMatchOffset(Number(data.payload?.offset || 0))
          break
        default:
          break
      }
    }

    channel.postMessage({ type: 'state', payload: speechWindowSnapshot })

    return () => {
      channel.close()
      speechWindowChannelRef.current = null
    }
  }, [clearSpeechDebugLog, clearSpeechTrace, handleExportSpeechSnapshot, handleRunSpeechTest, handleSelectInputId, speechWindowSnapshot])

  return (
    <div className="prompter-wrapper">
      {findOpen && <FindBar onClose={() => setFindOpen(false)} />}
      <div className="resize-handle top" onMouseDown={(e) => startResize(e, 'top')} />
      <div className="resize-handle bottom" onMouseDown={(e) => startResize(e, 'bottom')} />
      <div className="resize-handle left" onMouseDown={(e) => startResize(e, 'left')} />
      <div className="resize-handle right" onMouseDown={(e) => startResize(e, 'right')} />
      <div className="resize-handle top-left" onMouseDown={(e) => startResize(e, 'top-left')} />
      <div className="resize-handle top-right" onMouseDown={(e) => startResize(e, 'top-right')} />
      <div className="resize-handle bottom-left" onMouseDown={(e) => startResize(e, 'bottom-left')} />
      <div className="resize-handle bottom-right" onMouseDown={(e) => startResize(e, 'bottom-right')} />
      <button
        className={`main-settings-toggle ${mainSettingsOpen ? 'open' : ''}`}
        onClick={() => !isEditing && setMainSettingsOpen(!mainSettingsOpen)}
        disabled={isEditing}
        aria-label="Settings"
      >
        ?
      </button>
      <div className={`main-settings ${mainSettingsOpen ? 'open' : ''}`}>
        <button
          className="stop-button"
          onClick={() => {
            if (!window.electronAPI?.closePrompter) {
              console.error('electronAPI unavailable')
              return
            }
            window.electronAPI.closePrompter()
          }}
        >
          Stop Prompting
        </button>
        <button
          className={`toggle-btn ${autoscroll ? 'active' : ''}`}
          onClick={() => setSetting('autoscroll', !autoscroll)}
          disabled={notecardMode}
        >
          Auto-scroll
        </button>
        <label>
          Speed
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            value={speed}
            step="0.05"
            onChange={(e) => setSetting('speed', parseFloat(e.target.value))}
            disabled={notecardMode}
          />
        </label>
        <div className="speech-follow-panel">
          <div className="speech-follow-inline-header">
            <span className="setting-label">Speech Follow</span>
            <button
              className={`toggle-btn ${speechFollow ? 'active' : ''}`}
              onClick={handleToggleSpeechFollow}
              disabled={!whisperReady || notecardMode}
            >
              {speechFollow ? 'On' : 'Off'}
            </button>
          </div>
          <label>
            Microphone
            <select
              value={selectedInputId}
              onChange={(event) => handleSelectInputId(event.target.value)}
              disabled={!whisperReady}
            >
              <option value="">System default microphone</option>
              {availableInputs.map((input) => (
                <option key={input.deviceId || input.label} value={input.deviceId}>
                  {input.label}
                </option>
              ))}
            </select>
          </label>
          <span className={`speech-follow-status speech-follow-status-${speechFollowPresentationState}`}>
            {speechFollowPresentationCopy}
          </span>
          {showSpeechRecoveryTray && (
            <div className="speech-follow-recovery">
              {!whisperReady && (
                <p>Speech follow is unavailable in this build.</p>
              )}
              {whisperReady && missingSelectedInput && (
                <p>Your saved microphone is no longer available. Choose another microphone to continue.</p>
              )}
              {whisperReady && speechFollowState === 'mic_error' && (
                <p>{speechError || 'Microphone needs attention.'}</p>
              )}
              {whisperReady && notecardMode && (
                <p>Speech follow is unavailable while notecard mode is on.</p>
              )}
              {whisperReady && isEditing && (
                <p>Speech follow pauses while you edit.</p>
              )}
              <div className="speech-follow-recovery-actions">
                {(speechFollowState === 'mic_error' || missingSelectedInput) && (
                  <button className="toggle-btn" onClick={handleRetrySpeechFollow} disabled={!whisperReady}>
                    Try Again
                  </button>
                )}
                <button className="toggle-btn" onClick={refreshAudioInputs}>
                  Refresh Microphones
                </button>
              </div>
            </div>
          )}
          <div className="speech-follow-metric-panel">
            <div className="speech-follow-meter" aria-hidden="true">
              <div
                className="speech-follow-meter-fill"
                style={{ transform: `scaleX(${speechMeterValue})` }}
              />
            </div>
            <div className="speech-follow-metric-copy">
              <strong>{speechWpmLabel}</strong>
              <span>Translates to {speechScrollSpeedLabel}</span>
            </div>
          </div>
          <div className="speech-follow-advanced">
            <button
              className={`toggle-btn ${speechAdvancedOpen ? 'active' : ''}`}
              onClick={() => setSpeechAdvancedOpen((current) => !current)}
            >
              {speechAdvancedOpen ? 'Hide Advanced' : 'Advanced'}
            </button>
            {speechAdvancedOpen && (
              <div className="speech-follow-advanced-panel">
                <span className="speech-follow-advanced-copy">
                  Advanced speech tools keep the existing diagnostics, testing, and trace export out of the main flow.
                </span>
                <div className="speech-follow-buttons">
                  <button
                    className={`toggle-btn ${speechWindowOpen ? 'active' : ''}`}
                    onClick={() => setSpeechWindowOpen((current) => !current)}
                  >
                    {speechWindowOpen ? 'Advanced Tools Open' : 'Open Advanced Tools'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <button onClick={() => setSetting('mirrorX', !mirrorX)}>Flip Horizontally</button>
        <button onClick={() => setSetting('mirrorY', !mirrorY)}>Flip Vertically</button>
        <button
          className={`toggle-btn ${notecardMode ? 'active' : ''}`}
          onClick={() =>
            updateSettings((current) => ({
              notecardMode: !current.notecardMode,
              autoscroll: current.notecardMode ? current.autoscroll : false,
              speechFollow: current.notecardMode ? current.speechFollow : false,
            }))
          }
        >
          Notecard
        </button>
        <button
          className={`toggle-btn ${transparentMode ? 'active' : ''}`}
          onClick={() => setSetting('transparentMode', !transparentMode)}
        >
          Transparent
        </button>
        <h4>Text Styling</h4>
        <label>
          Font Size ({fontSize}rem):
          <input
            type="range"
            min="1"
            max="6"
            step="0.1"
            value={fontSize}
            onChange={(e) => setSetting('fontSize', parseFloat(e.target.value))}
          />
        </label>
        <label>
          Margin ({Math.round(((margin - MARGIN_MIN) / (MARGIN_MAX - MARGIN_MIN)) * 100)}%):
          <input
            type="range"
            min={MARGIN_MIN}
            max={MARGIN_MAX}
            value={margin}
            onChange={(e) => setSetting('margin', parseInt(e.target.value, 10))}
          />
        </label>
        <button onClick={resetSettings}>Reset to defaults</button>
        <h4>Advanced Settings</h4>
        <label>
          Line Height ({lineHeight})
          <input
            type="range"
            min="1"
            max="3"
            step="0.1"
            value={lineHeight}
            onChange={(e) => setSetting('lineHeight', parseFloat(e.target.value))}
          />
        </label>
        <label>
          Stroke ({strokeWidth}px)
          <input
            type="range"
            min="0"
            max="4"
            step="0.5"
            value={strokeWidth}
            onChange={(e) => setSetting('strokeWidth', parseFloat(e.target.value))}
            disabled={!transparentMode}
          />
        </label>
        <label>
          Shadow ({shadowStrength}px)
          <input
            type="range"
            min="0"
            max="20"
            value={shadowStrength}
            onChange={(e) => setSetting('shadowStrength', parseInt(e.target.value, 10))}
            disabled={!transparentMode}
          />
        </label>
        <label>
          Text Alignment:
          <select value={textAlign} onChange={(e) => setSetting('textAlign', e.target.value)}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="justify">Justify</option>
          </select>
        </label>
      </div>
      <div
        ref={containerRef}
        className="prompter-container"
        style={{
          padding: `2rem ${margin}px`,
          fontSize: `${fontSize}rem`,
          lineHeight,
          textAlign,
          transform: `scale(${mirrorX ? -1 : 1}, ${mirrorY ? -1 : 1})`,
          background: '#000',
          color: '#e0e0e0',
          textShadow:
            transparentMode && shadowStrength > 0
              ? `0 0 ${shadowStrength}px rgba(0,0,0,0.8)`
              : 'none',
          WebkitTextStroke:
            transparentMode && strokeWidth > 0 ? `${strokeWidth}px black` : '0',
          overflowY: notecardMode ? 'hidden' : 'scroll',
        }}
      >
        {!isEditing && !notecardMode && containerViewport.clientHeight > 0 && (
          <button
            type="button"
            className="speech-eyeline-marker"
            style={{ top: speechEyelineTop }}
            onMouseDown={handleSpeechEyelineMouseDown}
            aria-label="Adjust speech eyeline"
          >
            <span className="speech-eyeline-marker-label">Eyeline</span>
          </button>
        )}
        {!isEditing && speechOverlayRect && (
          <div
            className={`speech-follow-line-overlay overlay-source-${speechOverlayRect.source}`}
            style={{
              top: speechOverlayRect.lineTop,
              left: speechOverlayRect.lineLeft,
              width: speechOverlayRect.lineWidth,
              height: speechOverlayRect.lineHeight,
            }}
          >
            <span className="speech-follow-line-overlay-chip">
              {speechAlignmentFocus.token || speechDebug.lastCandidateMatch?.selectedHighlightToken || 'match'}
            </span>
          </div>
        )}
        {!isEditing && (
          <div
            key="render"
            ref={outputRef}
            className="script-output disable-links"
            dangerouslySetInnerHTML={{
              __html: notecardMode ? slides[currentSlide] || '' : content,
            }}
            style={{ userSelect: 'none' }}
          />
        )}
        <div
          key="editor"
          ref={editorContainerRef}
          className="editor-layer"
          style={{
            padding: `2rem ${margin}px`,
            boxSizing: 'border-box',
            display: isEditing ? 'block' : 'none',
            pointerEvents: isEditing ? 'auto' : 'none',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
          <TipTapEditor
            initialHtml={content}
            onUpdate={handleEdit}
            onReady={handleEditorReady}
            style={{
              fontSize: `${fontSize}rem`,
              lineHeight,
              textAlign,
            }}
          />
        </div>
      </div>
      {notecardMode && slides.length > 1 && (
        <div className="notecard-controls">
          <button onClick={() => setCurrentSlide(Math.max(currentSlide - 1, 0))}>
            Prev
          </button>
          <span className="notecard-index">
            {currentSlide + 1} / {slides.length}
          </span>
          <button
            onClick={() => setCurrentSlide(Math.min(currentSlide + 1, slides.length - 1))}
          >
            Next
          </button>
        </div>
      )}
      <button className={`edit-toggle${isEditing ? ' editing' : ''}`} onClick={toggleEditing}>
        {isEditing ? 'STOP EDITING' : 'EDIT'}
      </button>
    </div>
  )
}

export default Prompter
