const TARGET_SAMPLE_RATE = 16000
const CHUNK_DURATION_MS = 2200
const CHUNK_INTERVAL_MS = 900
const MIN_TRANSCRIBE_SECONDS = 0.7
const MAX_BUFFER_SECONDS = 6

export async function getAvailableAudioInputs() {
  if (!navigator?.mediaDevices?.enumerateDevices) return []

  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || 'Microphone ' + (index + 1),
      groupId: device.groupId,
    }))
}

function downsampleTo16k(input, inputSampleRate) {
  if (!input?.length) return new Float32Array(0)
  if (inputSampleRate === TARGET_SAMPLE_RATE) return new Float32Array(input)

  const ratio = inputSampleRate / TARGET_SAMPLE_RATE
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(outputLength)
  let outputIndex = 0
  let inputIndex = 0

  while (outputIndex < outputLength) {
    const nextInputIndex = Math.min(input.length, Math.round((outputIndex + 1) * ratio))
    let sum = 0
    let count = 0

    for (let index = inputIndex; index < nextInputIndex; index += 1) {
      sum += input[index]
      count += 1
    }

    output[outputIndex] = count ? sum / count : input[Math.min(inputIndex, input.length - 1)]
    outputIndex += 1
    inputIndex = nextInputIndex
  }

  return output
}

function appendSamples(existing, next, maxSamples) {
  if (!next?.length) return existing
  const combined = new Float32Array(existing.length + next.length)
  combined.set(existing, 0)
  combined.set(next, existing.length)
  if (combined.length <= maxSamples) return combined
  return combined.slice(combined.length - maxSamples)
}

function clampSample(value) {
  return Math.max(-1, Math.min(1, value))
}

function float32ToInt16(samples) {
  const output = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = clampSample(samples[index])
    output[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff)
  }
  return Array.from(output)
}

export function createLocalSpeechRecognizer({
  deviceId,
  onPartialText,
  onFinalText,
  onLevel,
  onStateChange,
  onError,
  onDebugEvent,
} = {}) {
  let stream = null
  let audioContext = null
  let sourceNode = null
  let analyser = null
  let processorNode = null
  let rafId = null
  let intervalId = null
  let running = false
  let stopping = false
  let currentDeviceId = deviceId || ''
  let audioBuffer = new Float32Array(0)
  let lastTranscript = ''
  let transcribing = false
  let queuedTranscription = false
  let chunkCounter = 0

  const emitState = (state) => onStateChange?.(state)
  const emitError = (message) => onError?.(message)
  const emitDebug = (event) => onDebugEvent?.({
    timestamp: new Date().toISOString(),
    ...event,
  })

  function stopLevelLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function clearTimers() {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  function stopMedia() {
    clearTimers()
    stopLevelLoop()
    if (processorNode) {
      processorNode.disconnect()
      processorNode.onaudioprocess = null
      processorNode = null
    }
    if (sourceNode) {
      sourceNode.disconnect()
      sourceNode = null
    }
    if (analyser) {
      analyser.disconnect()
      analyser = null
    }
    if (audioContext) {
      audioContext.close().catch(() => {})
      audioContext = null
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      stream = null
    }
    audioBuffer = new Float32Array(0)
    onLevel?.(0)
    emitDebug({ type: 'media_stopped' })
  }

  function startLevelLoop() {
    if (!analyser) return
    const data = new Uint8Array(analyser.fftSize)

    const tick = () => {
      if (!analyser) return
      analyser.getByteTimeDomainData(data)
      let sum = 0

      for (let index = 0; index < data.length; index += 1) {
        const normalized = (data[index] - 128) / 128
        sum += normalized * normalized
      }

      const rms = Math.sqrt(sum / data.length)
      onLevel?.(Math.min(1, rms * 4.5))
      rafId = requestAnimationFrame(tick)
    }

    tick()
  }

  async function setupMic() {
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Microphone capture is unavailable in this environment.')
    }

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    }

    if (currentDeviceId) {
      constraints.audio.deviceId = { exact: currentDeviceId }
    }

    stream = await navigator.mediaDevices.getUserMedia(constraints)

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCtor) {
      throw new Error('Audio processing is unavailable in this environment.')
    }

    audioContext = new AudioContextCtor()
    sourceNode = audioContext.createMediaStreamSource(stream)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.85
    processorNode = audioContext.createScriptProcessor(4096, 1, 1)
    processorNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      const downsampled = downsampleTo16k(input, audioContext.sampleRate)
      audioBuffer = appendSamples(
        audioBuffer,
        downsampled,
        TARGET_SAMPLE_RATE * MAX_BUFFER_SECONDS,
      )
    }

    sourceNode.connect(analyser)
    sourceNode.connect(processorNode)
    processorNode.connect(audioContext.destination)
    emitDebug({ type: 'mic_ready', deviceId: currentDeviceId || 'default', sampleRate: audioContext.sampleRate })
    startLevelLoop()
  }

  async function transcribeLatestChunk(forceFinal = false) {
    if (!running || transcribing) {
      if (running) queuedTranscription = true
      return
    }

    const minimumSamples = Math.round(TARGET_SAMPLE_RATE * MIN_TRANSCRIBE_SECONDS)
    if (audioBuffer.length < minimumSamples) return

    const desiredSamples = Math.round(TARGET_SAMPLE_RATE * (CHUNK_DURATION_MS / 1000))
    const chunk = audioBuffer.slice(Math.max(0, audioBuffer.length - desiredSamples))
    const sampleCount = chunk.length
    const chunkSeconds = sampleCount / TARGET_SAMPLE_RATE
    let rmsSum = 0
    for (let index = 0; index < chunk.length; index += 1) {
      rmsSum += chunk[index] * chunk[index]
    }
    const rms = sampleCount ? Math.sqrt(rmsSum / sampleCount) : 0
    chunkCounter += 1
    const chunkId = String(chunkCounter).padStart(4, '0')
    transcribing = true
    queuedTranscription = false
    emitDebug({ type: 'chunk_queued', chunkId, chunkSeconds, sampleCount, rms, forceFinal })

    try {
      const response = await window.electronAPI?.transcribeWhisperChunk?.({
        chunkId,
        samples: float32ToInt16(chunk),
        sampleRate: TARGET_SAMPLE_RATE,
        language: 'en',
        saveDebugAudio: import.meta.env.DEV,
        blankToken: '[BLANK_AUDIO]',
      })

      if (!response?.ok) {
        emitDebug({
          type: 'transcription_error',
          chunkId,
          chunkSeconds,
          durationMs: response?.durationMs || 0,
          message: response?.message || 'Local whisper transcription failed.',
          rawOutput: response?.rawOutput || '',
          stderr: response?.stderr || '',
          wavPath: response?.wavPath || '',
        })
        throw new Error(response?.message || 'Local whisper transcription failed.')
      }

      const transcript = String(response.text || '').trim()
      emitDebug({
        type: 'transcription_result',
        chunkId,
        chunkSeconds,
        sampleCount,
        rms,
        durationMs: response?.durationMs || 0,
        transcript,
        rawOutput: response?.rawOutput || '',
        stderr: response?.stderr || '',
        wavPath: response?.wavPath || '',
        isBlank: Boolean(response?.isBlank),
        executablePath: response?.executablePath || '',
        modelPath: response?.modelPath || '',
      })
      if (!transcript) {
        emitState('listening')
        return
      }

      emitState('hearing_speech')
      if (transcript !== lastTranscript) {
        lastTranscript = transcript
        onPartialText?.(transcript)
      }
      if (forceFinal) {
        onFinalText?.(transcript)
      }
    } catch (error) {
      emitError(error?.message || 'Local whisper transcription failed.')
      emitState('mic_error')
    } finally {
      transcribing = false
      if (queuedTranscription && running && !stopping) {
        transcribeLatestChunk(forceFinal)
      }
    }
  }

  async function ensureWhisperConfigured() {
    const config = await window.electronAPI?.getWhisperConfig?.()
    if (!config?.configured) {
      emitError('Local speech follow is not installed in this app build yet.')
      emitState('mic_error')
      return false
    }
    return true
  }

  async function start() {
    if (running) return { ok: true }
    if (!window.electronAPI?.transcribeWhisperChunk || !window.electronAPI?.getWhisperConfig) {
      emitError('Local whisper transcription is unavailable in this build.')
      emitState('mic_error')
      return { ok: false, reason: 'unsupported' }
    }

    const configured = await ensureWhisperConfigured()
    if (!configured) return { ok: false, reason: 'not_configured' }

    try {
      await setupMic()
    } catch (error) {
      emitError(error?.message || 'Unable to access microphone.')
      emitState('mic_error')
      stopMedia()
      return { ok: false, reason: 'mic_error' }
    }

    running = true
    stopping = false
    lastTranscript = ''
    emitDebug({ type: 'recognizer_started', deviceId: currentDeviceId || 'default' })
    emitState('listening')
    intervalId = setInterval(() => {
      transcribeLatestChunk(false)
    }, CHUNK_INTERVAL_MS)

    return { ok: true }
  }

  async function stop() {
    if (!running && !transcribing) {
      stopMedia()
      emitState('idle')
      return
    }

    stopping = true
    clearTimers()
    await transcribeLatestChunk(true)
    running = false
    stopMedia()
    emitDebug({ type: 'recognizer_stopped' })
    emitState('idle')
  }

  async function restart(nextDeviceId) {
    currentDeviceId = nextDeviceId || ''
    await stop()
    stopping = false
    return start()
  }

  function destroy() {
    stopping = true
    running = false
    clearTimers()
    stopMedia()
  }

  async function debugTranscribeNow() {
    await transcribeLatestChunk(true)
  }

  return {
    supported: Boolean(window.electronAPI?.transcribeWhisperChunk),
    start,
    stop,
    restart,
    destroy,
    debugTranscribeNow,
  }
}
