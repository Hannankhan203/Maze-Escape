/**
 * Procedural Web Audio synthesis primitives and horror cue recipes for 3D Maze Escape.
 * Zero external audio file dependencies — every sound is synthesized via Web Audio nodes.
 */

function setParamSmooth(param, value, now, tau = 0.03) {
  if (!param) return
  if (typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, now, tau)
  } else if (typeof param.setValueAtTime === 'function') {
    param.setValueAtTime(value, now)
  } else {
    param.value = value
  }
}

export function createNoiseBuffer(ctx, durationSec = 2.0) {
  if (!ctx || typeof ctx.createBuffer !== 'function') return null
  const sampleRate = ctx.sampleRate || 44100
  const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 2.0
  const length = Math.max(1, Math.floor(sampleRate * safeDuration))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  // Mildly pink-tinted procedural noise for organic footsteps, wind, and metal textures
  const overlap =
    length >= 64 ? Math.min(Math.floor(sampleRate * 0.03), Math.floor(length / 4)) : 0
  let b0 = 0
  let b1 = 0
  let b2 = 0
  const nextSample = () => {
    const white = Math.random() * 2 - 1
    b0 = 0.997 * b0 + white * 0.029
    b1 = 0.985 * b1 + white * 0.032
    b2 = 0.950 * b2 + white * 0.048
    return Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.18) * 0.7))
  }

  for (let i = 0; i < length; i += 1) {
    data[i] = nextSample()
  }

  // Equal-power crossfade of extra tail samples into the head for click-free looping
  if (overlap > 1) {
    for (let i = 0; i < overlap; i += 1) {
      const tailSample = nextSample()
      const t = i / (overlap - 1)
      const fadeIn = Math.sin(t * Math.PI * 0.5)
      const fadeOut = Math.cos(t * Math.PI * 0.5)
      let blended = data[i] * fadeIn + tailSample * fadeOut
      if (i === 0) {
        blended = data[length - 1] * 0.5 + blended * 0.5
      }
      data[i] = Math.max(-1, Math.min(1, blended))
    }
  }

  return buffer
}

export function playToneBurst(
  ctx,
  dest,
  {
    type = 'sine',
    freqStart = 120,
    freqEnd = 80,
    freqSteps = null,
    duration = 0.25,
    attack = 0.01,
    gain = 0.3,
    gainSteps = null,
    filterType = null,
    filterFreq = 1800,
    filterFreqEnd = null,
    filterSteps = null,
    filterQ = 1.0,
    delay = 0,
  } = {}
) {
  if (!ctx || !dest || typeof ctx.createOscillator !== 'function') return null
  const now = (ctx.currentTime || 0) + Math.max(0, Number.isFinite(delay) ? delay : 0)
  const safeDur = Math.max(0.03, Number.isFinite(duration) ? duration : 0.25)
  const osc = ctx.createOscillator()
  const gainNode = ctx.createGain()

  osc.type = type
  if (osc.frequency) {
    osc.frequency.setValueAtTime?.(Math.max(20, freqStart), now)
    if (Array.isArray(freqSteps) && freqSteps.length > 0 && typeof osc.frequency.exponentialRampToValueAtTime === 'function') {
      let prevTime = now
      for (let i = 0; i < freqSteps.length; i += 1) {
        const step = freqSteps[i]
        const stepTime = Math.max(
          prevTime + 0.002,
          now + Math.max(0.002, Math.min(1, Number(step?.at) || 0) * safeDur)
        )
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, Number(step?.freq) || freqStart), stepTime)
        prevTime = stepTime
      }
    } else if (freqEnd !== freqStart && typeof osc.frequency.exponentialRampToValueAtTime === 'function') {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + safeDur)
    }
  }

  if (gainNode.gain) {
    gainNode.gain.setValueAtTime?.(0.0001, now)
    if (Array.isArray(gainSteps) && gainSteps.length > 0) {
      let prevTime = now
      for (let i = 0; i < gainSteps.length; i += 1) {
        const step = gainSteps[i]
        const stepTime = Math.max(
          prevTime + 0.002,
          now + Math.max(0.002, Math.min(0.96, Number(step?.at) || 0) * safeDur)
        )
        if (stepTime < now + safeDur - 0.002) {
          gainNode.gain.linearRampToValueAtTime?.(Math.max(0.0001, Number(step?.gain) || 0.0001), stepTime)
          prevTime = stepTime
        }
      }
      gainNode.gain.exponentialRampToValueAtTime?.(0.0001, now + safeDur)
    } else {
      gainNode.gain.linearRampToValueAtTime?.(Math.max(0.001, gain), now + Math.min(attack, safeDur * 0.4))
      gainNode.gain.exponentialRampToValueAtTime?.(0.0001, now + safeDur)
    }
  }

  let filter = null
  if (filterType && typeof ctx.createBiquadFilter === 'function') {
    filter = ctx.createBiquadFilter()
    filter.type = filterType
    filter.frequency?.setValueAtTime?.(Math.max(40, filterFreq), now)
    if (
      Array.isArray(filterSteps) &&
      filterSteps.length > 0 &&
      typeof filter.frequency?.exponentialRampToValueAtTime === 'function'
    ) {
      let prevTime = now
      for (let i = 0; i < filterSteps.length; i += 1) {
        const step = filterSteps[i]
        const stepTime = Math.max(
          prevTime + 0.002,
          now + Math.max(0.002, Math.min(1, Number(step?.at) || 0) * safeDur)
        )
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, Number(step?.freq) || filterFreq), stepTime)
        prevTime = stepTime
      }
    } else if (
      filterFreqEnd &&
      filterFreqEnd !== filterFreq &&
      typeof filter.frequency?.exponentialRampToValueAtTime === 'function'
    ) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterFreqEnd), now + safeDur)
    }
    if (filter.Q) filter.Q.value = filterQ
    osc.connect(filter)
    filter.connect(gainNode)
  } else {
    osc.connect(gainNode)
  }

  gainNode.connect(dest)

  osc.onended = () => {
    try {
      osc.disconnect()
      filter?.disconnect()
      gainNode.disconnect()
    } catch {
      // Ignore disconnect errors on already-cleaned nodes
    }
  }

  osc.start?.(now)
  osc.stop?.(now + safeDur + 0.02)
  return osc
}

export function playNoiseBurst(
  ctx,
  dest,
  noiseBuffer,
  {
    duration = 0.16,
    attack = 0.005,
    gain = 0.25,
    gainSteps = null,
    filterType = 'bandpass',
    filterFreq = 600,
    filterFreqEnd = null,
    filterSteps = null,
    filterQ = 1.2,
    delay = 0,
    offset = 0,
  } = {}
) {
  if (
    !ctx ||
    !dest ||
    !noiseBuffer ||
    typeof ctx.createBufferSource !== 'function'
  ) {
    return null
  }

  const now = (ctx.currentTime || 0) + Math.max(0, Number.isFinite(delay) ? delay : 0)
  const safeDur = Math.max(0.03, Number.isFinite(duration) ? duration : 0.16)
  const playDuration = safeDur + 0.02
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer

  const gainNode = ctx.createGain()
  if (gainNode.gain) {
    gainNode.gain.setValueAtTime?.(0.0001, now)
    if (Array.isArray(gainSteps) && gainSteps.length > 0) {
      let prevTime = now
      for (let i = 0; i < gainSteps.length; i += 1) {
        const step = gainSteps[i]
        const stepTime = Math.max(
          prevTime + 0.002,
          now + Math.max(0.002, Math.min(0.96, Number(step?.at) || 0) * safeDur)
        )
        if (stepTime < now + safeDur - 0.002) {
          gainNode.gain.linearRampToValueAtTime?.(Math.max(0.0001, Number(step?.gain) || 0.0001), stepTime)
          prevTime = stepTime
        }
      }
      gainNode.gain.exponentialRampToValueAtTime?.(0.0001, now + safeDur)
    } else {
      gainNode.gain.linearRampToValueAtTime?.(Math.max(0.001, gain), now + Math.min(attack, safeDur * 0.35))
      gainNode.gain.exponentialRampToValueAtTime?.(0.0001, now + safeDur)
    }
  }

  let filter = null
  if (typeof ctx.createBiquadFilter === 'function') {
    filter = ctx.createBiquadFilter()
    filter.type = filterType
    filter.frequency?.setValueAtTime?.(Math.max(40, filterFreq), now)
    if (
      Array.isArray(filterSteps) &&
      filterSteps.length > 0 &&
      typeof filter.frequency?.exponentialRampToValueAtTime === 'function'
    ) {
      let prevTime = now
      for (let i = 0; i < filterSteps.length; i += 1) {
        const step = filterSteps[i]
        const stepTime = Math.max(
          prevTime + 0.002,
          now + Math.max(0.002, Math.min(1, Number(step?.at) || 0) * safeDur)
        )
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, Number(step?.freq) || filterFreq), stepTime)
        prevTime = stepTime
      }
    } else if (
      filterFreqEnd &&
      filterFreqEnd !== filterFreq &&
      typeof filter.frequency?.exponentialRampToValueAtTime === 'function'
    ) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterFreqEnd), now + safeDur)
    }
    if (filter.Q) filter.Q.value = filterQ
    src.connect(filter)
    filter.connect(gainNode)
  } else {
    src.connect(gainNode)
  }

  gainNode.connect(dest)

  src.onended = () => {
    try {
      src.disconnect()
      filter?.disconnect()
      gainNode.disconnect()
    } catch {
      // Ignore disconnect errors on cleanup
    }
  }

  const bufferDuration =
    Number.isFinite(noiseBuffer.duration) && noiseBuffer.duration > 0
      ? noiseBuffer.duration
      : Number.isFinite(noiseBuffer.length) &&
          noiseBuffer.length > 0 &&
          Number.isFinite(noiseBuffer.sampleRate) &&
          noiseBuffer.sampleRate > 0
        ? noiseBuffer.length / noiseBuffer.sampleRate
        : 2.0
  const requestedOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0
  const needsLoop = playDuration > bufferDuration

  if (needsLoop) {
    const startOffset = bufferDuration > 0 ? requestedOffset % bufferDuration : 0
    src.loop = true
    src.loopStart = 0
    src.loopEnd = bufferDuration
    src.start?.(now, startOffset)
    src.stop?.(now + playDuration)
  } else {
    const maxOffset = Math.max(0, bufferDuration - playDuration)
    const startOffset = Math.min(maxOffset, requestedOffset)
    src.loop = false
    src.start?.(now, startOffset, playDuration)
  }

  return src
}

function createCueBusHandle(
  ctx,
  dest,
  {
    cueGainValue = 1,
    highpassHz = 0,
    lowpassHz = 0,
    durationSec = 1.0,
    kind = null,
    variant = null,
    onComplete = null,
    onStop = null,
  } = {}
) {
  const nodes = []
  const busNodes = []
  let cueGain = null
  let stopped = false
  let disconnected = false
  let remaining = 0
  let completed = false
  let stopHookCalled = false

  const now = ctx.currentTime || 0
  const endTime = now + Math.max(0, Number(durationSec) || 0)
  if (typeof ctx.createGain === 'function') {
    cueGain = ctx.createGain()
    if (cueGain.gain) {
      cueGain.gain.setValueAtTime?.(cueGainValue, now)
    }
    cueGain.connect(dest)
    busNodes.push(cueGain)
  }

  let target = cueGain || dest
  if (typeof ctx.createBiquadFilter === 'function') {
    if (lowpassHz > 0) {
      const lpFilter = ctx.createBiquadFilter()
      lpFilter.type = 'lowpass'
      lpFilter.frequency?.setValueAtTime?.(lowpassHz, now)
      if (lpFilter.Q) lpFilter.Q.value = 0.7
      lpFilter.connect(target)
      busNodes.push(lpFilter)
      target = lpFilter
    }
    if (highpassHz > 0) {
      const hpFilter = ctx.createBiquadFilter()
      hpFilter.type = 'highpass'
      hpFilter.frequency?.setValueAtTime?.(highpassHz, now)
      if (hpFilter.Q) hpFilter.Q.value = 0.65
      hpFilter.connect(target)
      busNodes.push(hpFilter)
      target = hpFilter
    }
  }

  const invokeOnStop = (immediate) => {
    if (stopHookCalled) return
    stopHookCalled = true
    try {
      onStop?.(immediate)
    } catch {
      // Ignore cleanup hook errors
    }
  }

  const notifyComplete = () => {
    if (completed) return
    completed = true
    onComplete?.()
  }

  const disconnectAll = () => {
    if (disconnected) return
    disconnected = true
    invokeOnStop(true)
    for (let i = 0; i < nodes.length; i += 1) {
      try {
        nodes[i]?.disconnect?.()
      } catch {
        // Ignore already-disconnected errors
      }
    }
    nodes.length = 0
    for (let i = 0; i < busNodes.length; i += 1) {
      try {
        busNodes[i]?.disconnect?.()
      } catch {
        // Ignore already-disconnected bus node errors
      }
    }
    busNodes.length = 0
    notifyComplete()
  }

  return {
    target,
    durationSec,
    kind,
    variant,
    isActive() {
      if (disconnected || stopped) return false
      if (Number.isFinite(ctx?.currentTime) && ctx.currentTime >= endTime) {
        return false
      }
      return true
    },
    getNodeCount() {
      return nodes.length
    },
    trackBusNode(node) {
      if (!node) return null
      busNodes.push(node)
      return node
    },
    track(node) {
      if (!node) return null
      nodes.push(node)
      remaining += 1
      const prevOnEnded = node.onended
      let ended = false
      node.onended = () => {
        if (ended) return
        ended = true
        try {
          prevOnEnded?.()
        } finally {
          remaining -= 1
          if (remaining <= 0 && !stopped) {
            disconnectAll()
          }
        }
      }
      return node
    },
    stop(options = {}) {
      const immediate = Boolean(options?.immediate)
      const scheduleDisconnect =
        typeof options?.scheduleDisconnect === 'function' ? options.scheduleDisconnect : null
      const delayMs = Math.max(20, Number(options?.delayMs) || 55)
      if (disconnected) return
      if (stopped) {
        if (immediate) {
          disconnectAll()
        }
        return
      }
      stopped = true
      invokeOnStop(immediate)
      const t = ctx.currentTime || 0
      if (cueGain?.gain) {
        try {
          cueGain.gain.cancelScheduledValues?.(t)
          if (immediate || typeof cueGain.gain.setTargetAtTime !== 'function') {
            cueGain.gain.setValueAtTime?.(0.0001, t)
          } else {
            cueGain.gain.setTargetAtTime(0.0001, t, 0.015)
          }
        } catch {
          // Ignore mock AudioParam errors
        }
      }
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]
        try {
          node?.stop?.(immediate ? t : t + 0.045)
        } catch {
          // Ignore already-stopped source errors
        }
      }
      if (immediate) {
        disconnectAll()
      } else if (scheduleDisconnect) {
        scheduleDisconnect(disconnectAll, delayMs)
      } else {
        notifyComplete()
      }
    },
  }
}

export const ENEMY_AUDIO_CATEGORIES = Object.freeze({
  ALERT_INVESTIGATE: 'alert_investigate',
  ALERT_CHASE: 'alert_chase',
  ATTACK_WINDUP: 'attack_windup',
  ATTACK_HIT: 'attack_hit',
  FOOTSTEP: 'footstep',
  VOCAL: 'vocal',
  BREATH: 'breath',
})

export const ENEMY_AUDIO_PRIORITIES = Object.freeze({
  [ENEMY_AUDIO_CATEGORIES.FOOTSTEP]: 1,
  [ENEMY_AUDIO_CATEGORIES.BREATH]: 1,
  [ENEMY_AUDIO_CATEGORIES.ALERT_INVESTIGATE]: 2,
  [ENEMY_AUDIO_CATEGORIES.ALERT_CHASE]: 2,
  [ENEMY_AUDIO_CATEGORIES.VOCAL]: 3,
  [ENEMY_AUDIO_CATEGORIES.ATTACK_WINDUP]: 4,
  [ENEMY_AUDIO_CATEGORIES.ATTACK_HIT]: 5,
})

export const ENEMY_ALERT_SPECS = Object.freeze({
  stalker: Object.freeze({
    identity: 'spectral_chime',
    investigate: Object.freeze({
      durationSec: 0.14,
      layers: Object.freeze([
        Object.freeze({
          type: 'sine',
          freqStart: 780,
          freqEnd: 690,
          duration: 0.14,
          attack: 0.025,
          gain: 0.058,
          filterType: 'bandpass',
          filterFreq: 740,
          filterQ: 1.5,
        }),
      ]),
    }),
    chase: Object.freeze({
      durationSec: 0.3,
      layers: Object.freeze([
        Object.freeze({
          type: 'sine',
          freqStart: 587,
          freqEnd: 554,
          duration: 0.28,
          attack: 0.006,
          gain: 0.16,
        }),
        Object.freeze({
          type: 'triangle',
          freqStart: 1245,
          freqEnd: 1175,
          duration: 0.22,
          attack: 0.004,
          gain: 0.1,
          filterType: 'highpass',
          filterFreq: 720,
        }),
        Object.freeze({
          type: 'sine',
          freqStart: 294,
          freqEnd: 277,
          duration: 0.26,
          attack: 0.008,
          gain: 0.13,
        }),
      ]),
    }),
  }),
  hunter: Object.freeze({
    identity: 'dual_telemetry_ping',
    investigate: Object.freeze({
      durationSec: 0.15,
      layers: Object.freeze([
        Object.freeze({
          type: 'sine',
          freqStart: 1280,
          freqEnd: 1410,
          duration: 0.065,
          attack: 0.012,
          gain: 0.048,
        }),
        Object.freeze({
          type: 'sine',
          freqStart: 1350,
          freqEnd: 1180,
          duration: 0.07,
          attack: 0.012,
          gain: 0.036,
          delay: 0.075,
        }),
      ]),
    }),
    chase: Object.freeze({
      durationSec: 0.27,
      layers: Object.freeze([
        Object.freeze({
          type: 'triangle',
          freqStart: 980,
          freqEnd: 1180,
          duration: 0.085,
          attack: 0.003,
          gain: 0.16,
          filterType: 'bandpass',
          filterFreq: 1350,
          filterQ: 1.4,
        }),
        Object.freeze({
          type: 'sine',
          freqStart: 1480,
          freqEnd: 1390,
          duration: 0.16,
          attack: 0.003,
          gain: 0.18,
          delay: 0.095,
        }),
        Object.freeze({
          type: 'triangle',
          freqStart: 740,
          freqEnd: 695,
          duration: 0.13,
          attack: 0.004,
          gain: 0.11,
          delay: 0.095,
        }),
      ]),
    }),
  }),
  brute: Object.freeze({
    identity: 'industrial_relay_pulse',
    investigate: Object.freeze({
      durationSec: 0.16,
      layers: Object.freeze([
        Object.freeze({
          type: 'sine',
          freqStart: 185,
          freqEnd: 142,
          duration: 0.16,
          attack: 0.035,
          gain: 0.068,
          filterType: 'lowpass',
          filterFreq: 320,
        }),
      ]),
    }),
    chase: Object.freeze({
      durationSec: 0.32,
      layers: Object.freeze([
        Object.freeze({
          type: 'triangle',
          freqStart: 215,
          freqEnd: 96,
          duration: 0.18,
          attack: 0.004,
          gain: 0.22,
          filterType: 'bandpass',
          filterFreq: 390,
          filterQ: 1.2,
        }),
        Object.freeze({
          type: 'sine',
          freqStart: 124,
          freqEnd: 62,
          duration: 0.28,
          attack: 0.005,
          gain: 0.22,
        }),
        Object.freeze({
          type: 'triangle',
          freqStart: 320,
          freqEnd: 302,
          duration: 0.26,
          attack: 0.008,
          gain: 0.12,
          filterType: 'lowpass',
          filterFreq: 920,
          delay: 0.025,
        }),
      ]),
    }),
  }),
})

function normalizeAlertEnemyType(enemyType) {
  return enemyType === 'hunter' || enemyType === 'brute' ? enemyType : 'stalker'
}

/**
 * Creates a lifecycle-managed enemy audio cue handle that tracks every scheduled
 * Web Audio source and bus node so HorrorAudioEngine can enforce concurrency caps
 * and cleanly cancel/disconnect in-flight enemy audio on pause, reset, or dispose.
 */
export function createEnemyCueHandle(
  ctx,
  dest,
  {
    cueGainValue = 1,
    highpassHz = 0,
    lowpassHz = 0,
    durationSec = 0.5,
    kind = 'enemy_cue',
    variant = 'stalker',
    category = ENEMY_AUDIO_CATEGORIES.VOCAL,
    enemyId = null,
    enemyType = 'stalker',
    priority = 1,
    onComplete = null,
    onStop = null,
  } = {}
) {
  const handle = createCueBusHandle(ctx, dest, {
    cueGainValue,
    highpassHz,
    lowpassHz,
    durationSec,
    kind,
    variant,
    onComplete,
    onStop,
  })
  handle.category = category
  handle.enemyId = enemyId
  handle.enemyType = enemyType
  handle.priority = priority
  return handle
}

/**
 * Reusable single-source PCM playback helper reserved for future Phase 2-5
 * occasional enemy-specific vocalizations routed through HorrorAudioEngine.enemyVocalGain.
 */
export function playEnemyPcmBufferCue(
  ctx,
  dest,
  pcmBuffer,
  {
    delaySec = 0,
    cueGainValue = 0.85,
    highpassHz = 55,
    lowpassHz = 7800,
    kind = 'enemy_vocal',
    variant = 'default',
    enemyId = null,
    enemyType = 'stalker',
    priority = 2,
    onComplete = null,
    onStop = null,
  } = {}
) {
  if (!ctx || !dest || !pcmBuffer || typeof ctx.createBufferSource !== 'function') return null
  const safeDelay = Math.max(0, Number.isFinite(delaySec) ? delaySec : 0)
  const bufDuration =
    Number.isFinite(pcmBuffer.duration) && pcmBuffer.duration > 0
      ? pcmBuffer.duration
      : pcmBuffer.length / (pcmBuffer.sampleRate || ctx.sampleRate || 44100)
  const now = (ctx.currentTime || 0) + safeDelay

  const handle = createEnemyCueHandle(ctx, dest, {
    cueGainValue,
    highpassHz,
    lowpassHz,
    durationSec: safeDelay + bufDuration,
    kind,
    variant,
    category: ENEMY_AUDIO_CATEGORIES.VOCAL,
    enemyId,
    enemyType,
    priority,
    onComplete,
    onStop,
  })
  handle.pcmBuffer = pcmBuffer

  const src = ctx.createBufferSource()
  src.buffer = pcmBuffer
  src.loop = false
  src.connect(handle.target)
  src.start?.(now)
  src.stop?.(now + bufDuration + 0.005)
  handle.track(src)

  return handle
}

export function triggerEnemyFootstep(
  ctx,
  dest,
  noiseBuffer,
  isChasing = false,
  enemyType = 'stalker',
  options = {}
) {
  if (!ctx || !dest) return null
  const normalizedType = normalizeAlertEnemyType(enemyType)
  const durationSec =
    normalizedType === 'brute'
      ? isChasing
        ? 0.22
        : 0.28
      : normalizedType === 'hunter'
        ? isChasing
          ? 0.09
          : 0.12
        : isChasing
          ? 0.14
          : 0.19

  const handle = createEnemyCueHandle(ctx, dest, {
    durationSec,
    kind: 'enemy_footstep',
    variant: normalizedType,
    category: ENEMY_AUDIO_CATEGORIES.FOOTSTEP,
    enemyId: options?.enemyId ?? null,
    enemyType: normalizedType,
    priority: Number.isFinite(Number(options?.priority))
      ? Number(options.priority)
      : ENEMY_AUDIO_PRIORITIES[ENEMY_AUDIO_CATEGORIES.FOOTSTEP],
    onComplete: options?.onComplete,
  })

  if (normalizedType === 'brute') {
    // Lumbering heavy sub-bass stomp + concrete grit
    handle.track(
      playToneBurst(ctx, handle.target, {
        type: 'sine',
        freqStart: isChasing ? 66 : 54,
        freqEnd: 24,
        duration: isChasing ? 0.22 : 0.28,
        attack: 0.008,
        gain: isChasing ? 0.56 : 0.42,
      })
    )
    handle.track(
      playNoiseBurst(ctx, handle.target, noiseBuffer, {
        duration: isChasing ? 0.16 : 0.2,
        gain: isChasing ? 0.34 : 0.22,
        filterType: 'lowpass',
        filterFreq: isChasing ? 320 : 240,
        offset: Math.random() * 1.2,
      })
    )
    return handle
  }

  if (normalizedType === 'hunter') {
    // Quick sharp chitin/clawed metallic taps
    handle.track(
      playToneBurst(ctx, handle.target, {
        type: 'triangle',
        freqStart: isChasing ? 185 : 145,
        freqEnd: 68,
        duration: isChasing ? 0.09 : 0.12,
        attack: 0.003,
        gain: isChasing ? 0.3 : 0.2,
      })
    )
    handle.track(
      playNoiseBurst(ctx, handle.target, noiseBuffer, {
        duration: 0.08,
        gain: isChasing ? 0.24 : 0.14,
        filterType: 'highpass',
        filterFreq: isChasing ? 1150 : 860,
        offset: Math.random() * 1.2,
      })
    )
    return handle
  }

  // Heavy metallic/concrete stalker step
  handle.track(
    playToneBurst(ctx, handle.target, {
      type: 'triangle',
      freqStart: isChasing ? 96 : 74,
      freqEnd: 34,
      duration: isChasing ? 0.14 : 0.19,
      attack: 0.006,
      gain: isChasing ? 0.42 : 0.28,
    })
  )
  handle.track(
    playNoiseBurst(ctx, handle.target, noiseBuffer, {
      duration: isChasing ? 0.11 : 0.15,
      gain: isChasing ? 0.28 : 0.16,
      filterType: 'bandpass',
      filterFreq: isChasing ? 520 : 340,
      filterQ: 1.5,
      offset: Math.random() * 1.2,
    })
  )
  return handle
}

export function triggerPlayerFootstep(ctx, dest, noiseBuffer, isSprinting = false) {
  playToneBurst(ctx, dest, {
    type: 'sine',
    freqStart: isSprinting ? 115 : 88,
    freqEnd: 46,
    duration: 0.08,
    attack: 0.004,
    gain: isSprinting ? 0.18 : 0.1,
  })
  playNoiseBurst(ctx, dest, noiseBuffer, {
    duration: isSprinting ? 0.09 : 0.07,
    gain: isSprinting ? 0.14 : 0.08,
    filterType: 'lowpass',
    filterFreq: isSprinting ? 950 : 620,
    offset: Math.random() * 1.4,
  })
}

export function triggerEnemyAlertCue(
  ctx,
  dest,
  isChase = true,
  enemyType = 'stalker',
  options = {}
) {
  if (!ctx || !dest) return null
  const normalizedType = normalizeAlertEnemyType(enemyType)
  const archetypeSpec = ENEMY_ALERT_SPECS[normalizedType]
  const modeKey = isChase ? 'chase' : 'investigate'
  const spec = archetypeSpec[modeKey]

  const category = isChase
    ? ENEMY_AUDIO_CATEGORIES.ALERT_CHASE
    : ENEMY_AUDIO_CATEGORIES.ALERT_INVESTIGATE
  const handle = createEnemyCueHandle(ctx, dest, {
    cueGainValue:
      Number.isFinite(Number(options?.cueGainValue)) && Number(options.cueGainValue) > 0
        ? Number(options.cueGainValue)
        : 1,
    durationSec: spec.durationSec,
    kind: isChase ? 'enemy_detect_chase' : 'enemy_detect_investigate',
    variant: normalizedType,
    category,
    enemyId: options?.enemyId ?? null,
    enemyType: normalizedType,
    priority: Number.isFinite(Number(options?.priority))
      ? Number(options.priority)
      : ENEMY_AUDIO_PRIORITIES[category],
    onComplete: options?.onComplete,
  })
  handle.isChase = Boolean(isChase)
  handle.identity = archetypeSpec.identity

  for (let i = 0; i < spec.layers.length; i += 1) {
    handle.track(playToneBurst(ctx, handle.target, spec.layers[i]))
  }

  return handle
}

export function triggerEnemyAttackCue(
  ctx,
  dest,
  noiseBuffer,
  isImpact = false,
  enemyType = 'stalker',
  options = {}
) {
  if (!ctx || !dest) return null
  const normalizedType = normalizeAlertEnemyType(enemyType)
  const durationSec =
    normalizedType === 'brute'
      ? 0.38
      : normalizedType === 'hunter'
        ? isImpact
          ? 0.21
          : 0.18
        : isImpact
          ? 0.24
          : 0.26

  const attackCategory = isImpact
    ? ENEMY_AUDIO_CATEGORIES.ATTACK_HIT
    : ENEMY_AUDIO_CATEGORIES.ATTACK_WINDUP
  const handle = createEnemyCueHandle(ctx, dest, {
    durationSec,
    kind: isImpact ? 'enemy_attack_hit' : 'enemy_attack_windup',
    variant: normalizedType,
    category: attackCategory,
    enemyId: options?.enemyId ?? null,
    enemyType: normalizedType,
    priority: Number.isFinite(Number(options?.priority))
      ? Number(options.priority)
      : ENEMY_AUDIO_PRIORITIES[attackCategory],
    onComplete: options?.onComplete,
  })

  if (normalizedType === 'brute') {
    if (isImpact) {
      handle.track(
        playToneBurst(ctx, handle.target, {
          type: 'sine',
          freqStart: 110,
          freqEnd: 26,
          duration: 0.36,
          attack: 0.004,
          gain: 0.58,
        })
      )
      handle.track(
        playNoiseBurst(ctx, handle.target, noiseBuffer, {
          duration: 0.28,
          gain: 0.46,
          filterType: 'lowpass',
          filterFreq: 760,
          filterFreqEnd: 160,
        })
      )
    } else {
      handle.track(
        playToneBurst(ctx, handle.target, {
          type: 'sawtooth',
          freqStart: 85,
          freqEnd: 125,
          duration: 0.36,
          attack: 0.04,
          gain: 0.28,
          filterType: 'lowpass',
          filterFreq: 520,
        })
      )
    }
    return handle
  }

  if (normalizedType === 'hunter') {
    if (isImpact) {
      handle.track(
        playNoiseBurst(ctx, handle.target, noiseBuffer, {
          duration: 0.14,
          gain: 0.38,
          filterType: 'bandpass',
          filterFreq: 2200,
          filterFreqEnd: 700,
          filterQ: 1.4,
        })
      )
      handle.track(
        playNoiseBurst(ctx, handle.target, noiseBuffer, {
          duration: 0.12,
          gain: 0.3,
          filterType: 'highpass',
          filterFreq: 1800,
          delay: 0.07,
        })
      )
    } else {
      handle.track(
        playNoiseBurst(ctx, handle.target, noiseBuffer, {
          duration: 0.18,
          gain: 0.26,
          filterType: 'highpass',
          filterFreq: 1800,
          filterFreqEnd: 3200,
          filterQ: 2.6,
        })
      )
    }
    return handle
  }

  if (isImpact) {
    handle.track(
      playNoiseBurst(ctx, handle.target, noiseBuffer, {
        duration: 0.22,
        gain: 0.42,
        filterType: 'bandpass',
        filterFreq: 1650,
        filterFreqEnd: 420,
        filterQ: 1.1,
      })
    )
    handle.track(
      playToneBurst(ctx, handle.target, {
        type: 'sawtooth',
        freqStart: 190,
        freqEnd: 52,
        duration: 0.2,
        attack: 0.004,
        gain: 0.38,
        filterType: 'lowpass',
        filterFreq: 950,
      })
    )
  } else {
    // Claw windup rasp
    handle.track(
      playNoiseBurst(ctx, handle.target, noiseBuffer, {
        duration: 0.24,
        gain: 0.26,
        filterType: 'highpass',
        filterFreq: 1400,
        filterFreqEnd: 2600,
        filterQ: 2.2,
      })
    )
    handle.track(
      playToneBurst(ctx, handle.target, {
        type: 'sawtooth',
        freqStart: 140,
        freqEnd: 260,
        duration: 0.22,
        attack: 0.02,
        gain: 0.22,
        filterType: 'bandpass',
        filterFreq: 900,
      })
    )
  }
  return handle
}

export const ENEMY_VOCAL_SPECS = Object.freeze({
  stalker: Object.freeze({
    identity: 'whisper_growl',
    variants: Object.freeze({
      growl: Object.freeze({
        durationSec: 0.42,
        layers: Object.freeze([
          Object.freeze({
            type: 'sine',
            freqStart: 125,
            freqEnd: 95,
            duration: 0.42,
            attack: 0.04,
            gain: 0.18,
            filterType: 'bandpass',
            filterFreq: 420,
            filterQ: 2.2,
          }),
          Object.freeze({
            type: 'triangle',
            freqStart: 185,
            freqEnd: 140,
            duration: 0.35,
            attack: 0.05,
            gain: 0.11,
            filterType: 'highpass',
            filterFreq: 320,
          }),
        ]),
      }),
      snarl: Object.freeze({
        durationSec: 0.34,
        layers: Object.freeze([
          Object.freeze({
            type: 'sawtooth',
            freqStart: 145,
            freqEnd: 190,
            duration: 0.34,
            attack: 0.02,
            gain: 0.15,
            filterType: 'bandpass',
            filterFreq: 680,
            filterQ: 2.8,
          }),
        ]),
      }),
      burst: Object.freeze({
        durationSec: 0.25,
        layers: Object.freeze([
          Object.freeze({
            type: 'triangle',
            freqStart: 210,
            freqEnd: 160,
            duration: 0.25,
            attack: 0.015,
            gain: 0.16,
            filterType: 'bandpass',
            filterFreq: 850,
            filterQ: 2.0,
          }),
        ]),
      }),
    }),
  }),
  hunter: Object.freeze({
    identity: 'raspy_snarl',
    variants: Object.freeze({
      growl: Object.freeze({
        durationSec: 0.38,
        layers: Object.freeze([
          Object.freeze({
            type: 'triangle',
            freqStart: 165,
            freqEnd: 128,
            duration: 0.38,
            attack: 0.025,
            gain: 0.22,
            filterType: 'bandpass',
            filterFreq: 1100,
            filterQ: 2.5,
          }),
          Object.freeze({
            type: 'sine',
            freqStart: 240,
            freqEnd: 195,
            duration: 0.3,
            attack: 0.03,
            gain: 0.13,
          }),
        ]),
      }),
      snarl: Object.freeze({
        durationSec: 0.32,
        layers: Object.freeze([
          Object.freeze({
            type: 'sawtooth',
            freqStart: 180,
            freqEnd: 245,
            duration: 0.32,
            attack: 0.015,
            gain: 0.2,
            filterType: 'highpass',
            filterFreq: 820,
            filterQ: 2.2,
          }),
        ]),
      }),
      burst: Object.freeze({
        durationSec: 0.22,
        layers: Object.freeze([
          Object.freeze({
            type: 'triangle',
            freqStart: 280,
            freqEnd: 210,
            duration: 0.22,
            attack: 0.01,
            gain: 0.22,
            filterType: 'bandpass',
            filterFreq: 1450,
            filterQ: 1.8,
          }),
        ]),
      }),
    }),
  }),
  brute: Object.freeze({
    identity: 'guttural_roar',
    variants: Object.freeze({
      growl: Object.freeze({
        durationSec: 0.65,
        layers: Object.freeze([
          Object.freeze({
            type: 'sine',
            freqStart: 82,
            freqEnd: 54,
            duration: 0.65,
            attack: 0.06,
            gain: 0.32,
            filterType: 'lowpass',
            filterFreq: 280,
            filterQ: 1.5,
          }),
          Object.freeze({
            type: 'sawtooth',
            freqStart: 110,
            freqEnd: 72,
            duration: 0.55,
            attack: 0.05,
            gain: 0.22,
            filterType: 'bandpass',
            filterFreq: 340,
            filterQ: 2.0,
          }),
        ]),
      }),
      snarl: Object.freeze({
        durationSec: 0.52,
        layers: Object.freeze([
          Object.freeze({
            type: 'sawtooth',
            freqStart: 96,
            freqEnd: 124,
            duration: 0.52,
            attack: 0.03,
            gain: 0.28,
            filterType: 'lowpass',
            filterFreq: 460,
            filterQ: 1.8,
          }),
        ]),
      }),
      burst: Object.freeze({
        durationSec: 0.44,
        layers: Object.freeze([
          Object.freeze({
            type: 'sine',
            freqStart: 130,
            freqEnd: 78,
            duration: 0.44,
            attack: 0.015,
            gain: 0.3,
            filterType: 'lowpass',
            filterFreq: 520,
            filterQ: 1.4,
          }),
        ]),
      }),
    }),
  }),
})

export function triggerEnemyVocalCue(
  ctx,
  dest,
  noiseBuffer,
  enemyType = 'stalker',
  variant = 'growl',
  options = {}
) {
  if (!ctx || !dest) return null
  const normalizedType = normalizeAlertEnemyType(enemyType)
  const archetypeSpec = ENEMY_VOCAL_SPECS[normalizedType] || ENEMY_VOCAL_SPECS.stalker
  const validVariant =
    archetypeSpec.variants && variant in archetypeSpec.variants ? variant : 'growl'
  const spec = archetypeSpec.variants[validVariant]

  const handle = createEnemyCueHandle(ctx, dest, {
    cueGainValue:
      Number.isFinite(Number(options?.cueGainValue)) && Number(options.cueGainValue) > 0
        ? Number(options.cueGainValue)
        : 1,
    durationSec: spec.durationSec,
    kind: 'enemy_vocal',
    variant: `${normalizedType}_${validVariant}`,
    category: ENEMY_AUDIO_CATEGORIES.VOCAL,
    enemyId: options?.enemyId ?? null,
    enemyType: normalizedType,
    priority: Number.isFinite(Number(options?.priority))
      ? Number(options.priority)
      : ENEMY_AUDIO_PRIORITIES[ENEMY_AUDIO_CATEGORIES.VOCAL],
    onComplete: options?.onComplete,
  })
  handle.identity = archetypeSpec.identity

  for (let i = 0; i < spec.layers.length; i += 1) {
    handle.track(playToneBurst(ctx, handle.target, spec.layers[i]))
  }

  handle.track(
    playNoiseBurst(ctx, handle.target, noiseBuffer, {
      duration: spec.durationSec * 0.85,
      gain: normalizedType === 'brute' ? 0.22 : normalizedType === 'hunter' ? 0.16 : 0.12,
      filterType: normalizedType === 'brute' ? 'lowpass' : 'bandpass',
      filterFreq: normalizedType === 'brute' ? 380 : normalizedType === 'hunter' ? 1250 : 650,
      filterQ: 1.5,
      offset: Math.random() * 2.0,
    })
  )

  return handle
}

export const ENEMY_BREATH_SPECS = Object.freeze({
  stalker: Object.freeze({
    durationSec: 0.48,
    layers: Object.freeze([
      Object.freeze({
        type: 'sine',
        freqStart: 95,
        freqEnd: 82,
        duration: 0.48,
        attack: 0.08,
        gain: 0.12,
        filterType: 'bandpass',
        filterFreq: 320,
        filterQ: 1.8,
      }),
    ]),
    noiseGain: 0.08,
    filterFreq: 450,
    filterType: 'bandpass',
  }),
  hunter: Object.freeze({
    durationSec: 0.38,
    layers: Object.freeze([
      Object.freeze({
        type: 'triangle',
        freqStart: 120,
        freqEnd: 105,
        duration: 0.38,
        attack: 0.05,
        gain: 0.14,
        filterType: 'bandpass',
        filterFreq: 820,
        filterQ: 2.0,
      }),
    ]),
    noiseGain: 0.11,
    filterFreq: 950,
    filterType: 'highpass',
  }),
  brute: Object.freeze({
    durationSec: 0.62,
    layers: Object.freeze([
      Object.freeze({
        type: 'sine',
        freqStart: 64,
        freqEnd: 52,
        duration: 0.62,
        attack: 0.1,
        gain: 0.18,
        filterType: 'lowpass',
        filterFreq: 220,
        filterQ: 1.5,
      }),
    ]),
    noiseGain: 0.15,
    filterFreq: 280,
    filterType: 'lowpass',
  }),
})

export function triggerEnemyBreathCue(
  ctx,
  dest,
  noiseBuffer,
  enemyType = 'stalker',
  options = {}
) {
  if (!ctx || !dest) return null
  const normalizedType = normalizeAlertEnemyType(enemyType)
  const spec = ENEMY_BREATH_SPECS[normalizedType] || ENEMY_BREATH_SPECS.stalker

  const handle = createEnemyCueHandle(ctx, dest, {
    cueGainValue:
      Number.isFinite(Number(options?.cueGainValue)) && Number(options.cueGainValue) > 0
        ? Number(options.cueGainValue)
        : 1,
    durationSec: spec.durationSec,
    kind: 'enemy_breath',
    variant: normalizedType,
    category: ENEMY_AUDIO_CATEGORIES.BREATH,
    enemyId: options?.enemyId ?? null,
    enemyType: normalizedType,
    priority: Number.isFinite(Number(options?.priority))
      ? Number(options.priority)
      : ENEMY_AUDIO_PRIORITIES[ENEMY_AUDIO_CATEGORIES.BREATH],
    onComplete: options?.onComplete,
  })

  for (let i = 0; i < spec.layers.length; i += 1) {
    handle.track(playToneBurst(ctx, handle.target, spec.layers[i]))
  }

  handle.track(
    playNoiseBurst(ctx, handle.target, noiseBuffer, {
      duration: spec.durationSec * 0.9,
      gain: spec.noiseGain,
      filterType: spec.filterType,
      filterFreq: spec.filterFreq,
      filterQ: 1.6,
      offset: Math.random() * 3.0,
    })
  )

  return handle
}

export const PLAYER_DAMAGE_VOCAL_VARIANTS = Object.freeze([
  'short_grunt',
  'sharp_impact',
  'strained_groan',
])

export const VOCAL_PCM_PRESET_SPECS = Object.freeze({
  elevator_startled: Object.freeze({
    preset: 'elevator_startled',
    profile: 'startled_breath',
    synthesizer: 'startled_exertion',
    synthesisArchitecture: 'parallel_chest_formant',
    parallelChestFormantModel: true,
    continuousBandLimitedGlottal: true,
    glottalHarmonics: 28,
    glottalSlopePow: 0.86,
    glottalCornerHarmonic: 10.0,
    glottalPhaseSpread: 1.0,
    durationSec: 0.295,
    pitchStart: 80,
    pitchPeakAt: 0.25,
    pitchPeak: 88,
    pitchMidAt: 0.64,
    pitchMid: 76,
    pitchEnd: 68,
    openQuotient: 0.68,
    returnQuotient: 0.095,
    closingEmphasis: 1.35,
    jitterDepth: 0.0075,
    shimmerDepth: 0.044,
    subharmonicDepth: 0.0,
    aspirationLevel: 0.14,
    intakeEndFrac: 0.16,
    catchEndFrac: 0.045,
    voicedPeakFrac: 0.22,
    voicedEndFrac: 0.78,
    coreDecayRate: 1.55,
    intakeGain: 0.13,
    glottalPopGain: 0.0,
    releaseBreathGain: 0.16,
    airBypassGain: 0.0,
    f1Intake: 375,
    f2Intake: 830,
    f3Intake: 2020,
    f1Start: 385,
    f1End: 320,
    b1Start: 108,
    b1End: 132,
    f2Start: 850,
    f2End: 730,
    b2Start: 132,
    b2End: 158,
    f3Start: 2050,
    f3End: 1900,
    b3Start: 220,
    b3End: 265,
    f4Hz: 2950,
    b4Hz: 290,
    shelf1Hz: 900,
    shelf1GainDb: 0.0,
    shelf2Hz: 1850,
    shelf2GainDb: 0.0,
    chestDipHz: 150,
    chestDipDb: 0.0,
    lowCutHz: 42,
    radiationCoeff: 0.86,
    softClipDrive: 0.64,
    targetPeak: 0.86,
    cueGainValue: 0.98,
  }),
  damage_short_grunt: Object.freeze({
    preset: 'damage_short_grunt',
    profile: 'pain_pressed',
    synthesizer: 'pain_reaction',
    durationSec: 0.205,
    pitchStart: 180,
    pitchPeakAt: 0.17,
    pitchPeak: 192,
    pitchMidAt: 0.54,
    pitchMid: 164,
    pitchEnd: 144,
    openQuotient: 0.62,
    returnQuotient: 0.064,
    closingEmphasis: 1.54,
    jitterDepth: 0.012,
    shimmerDepth: 0.072,
    subharmonicDepth: 0.0,
    aspirationLevel: 0.3,
    intakeEndFrac: 0.0,
    catchEndFrac: 0.048,
    voicedPeakFrac: 0.145,
    voicedEndFrac: 0.64,
    coreDecayRate: 2.8,
    intakeGain: 0.0,
    glottalPopGain: 0.18,
    releaseBreathGain: 0.19,
    airBypassGain: 0.32,
    f1Intake: 745,
    f2Intake: 1620,
    f3Intake: 2820,
    f1Start: 760,
    f1End: 650,
    b1Start: 188,
    b1End: 218,
    f2Start: 1640,
    f2End: 1470,
    b2Start: 132,
    b2End: 158,
    f3Start: 2840,
    f3End: 2680,
    b3Start: 180,
    b3End: 210,
    f4Hz: 3880,
    b4Hz: 315,
    shelf1Hz: 1380,
    shelf1GainDb: 9.2,
    shelf2Hz: 2550,
    shelf2GainDb: 9.0,
    chestDipHz: 540,
    chestDipDb: -4.2,
    lowCutHz: 112,
    radiationCoeff: 0.92,
    softClipDrive: 0.82,
    targetPeak: 0.68,
    cueGainValue: 0.79,
  }),
  damage_sharp_impact: Object.freeze({
    preset: 'damage_sharp_impact',
    profile: 'pain_pressed',
    synthesizer: 'pain_reaction',
    durationSec: 0.255,
    pitchStart: 196,
    pitchPeakAt: 0.18,
    pitchPeak: 214,
    pitchMidAt: 0.56,
    pitchMid: 180,
    pitchEnd: 156,
    openQuotient: 0.62,
    returnQuotient: 0.06,
    closingEmphasis: 1.62,
    jitterDepth: 0.013,
    shimmerDepth: 0.078,
    subharmonicDepth: 0.0,
    aspirationLevel: 0.34,
    intakeEndFrac: 0.0,
    catchEndFrac: 0.055,
    voicedPeakFrac: 0.16,
    voicedEndFrac: 0.69,
    coreDecayRate: 2.6,
    intakeGain: 0.0,
    glottalPopGain: 0.14,
    releaseBreathGain: 0.22,
    airBypassGain: 0.36,
    f1Intake: 815,
    f2Intake: 1820,
    f3Intake: 3000,
    f1Start: 830,
    f1End: 710,
    b1Start: 192,
    b1End: 222,
    f2Start: 1840,
    f2End: 1640,
    b2Start: 130,
    b2End: 155,
    f3Start: 3040,
    f3End: 2840,
    b3Start: 175,
    b3End: 205,
    f4Hz: 4040,
    b4Hz: 320,
    shelf1Hz: 1380,
    shelf1GainDb: 10.0,
    shelf2Hz: 2550,
    shelf2GainDb: 9.8,
    chestDipHz: 560,
    chestDipDb: -3.8,
    lowCutHz: 114,
    radiationCoeff: 0.925,
    softClipDrive: 0.84,
    targetPeak: 0.7,
    cueGainValue: 0.8,
  }),
  damage_strained_groan: Object.freeze({
    preset: 'damage_strained_groan',
    profile: 'pain_strained',
    synthesizer: 'pain_reaction',
    durationSec: 0.375,
    pitchStart: 166,
    pitchPeakAt: 0.2,
    pitchPeak: 178,
    pitchMidAt: 0.58,
    pitchMid: 152,
    pitchEnd: 136,
    openQuotient: 0.63,
    returnQuotient: 0.066,
    closingEmphasis: 1.52,
    jitterDepth: 0.014,
    shimmerDepth: 0.082,
    subharmonicDepth: 0.0,
    aspirationLevel: 0.32,
    intakeEndFrac: 0.0,
    catchEndFrac: 0.06,
    voicedPeakFrac: 0.165,
    voicedEndFrac: 0.73,
    coreDecayRate: 2.2,
    intakeGain: 0.0,
    glottalPopGain: 0.16,
    releaseBreathGain: 0.21,
    airBypassGain: 0.34,
    f1Intake: 740,
    f2Intake: 1610,
    f3Intake: 2800,
    // Light strained central trajectory without collapsing into baritone/chest "OO" drone
    f1Start: 750,
    f1End: 645,
    b1Start: 188,
    b1End: 218,
    f2Start: 1640,
    f2End: 1460,
    b2Start: 134,
    b2End: 160,
    f3Start: 2820,
    f3End: 2660,
    b3Start: 182,
    b3End: 212,
    f4Hz: 3860,
    b4Hz: 315,
    shelf1Hz: 1380,
    shelf1GainDb: 9.5,
    shelf2Hz: 2550,
    shelf2GainDb: 9.5,
    chestDipHz: 540,
    chestDipDb: -4.2,
    lowCutHz: 110,
    radiationCoeff: 0.92,
    softClipDrive: 0.8,
    targetPeak: 0.68,
    cueGainValue: 0.81,
  }),
})

let autoVocalSeedCounter = 104729

function resolveVocalSeed(seedInput) {
  if (seedInput !== undefined && seedInput !== null && Number.isFinite(Number(seedInput))) {
    return (Math.floor(Math.abs(Number(seedInput))) % 2147483645) + 1
  }
  autoVocalSeedCounter = (autoVocalSeedCounter + 7919) % 2147483645
  const randJitter = Math.floor(Math.random() * 1000003)
  return ((autoVocalSeedCounter + randJitter) % 2147483645) + 1
}

function computeMinimumPhaseBiquad(type, fc, sampleRate, q = 0.72, gainDb = 0) {
  const safeFc = Math.max(20, Math.min(sampleRate * 0.44, fc))
  const w0 = (2 * Math.PI * safeFc) / sampleRate
  const cosw = Math.cos(w0)
  const sinw = Math.sin(w0)
  const A = Math.pow(10, gainDb / 40)
  if (type === 'highshelf') {
    const alpha = (sinw / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2)
    const sqA2a = 2 * Math.sqrt(A) * alpha
    const a0 = A + 1 - (A - 1) * cosw + sqA2a
    return {
      b0: (A * (A + 1 + (A - 1) * cosw + sqA2a)) / a0,
      b1: (-2 * A * (A - 1 + (A + 1) * cosw)) / a0,
      b2: (A * (A + 1 + (A - 1) * cosw - sqA2a)) / a0,
      a1: (2 * (A - 1 - (A + 1) * cosw)) / a0,
      a2: (A + 1 - (A - 1) * cosw - sqA2a) / a0,
    }
  }
  const alpha = sinw / (2 * Math.max(0.15, q))
  const a0 = 1 + alpha / A
  return {
    b0: (1 + alpha * A) / a0,
    b1: (-2 * cosw) / a0,
    b2: (1 - alpha * A) / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha / A) / a0,
  }
}

/**
 * Sample-level time-domain procedural human vocal-tract PCM synthesizer.
 *
 * Generates a mono PCM AudioBuffer using:
 * 1) A zero-DC, softly adducted Rosenberg/LF glottal flow derivative source with
 *    genuinely independent seeded cycle-to-cycle micro-jitter/shimmer (zero period-2 F0/2 alternation).
 * 2) A single-path minimum-phase 4-stage vocal-tract cascade (R1 -> R2 -> R3 -> R4) + lip radiation,
 *    followed by a smooth dual-shelf higher-pole compensator and gentle pharyngeal chest trim
 *    (eliminating Phase 10's ~1050 Hz out-of-phase branch cancellation while preserving F2-F4 and H1).
 * 3) Pitch-synchronous glottal aspiration plus >2.5 kHz breath-air bypass for natural >5 kHz air.
 */
export function renderHumanVocalTrackBuffer(ctx, spec = {}) {
  const presetKey =
    typeof spec?.preset === 'string' && spec.preset in VOCAL_PCM_PRESET_SPECS
      ? spec.preset
      : 'damage_short_grunt'
  const baseSpec = VOCAL_PCM_PRESET_SPECS[presetKey]

  const rawSr = Number(ctx?.sampleRate ?? spec?.sampleRate) || 44100
  const sampleRate = Math.max(8000, Math.min(192000, Math.round(rawSr)))
  const durationSec = Math.max(
    0.08,
    Math.min(1.2, Number(spec?.durationSec) || baseSpec.durationSec)
  )
  const numSamples = Math.max(64, Math.round(sampleRate * durationSec))
  const seed = resolveVocalSeed(spec?.seed)

  let channelData = new Float32Array(numSamples)
  let buffer = null
  if (ctx && typeof ctx.createBuffer === 'function') {
    try {
      buffer = ctx.createBuffer(1, numSamples, sampleRate)
      const bufData =
        typeof buffer?.getChannelData === 'function' ? buffer.getChannelData(0) : null
      if (bufData instanceof Float32Array && bufData.length === numSamples) {
        channelData = bufData
        // Guard against naive test mocks whose getChannelData() allocates a new array each call
        if (buffer.getChannelData(0) !== channelData) {
          buffer.getChannelData = () => channelData
        }
      } else if (buffer) {
        buffer.getChannelData = () => channelData
      }
    } catch {
      buffer = null
    }
  }
  if (!buffer) {
    buffer = {
      numberOfChannels: 1,
      length: numSamples,
      sampleRate,
      duration: numSamples / sampleRate,
      getChannelData: () => channelData,
    }
  }

  // Deterministic inline Park-Miller PRNG (zero object allocations in hot loop)
  let rngState = seed
  const nextRand = () => {
    rngState = (rngState * 16807) % 2147483647
    return (rngState - 1) / 2147483646
  }
  const nextBipolar = () => nextRand() * 2 - 1
  // Smooth zero-mean triangular distribution avoids binary extreme jumps or odd/even lock
  const nextTri = () => 0.5 * (nextBipolar() + nextBipolar())

  const numOr = (val, fallback) => {
    const n = Number(val)
    return val !== undefined && val !== null && Number.isFinite(n) ? n : fallback
  }

  // Resolve pitch trajectory scalars from single-source preset spec (with optional overrides/pitchSteps)
  const pitchStart = Math.max(55, Math.min(360, numOr(spec?.pitchStart, baseSpec.pitchStart)))
  let step0At = Math.max(0.05, Math.min(0.85, numOr(spec?.pitchPeakAt, baseSpec.pitchPeakAt)))
  let step0Freq = Math.max(50, Math.min(380, numOr(spec?.pitchPeak, baseSpec.pitchPeak)))
  let step1At = Math.max(
    step0At + 0.05,
    Math.min(0.95, numOr(spec?.pitchMidAt, baseSpec.pitchMidAt))
  )
  let step1Freq = Math.max(50, Math.min(380, numOr(spec?.pitchMid, baseSpec.pitchMid)))
  let step2Freq = Math.max(45, Math.min(380, numOr(spec?.pitchEnd, baseSpec.pitchEnd)))

  if (Array.isArray(spec?.pitchSteps) && spec.pitchSteps.length > 0) {
    const s0 = spec.pitchSteps[0]
    const s1 = spec.pitchSteps[Math.min(1, spec.pitchSteps.length - 1)]
    const s2 = spec.pitchSteps[spec.pitchSteps.length - 1]
    if (Number.isFinite(Number(s0?.at))) step0At = Math.max(0.05, Math.min(0.85, Number(s0.at)))
    if (Number.isFinite(Number(s0?.freq))) step0Freq = Math.max(50, Math.min(380, Number(s0.freq)))
    if (Number.isFinite(Number(s1?.at))) {
      step1At = Math.max(step0At + 0.05, Math.min(0.95, Number(s1.at)))
    }
    if (Number.isFinite(Number(s1?.freq))) step1Freq = Math.max(50, Math.min(380, Number(s1.freq)))
    if (Number.isFinite(Number(s2?.freq))) step2Freq = Math.max(45, Math.min(380, Number(s2.freq)))
  }

  // Glottal & phonetic parameters
  const baseOq = Math.max(0.42, Math.min(0.76, numOr(spec?.openQuotient, baseSpec.openQuotient)))
  const returnQuotient = Math.max(
    0.025,
    Math.min(0.11, numOr(spec?.returnQuotient, baseSpec.returnQuotient))
  )
  const closingEmphasis = Math.max(
    1.05,
    Math.min(3.2, numOr(spec?.closingEmphasis, baseSpec.closingEmphasis))
  )
  const jitterDepth = Math.max(
    0.003,
    Math.min(0.04, numOr(spec?.jitterDepth, baseSpec.jitterDepth))
  )
  const shimmerDepth = Math.max(
    0.02,
    Math.min(0.24, numOr(spec?.shimmerDepth, baseSpec.shimmerDepth))
  )
  const subharmonicDepth = Math.max(
    0,
    Math.min(0.15, numOr(spec?.subharmonicDepth, baseSpec.subharmonicDepth ?? 0))
  )
  const aspirationLevel = Math.max(
    0.05,
    Math.min(0.75, numOr(spec?.aspirationLevel, baseSpec.aspirationLevel))
  )

  const intakeEndFrac = Math.max(
    0,
    Math.min(0.35, numOr(spec?.intakeEndFrac, baseSpec.intakeEndFrac))
  )
  const catchEndFrac = Math.max(
    intakeEndFrac + 0.02,
    Math.min(0.42, numOr(spec?.catchEndFrac, baseSpec.catchEndFrac))
  )
  const voicedPeakFrac = Math.max(
    catchEndFrac + 0.03,
    Math.min(0.55, numOr(spec?.voicedPeakFrac, baseSpec.voicedPeakFrac))
  )
  const voicedEndFrac = Math.max(
    voicedPeakFrac + 0.18,
    Math.min(0.88, numOr(spec?.voicedEndFrac, baseSpec.voicedEndFrac))
  )
  const coreDecayRate = Math.max(
    1.1,
    Math.min(5.0, numOr(spec?.coreDecayRate, baseSpec.coreDecayRate))
  )
  const intakeGain = Math.max(0, Math.min(1.2, numOr(spec?.intakeGain, baseSpec.intakeGain)))
  const glottalPopGain = Math.max(
    0,
    Math.min(1.4, numOr(spec?.glottalPopGain, baseSpec.glottalPopGain))
  )
  const releaseBreathGain = Math.max(
    0.05,
    Math.min(1.0, numOr(spec?.releaseBreathGain, baseSpec.releaseBreathGain))
  )
  const airBypassGain = Math.max(
    0,
    Math.min(0.9, numOr(spec?.airBypassGain, baseSpec.airBypassGain ?? 0.44))
  )

  // Formant trajectory endpoints & minimum-phase spectral tilt parameters
  const nyquistSafeMax = sampleRate * 0.43
  const f1Intake = Math.min(nyquistSafeMax, numOr(spec?.f1Intake, baseSpec.f1Intake))
  const f2Intake = Math.min(nyquistSafeMax, numOr(spec?.f2Intake, baseSpec.f2Intake))
  const f3Intake = Math.min(nyquistSafeMax, numOr(spec?.f3Intake, baseSpec.f3Intake))
  const f1Start = Math.min(nyquistSafeMax, numOr(spec?.f1Start, baseSpec.f1Start))
  const f1End = Math.min(nyquistSafeMax, numOr(spec?.f1End, baseSpec.f1End))
  const b1Start = numOr(spec?.b1Start, baseSpec.b1Start)
  const b1End = numOr(spec?.b1End, baseSpec.b1End)
  const f2Start = Math.min(nyquistSafeMax, numOr(spec?.f2Start, baseSpec.f2Start))
  const f2End = Math.min(nyquistSafeMax, numOr(spec?.f2End, baseSpec.f2End))
  const b2Start = numOr(spec?.b2Start, baseSpec.b2Start)
  const b2End = numOr(spec?.b2End, baseSpec.b2End)
  const f3Start = Math.min(nyquistSafeMax, numOr(spec?.f3Start, baseSpec.f3Start))
  const f3End = Math.min(nyquistSafeMax, numOr(spec?.f3End, baseSpec.f3End))
  const b3Start = numOr(spec?.b3Start, baseSpec.b3Start)
  const b3End = numOr(spec?.b3End, baseSpec.b3End)
  const f4Hz = Math.min(nyquistSafeMax, numOr(spec?.f4Hz, baseSpec.f4Hz))
  const b4Hz = numOr(spec?.b4Hz, baseSpec.b4Hz)

  const shelf1Hz = numOr(spec?.shelf1Hz, baseSpec.shelf1Hz ?? 1380)
  const shelf1GainDb = Math.max(-6, Math.min(18, numOr(spec?.shelf1GainDb, baseSpec.shelf1GainDb ?? 9.5)))
  const shelf2Hz = numOr(spec?.shelf2Hz, baseSpec.shelf2Hz ?? 2550)
  const shelf2GainDb = Math.max(-6, Math.min(18, numOr(spec?.shelf2GainDb, baseSpec.shelf2GainDb ?? 9.5)))
  const chestDipHz = numOr(spec?.chestDipHz, baseSpec.chestDipHz ?? 550)
  const chestDipDb = Math.max(-12, Math.min(6, numOr(spec?.chestDipDb, baseSpec.chestDipDb ?? -4.2)))

  const lowCutHz = Math.max(
    38,
    Math.min(200, numOr(spec?.lowCutHz, baseSpec.lowCutHz ?? 112))
  )
  const radiationCoeff = Math.max(
    0.82,
    Math.min(0.975, numOr(spec?.radiationCoeff, baseSpec.radiationCoeff))
  )
  const softClipDrive = Math.max(
    0.35,
    Math.min(1.6, numOr(spec?.softClipDrive, baseSpec.softClipDrive ?? 0.82))
  )
  const targetPeak = Math.max(0.15, Math.min(0.94, numOr(spec?.targetPeak, baseSpec.targetPeak)))
  const excitationGain = Math.max(0.05, Math.min(2.0, numOr(spec?.excitationGain, 1.0)))
  const isStrainedGroan = presetKey === 'damage_strained_groan'
  const isParallelChestFormant = Boolean(
    spec?.parallelChestFormantModel ?? baseSpec.parallelChestFormantModel
  )
  const isContinuousModal = Boolean(
    spec?.continuousBandLimitedGlottal ?? baseSpec.continuousBandLimitedGlottal
  )

  // Cycle state & diagnostics accumulators (scalars only)
  let cycleSample = 0
  let cycleLen = 0
  let cycleIndex = 0
  let currentCycleAmp = 1.0
  let currentCycleOq = baseOq
  let pitchDrift = 0
  let prevVoicedCycleF0 = 0
  let prevVoicedCycleAmp = 0
  let prevOddCycleAmp = 0
  let voicedCycleCount = 0
  let jitterDiffCount = 0
  let jitterRatioSum = 0
  let shimmerRatioSum = 0
  let subharmonicDiffSum = 0
  let subharmonicPairCount = 0
  let glottalDcSum = 0
  let glottalSampleCount = 0
  let openPhaseAspEnergy = 0
  let openPhaseSampleCount = 0
  let closedPhaseAspEnergy = 0
  let closedPhaseSampleCount = 0

  // 1) 4-stage minimum-phase cascade vocal-tract resonators (R1 -> R2 -> R3 -> R4)
  let r1a = 0, r1b = 0, r1c = 0, r1z1 = 0, r1z2 = 0
  let r2a = 0, r2b = 0, r2c = 0, r2z1 = 0, r2z2 = 0
  let r3a = 0, r3b = 0, r3c = 0, r3z1 = 0, r3z2 = 0
  let r4z1 = 0, r4z2 = 0

  const f4Clamped = Math.max(240, Math.min(nyquistSafeMax, f4Hz))
  const b4Clamped = Math.max(60, Math.min(800, b4Hz))
  const rad4 = Math.exp((-Math.PI * b4Clamped) / sampleRate)
  const r4c = -(rad4 * rad4)
  const r4b = 2 * rad4 * Math.cos((2 * Math.PI * f4Clamped) / sampleRate)
  const r4a = 1 - r4b - r4c

  // 2) Smooth minimum-phase higher-pole spectral tilt shelves + gentle chest-resonance trim
  //    Zero parallel branch summation -> zero ~1050 Hz anti-resonance notch.
  const sh1 = computeMinimumPhaseBiquad('highshelf', shelf1Hz, sampleRate, 0.72, shelf1GainDb)
  const sh2 = computeMinimumPhaseBiquad('highshelf', shelf2Hz, sampleRate, 0.72, shelf2GainDb)
  const dip1 = computeMinimumPhaseBiquad(
    'peaking',
    chestDipHz,
    sampleRate,
    isContinuousModal ? 0.78 : 0.95,
    chestDipDb
  )
  let sx1 = 0, sx2 = 0, sy1 = 0, sy2 = 0
  let s2x1 = 0, s2x2 = 0, s2y1 = 0, s2y2 = 0
  let dx1 = 0, dx2 = 0, dy1 = 0, dy2 = 0

  // Turbulence, breath-air & radiation filter state (sample-rate adaptive poles)
  let noiseLpState = 0
  let noiseHpPrevIn = 0
  let noiseHpState = 0
  let airHpPrevIn = 0
  let airHpState = 0
  const turbHpPole = Math.exp((-2 * Math.PI * (isContinuousModal ? 950 : 1350)) / sampleRate)
  const turbLpAlpha = Math.max(
    0.25,
    Math.min(0.95, 1 - Math.exp((-2 * Math.PI * (isContinuousModal ? 3000 : 8200)) / sampleRate))
  )
  const airHpPole = Math.exp((-2 * Math.PI * (isContinuousModal ? 1900 : 2650)) / sampleRate)

  let prevTractOut = 0
  let dcPrevIn = 0
  let dcPrevOut = 0
  const dcPole = Math.exp((-2 * Math.PI * lowCutHz) / sampleRate)

  const twoPiOverSr = (2 * Math.PI) / sampleRate
  const minusPiOverSr = -Math.PI / sampleRate
  const popWidthFrac = Math.max(0.014, 0.005 / durationSec)

  if (isParallelChestFormant || isContinuousModal) {
    // Dedicated parallel chest-body + dark male vocal-tract exertion synthesizer (elevator_startled):
    // Replaces the 4-stage cascade + +21.4 dB high-shelf buzz topology that caused 5x intra-cycle
    // pulse fragmentation ("brrrr / dot-dot-dot") and dominant 400 Hz H4 resonance.
    // Combines:
    //  1) Continuous crest-minimized chest-wall fundamental + H2/H3 core (zero inter-pulse silence gaps,
    //     strong deep-male pitch presence on both full-range headphones and small laptop speakers).
    //  2) Golden-angle phase-dispersed modal harmonics feeding 3 parallel constant-peak vocal-tract
    //     resonators (dark lowered-larynx male F1/F2/F3, zero artificial high-shelf EQ).
    //  3) Warm throat-compression breath airflow shaped by the same F1/F2/F3 vocal tract.
    const maxHarmonicFreq = Math.min(2550, nyquistSafeMax)
    const minPitch = Math.max(55, Math.min(pitchStart, step0Freq, step1Freq, step2Freq))
    const maxK = Math.max(
      8,
      Math.min(
        32,
        Math.round(numOr(spec?.glottalHarmonics, baseSpec.glottalHarmonics ?? 28)),
        Math.floor(maxHarmonicFreq / minPitch)
      )
    )
    const slopePow = Math.max(0.5, Math.min(1.5, numOr(spec?.glottalSlopePow, baseSpec.glottalSlopePow ?? 0.86)))
    const hWeights = new Float32Array(maxK + 1)
    const hSinOff = new Float32Array(maxK + 1)
    const hCosOff = new Float32Array(maxK + 1)
    const taperStart = Math.max(10, Math.floor(maxK * 0.72))
    const lowPhases = [0, 0.0, -1.6, Math.PI]
    for (let k = 1; k <= maxK; k += 1) {
      const hiTaper =
        k > taperStart
          ? 0.5 * (1 + Math.cos((Math.PI * (k - taperStart)) / Math.max(1, maxK - taperStart + 1)))
          : 1.0
      hWeights[k] = hiTaper / Math.pow(k, slopePow)
      const ph = k <= 3 ? lowPhases[k] : k * 2.399963229728653 + 0.7
      hSinOff[k] = Math.sin(ph)
      hCosOff[k] = Math.cos(ph)
    }

    // Parallel constant-peak 2-pole bandpass formant resonators (voiced + throat-breath paths)
    let p1b0 = 0, p1a1 = 0, p1a2 = 0
    let p2b0 = 0, p2a1 = 0, p2a2 = 0
    let p3b0 = 0, p3a1 = 0, p3a2 = 0
    let vf1x1 = 0, vf1x2 = 0, vf1z1 = 0, vf1z2 = 0
    let vf2x1 = 0, vf2x2 = 0, vf2z1 = 0, vf2z2 = 0
    let vf3x1 = 0, vf3x2 = 0, vf3z1 = 0, vf3z2 = 0
    let bf1x1 = 0, bf1x2 = 0, bf1z1 = 0, bf1z2 = 0
    let bf2x1 = 0, bf2x2 = 0, bf2z1 = 0, bf2z2 = 0
    let bf3x1 = 0, bf3x2 = 0, bf3z1 = 0, bf3z2 = 0

    // Sample-rate-invariant warm throat airflow shaping & 2-pole gentle vocal warmth lowpass (2400 Hz)
    let throatHpPrev = 0
    let throatHp = 0
    let throatLp = 0
    const throatHpPole = Math.exp((-2 * Math.PI * 240) / sampleRate)
    const throatLpAlpha = 1 - Math.exp((-2 * Math.PI * Math.min(2400, nyquistSafeMax)) / sampleRate)
    let warmLp1 = 0
    let warmLp2 = 0
    const warmLpAlpha = 1 - Math.exp((-2 * Math.PI * Math.min(2450, nyquistSafeMax)) / sampleRate)

    let contPhase = 0
    let prevCyclePitchDelta = 0
    let nextCyclePitchDelta = nextTri() * jitterDepth * 0.85
    let prevCycleAmpDelta = 0
    let nextCycleAmpDelta = nextTri() * shimmerDepth * 0.9

    for (let i = 0; i < numSamples; i += 1) {
      const u = i / numSamples

      // Smoothstep macro F0 trajectory (C1 continuous, zero slope corners)
      let targetF0
      if (u <= step0At) {
        const t = u / Math.max(1e-4, step0At)
        targetF0 = pitchStart + (step0Freq - pitchStart) * (t * t * (3 - 2 * t))
      } else if (u <= step1At) {
        const t = (u - step0At) / Math.max(1e-4, step1At - step0At)
        targetF0 = step0Freq + (step1Freq - step0Freq) * (t * t * (3 - 2 * t))
      } else {
        const t = (u - step1At) / Math.max(1e-4, 1 - step1At)
        targetF0 = step1Freq + (step2Freq - step1Freq) * (t * t * (3 - 2 * t))
      }

      const phi = contPhase
      const sPhi = phi * phi * (3 - 2 * phi)
      const jitterDelta = prevCyclePitchDelta + (nextCyclePitchDelta - prevCyclePitchDelta) * sPhi
      const shimmerDelta = prevCycleAmpDelta + (nextCycleAmpDelta - prevCycleAmpDelta) * sPhi
      const jitteredFactor = Math.max(0.97, Math.min(1.03, 1 + jitterDelta))
      const shimmeredAmp = Math.max(0.88, Math.min(1.12, 1 + shimmerDelta))
      const instF0 = Math.max(52, Math.min(360, targetF0 * jitteredFactor))

      contPhase += instF0 / sampleRate
      if (contPhase >= 1) {
        contPhase -= 1
        cycleIndex += 1
        const endJitterFactor = Math.max(0.97, Math.min(1.03, 1 + nextCyclePitchDelta))
        const endShimmerAmp = Math.max(0.88, Math.min(1.12, 1 + nextCycleAmpDelta))
        if (u >= catchEndFrac && u <= voicedEndFrac) {
          voicedCycleCount += 1
          if (prevVoicedCycleF0 > 0) {
            jitterRatioSum += Math.abs(endJitterFactor - prevVoicedCycleF0) / prevVoicedCycleF0
            shimmerRatioSum += Math.abs(endShimmerAmp - prevVoicedCycleAmp) / prevVoicedCycleAmp
            jitterDiffCount += 1
          }
          if ((cycleIndex & 1) === 1) {
            prevOddCycleAmp = endShimmerAmp
          } else if (prevOddCycleAmp > 0) {
            subharmonicDiffSum +=
              Math.abs(endShimmerAmp - prevOddCycleAmp) /
              Math.max(0.1, 0.5 * (endShimmerAmp + prevOddCycleAmp))
            subharmonicPairCount += 1
          }
          prevVoicedCycleF0 = endJitterFactor
          prevVoicedCycleAmp = endShimmerAmp
        }
        pitchDrift = 0.65 * pitchDrift + 0.35 * nextTri()
        prevCyclePitchDelta = nextCyclePitchDelta
        nextCyclePitchDelta = (0.72 * nextTri() + 0.28 * pitchDrift) * jitterDepth
        prevCycleAmpDelta = nextCycleAmpDelta
        nextCycleAmpDelta = nextTri() * shimmerDepth
      }

      // Smooth time-varying adult male parallel formant resonators updated every 8 samples
      if ((i & 7) === 0) {
        const settle = Math.pow(u, 1.08)
        const relW =
          u > voicedEndFrac
            ? 1 + 0.35 * ((u - voicedEndFrac) / Math.max(1e-4, 1 - voicedEndFrac))
            : 1.0

        const f1Safe = Math.max(220, Math.min(nyquistSafeMax, f1Start + (f1End - f1Start) * settle))
        const b1Safe = Math.max(60, Math.min(600, (b1Start + (b1End - b1Start) * settle) * relW))
        const rad1 = Math.exp(minusPiOverSr * b1Safe)
        p1b0 = (1 - rad1 * rad1) * 0.5
        p1a1 = -2 * rad1 * Math.cos(twoPiOverSr * f1Safe)
        p1a2 = rad1 * rad1

        const f2Safe = Math.max(520, Math.min(nyquistSafeMax, f2Start + (f2End - f2Start) * settle))
        const b2Safe = Math.max(70, Math.min(700, (b2Start + (b2End - b2Start) * settle) * relW))
        const rad2 = Math.exp(minusPiOverSr * b2Safe)
        p2b0 = (1 - rad2 * rad2) * 0.5
        p2a1 = -2 * rad2 * Math.cos(twoPiOverSr * f2Safe)
        p2a2 = rad2 * rad2

        const f3Safe = Math.max(1200, Math.min(nyquistSafeMax, f3Start + (f3End - f3Start) * settle))
        const b3Safe = Math.max(90, Math.min(800, (b3Start + (b3End - b3Start) * settle) * relW))
        const rad3 = Math.exp(minusPiOverSr * b3Safe)
        p3b0 = (1 - rad3 * rad3) * 0.5
        p3a1 = -2 * rad3 * Math.cos(twoPiOverSr * f3Safe)
        p3a2 = rad3 * rad3
      }

      // Single continuous organic exertion arc (soft throat catch -> heavy grounded chest core -> relaxed exhale)
      let envIntake = 0
      if (intakeEndFrac > 0 && u < intakeEndFrac) {
        envIntake = intakeGain * Math.sin((u / intakeEndFrac) * Math.PI)
      }

      let envVoiced = 0
      if (u >= catchEndFrac && u < 0.97) {
        if (u < voicedPeakFrac) {
          const att = (u - catchEndFrac) / Math.max(1e-4, voicedPeakFrac - catchEndFrac)
          envVoiced = att * att * (3 - 2 * att)
        } else {
          const dec = (u - voicedPeakFrac) / Math.max(1e-4, 0.97 - voicedPeakFrac)
          const body = Math.exp(-coreDecayRate * dec)
          const tailGate =
            dec > 0.64 ? 0.5 * (1 + Math.cos((Math.PI * (dec - 0.64)) / 0.36)) : 1.0
          envVoiced = body * tailGate
        }
      }

      let envRelease = 0
      if (u > 0.6) {
        const rProg = (u - 0.6) / 0.4
        envRelease = releaseBreathGain * Math.sin(Math.min(1, rProg) * Math.PI)
      }

      // Chebyshev harmonic synthesis split into continuous crest-minimized chest core (H1-H3)
      // and golden-angle phase-dispersed vocal-tract excitation (H3-H28)
      const ang = 2 * Math.PI * phi
      const c1 = Math.cos(ang)
      const s1 = Math.sin(ang)
      let ckPrev = 1
      let skPrev = 0
      let ck = c1
      let sk = s1
      const h1Val = sk * hCosOff[1] + ck * hSinOff[1]
      let chestCore = h1Val
      let tractExcite = 0
      for (let k = 2; k <= maxK; k += 1) {
        if (k * instF0 >= maxHarmonicFreq) break
        const ckNext = 2 * c1 * ck - ckPrev
        const skNext = 2 * c1 * sk - skPrev
        ckPrev = ck
        skPrev = sk
        ck = ckNext
        sk = skNext
        const hk = sk * hCosOff[k] + ck * hSinOff[k]
        if (k === 2) chestCore += 0.74 * hk
        if (k === 3) chestCore += 0.44 * hk
        if (k >= 3) tractExcite += hWeights[k] * hk
      }

      if (u >= catchEndFrac && u <= voicedEndFrac) {
        glottalDcSum += chestCore * 0.5
        glottalSampleCount += 1
      }

      // Warm throat-shaped exertion breath & pitch-synchronous glottal aperture airflow
      let glottalOpenArea = 0
      const openLimit = Math.min(0.92, baseOq + returnQuotient * 0.65)
      if (phi < openLimit) {
        const sOpen = Math.sin((Math.PI * phi) / openLimit)
        glottalOpenArea = sOpen * sOpen
      }

      const white = nextBipolar()
      throatHp = throatHpPole * (throatHp + white - throatHpPrev)
      throatHpPrev = white
      throatLp = (1 - throatLpAlpha) * throatLp + throatLpAlpha * throatHp

      const syncAspGate = 0.06 + 0.94 * glottalOpenArea
      const pitchSyncAsp = throatLp * aspirationLevel * syncAspGate * envVoiced

      if (u >= catchEndFrac && u <= voicedEndFrac) {
        if (glottalOpenArea >= 0.45) {
          openPhaseAspEnergy += pitchSyncAsp * pitchSyncAsp
          openPhaseSampleCount += 1
        } else if (glottalOpenArea <= 0.05) {
          closedPhaseAspEnergy += pitchSyncAsp * pitchSyncAsp
          closedPhaseSampleCount += 1
        }
      }

      const vx = tractExcite * shimmeredAmp * envVoiced * excitationGain
      const vy1 = p1b0 * (vx - vf1x2) - p1a1 * vf1z1 - p1a2 * vf1z2
      vf1x2 = vf1x1
      vf1x1 = vx
      vf1z2 = vf1z1
      vf1z1 = vy1

      const vy2 = p2b0 * (vx - vf2x2) - p2a1 * vf2z1 - p2a2 * vf2z2
      vf2x2 = vf2x1
      vf2x1 = vx
      vf2z2 = vf2z1
      vf2z1 = vy2

      const vy3 = p3b0 * (vx - vf3x2) - p3a1 * vf3z1 - p3a2 * vf3z2
      vf3x2 = vf3x1
      vf3x1 = vx
      vf3z2 = vf3z1
      vf3z1 = vy3

      const bx = (pitchSyncAsp + throatLp * (envIntake + envRelease)) * excitationGain
      const by1 = p1b0 * (bx - bf1x2) - p1a1 * bf1z1 - p1a2 * bf1z2
      bf1x2 = bf1x1
      bf1x1 = bx
      bf1z2 = bf1z1
      bf1z1 = by1

      const by2 = p2b0 * (bx - bf2x2) - p2a1 * bf2z1 - p2a2 * bf2z2
      bf2x2 = bf2x1
      bf2x1 = bx
      bf2z2 = bf2z1
      bf2z1 = by2

      const by3 = p3b0 * (bx - bf3x2) - p3a1 * bf3z1 - p3a2 * bf3z2
      bf3x2 = bf3x1
      bf3x1 = bx
      bf3z2 = bf3z1
      bf3z1 = by3

      // Parallel sum: dominant continuous chest core + dark male pharyngeal/oral formants + throat breath
      const rawMix =
        chestCore * shimmeredAmp * envVoiced * excitationGain * 0.62 +
        vy1 * 1.25 +
        vy2 * 1.32 +
        vy3 * 0.92 +
        (by1 * 1.0 + by2 * 0.9 + by3 * 0.75)

      // 2-pole gentle warmth smoothing (-12 dB/oct above ~2.45 kHz) + 42 Hz subsonic DC blocker
      warmLp1 = (1 - warmLpAlpha) * warmLp1 + warmLpAlpha * rawMix
      warmLp2 = (1 - warmLpAlpha) * warmLp2 + warmLpAlpha * warmLp1
      const cleanOut = warmLp2 - dcPrevIn + dcPole * dcPrevOut
      dcPrevIn = warmLp2
      dcPrevOut = cleanOut

      channelData[i] = Number.isFinite(cleanOut) ? cleanOut : 0
    }
  } else {
    for (let i = 0; i < numSamples; i += 1) {
      const u = i / numSamples
      const inVoicedRegion = u >= catchEndFrac && u <= Math.min(0.94, voicedEndFrac + 0.12)

      // Advance or initialize glottal cycle
      if (cycleSample >= cycleLen || cycleLen <= 0) {
        cycleSample = 0
        cycleIndex += 1

        // Piecewise macro F0 trajectory
        let targetF0
        if (u <= step0At) {
          const t = u / Math.max(1e-4, step0At)
          targetF0 = pitchStart + (step0Freq - pitchStart) * t
        } else if (u <= step1At) {
          const t = (u - step0At) / Math.max(1e-4, step1At - step0At)
          targetF0 = step0Freq + (step1Freq - step0Freq) * t
        } else {
          const t = (u - step1At) / Math.max(1e-4, 1 - step1At)
          targetF0 = step1Freq + (step2Freq - step1Freq) * t
        }

        // Independent seeded micro-jitter + slow laryngeal drift (no period-2 alternation)
        pitchDrift = 0.72 * pitchDrift + 0.28 * nextTri()
        const jitterDelta = (0.65 * nextTri() + 0.35 * pitchDrift) * jitterDepth

        // Independent seeded micro-shimmer (no period-2 odd/even lock)
        const shimmerDelta = nextTri() * shimmerDepth

        // Subtle laryngeal effort modulation for strained_groan (zero F0/2 alternation)
        const strainTremor = isStrainedGroan
          ? 1 + 0.025 * Math.sin(u * Math.PI * 7.5)
          : 1.0
        const optSub = subharmonicDepth > 0 ? 1 + nextTri() * subharmonicDepth * 0.35 : 1.0

        const jitteredFactor = 1 + jitterDelta
        const shimmeredAmp = (1 + shimmerDelta) * strainTremor * optSub

        const currentCycleF0 = Math.max(55, Math.min(380, targetF0 * jitteredFactor))
        currentCycleAmp = Math.max(0.55, Math.min(1.4, shimmeredAmp))
        currentCycleOq = Math.max(
          0.44,
          Math.min(0.76, baseOq + nextTri() * 0.018)
        )
        cycleLen = Math.max(16, Math.round(sampleRate / currentCycleF0))

        if (u >= catchEndFrac && u <= voicedEndFrac) {
          voicedCycleCount += 1
          if (prevVoicedCycleF0 > 0) {
            jitterRatioSum += Math.abs(jitteredFactor - prevVoicedCycleF0) / prevVoicedCycleF0
            shimmerRatioSum += Math.abs(shimmeredAmp - prevVoicedCycleAmp) / prevVoicedCycleAmp
            jitterDiffCount += 1
          }
          if ((cycleIndex & 1) === 1) {
            prevOddCycleAmp = currentCycleAmp
          } else if (prevOddCycleAmp > 0) {
            subharmonicDiffSum +=
              Math.abs(currentCycleAmp - prevOddCycleAmp) /
              Math.max(0.1, 0.5 * (currentCycleAmp + prevOddCycleAmp))
            subharmonicPairCount += 1
          }
          prevVoicedCycleF0 = jitteredFactor
          prevVoicedCycleAmp = shimmeredAmp
        }
      }

      // Update time-varying cascade resonator coefficients every 16 samples (~0.36ms at 44.1kHz)
      if ((i & 15) === 0) {
        let f1Cur
        let f2Cur
        let f3Cur
        let b1Cur
        let b2Cur
        let b3Cur

        if (intakeEndFrac > 0 && u < catchEndFrac) {
          const tIn = Math.min(1, u / Math.max(1e-4, catchEndFrac))
          f1Cur = f1Intake + (f1Start - f1Intake) * tIn
          f2Cur = f2Intake + (f2Start - f2Intake) * tIn
          f3Cur = f3Intake + (f3Start - f3Intake) * tIn
          b1Cur = b1Start * 1.35
          b2Cur = b2Start * 1.35
          b3Cur = b3Start * 1.25
        } else {
          const tCore = Math.max(
            0,
            Math.min(1, (u - catchEndFrac) / Math.max(1e-4, 1 - catchEndFrac))
          )
          const openFlare = Math.sin(Math.min(1, tCore * 2.4) * Math.PI * 0.5)
          const settle = Math.pow(tCore, 1.15)
          f1Cur = f1Start + 25 * (1 - tCore) * openFlare + (f1End - f1Start) * settle
          f2Cur = f2Start + 35 * (1 - tCore) * openFlare + (f2End - f2Start) * settle
          f3Cur = f3Start + (f3End - f3Start) * settle
          const releaseWiden =
            u > voicedEndFrac ? 1 + 0.45 * ((u - voicedEndFrac) / (1 - voicedEndFrac)) : 1
          b1Cur = (b1Start + (b1End - b1Start) * settle) * releaseWiden
          b2Cur = (b2Start + (b2End - b2Start) * settle) * releaseWiden
          b3Cur = (b3Start + (b3End - b3Start) * settle) * releaseWiden
        }

        const f1Safe = Math.max(220, Math.min(nyquistSafeMax, f1Cur))
        const b1Safe = Math.max(55, Math.min(600, b1Cur))
        const rad1 = Math.exp(minusPiOverSr * b1Safe)
        r1c = -(rad1 * rad1)
        r1b = 2 * rad1 * Math.cos(twoPiOverSr * f1Safe)
        r1a = 1 - r1b - r1c

        const f2Safe = Math.max(550, Math.min(nyquistSafeMax, f2Cur))
        const b2Safe = Math.max(65, Math.min(700, b2Cur))
        const rad2 = Math.exp(minusPiOverSr * b2Safe)
        r2c = -(rad2 * rad2)
        r2b = 2 * rad2 * Math.cos(twoPiOverSr * f2Safe)
        r2a = 1 - r2b - r2c

        const f3Safe = Math.max(1200, Math.min(nyquistSafeMax, f3Cur))
        const b3Safe = Math.max(80, Math.min(800, b3Cur))
        const rad3 = Math.exp(minusPiOverSr * b3Safe)
        r3c = -(rad3 * rad3)
        r3b = 2 * rad3 * Math.cos(twoPiOverSr * f3Safe)
        r3a = 1 - r3b - r3c
      }

      // Phonetic stage envelopes
      let envIntake = 0
      if (intakeEndFrac > 0 && u < intakeEndFrac) {
        const p = u / intakeEndFrac
        envIntake = intakeGain * Math.sin(p * Math.PI) * (0.65 + 0.35 * p)
      }

      let envPop = 0
      if (u >= catchEndFrac - popWidthFrac * 0.35 && u <= catchEndFrac + popWidthFrac * 1.65) {
        const dp = (u - catchEndFrac) / popWidthFrac
        envPop = glottalPopGain * Math.exp(-2.8 * dp * dp)
      }

      let envVoiced = 0
      if (inVoicedRegion) {
        if (u < voicedPeakFrac) {
          const att = (u - catchEndFrac) / Math.max(1e-4, voicedPeakFrac - catchEndFrac)
          envVoiced = att * att * (3 - 2 * att)
        } else if (u <= voicedEndFrac) {
          const coreProg = (u - voicedPeakFrac) / Math.max(1e-4, voicedEndFrac - voicedPeakFrac)
          const baseDecay = Math.exp(-coreDecayRate * coreProg)
          const strainContour = isStrainedGroan
            ? 1 + 0.14 * Math.sin(coreProg * Math.PI * 1.35)
            : 1 - 0.16 * coreProg
          envVoiced = Math.max(0.03, baseDecay * strainContour)
        } else {
          const relProg = (u - voicedEndFrac) / Math.max(1e-4, 0.11)
          envVoiced = Math.max(0, 0.12 * Math.exp(-4.8 * relProg))
        }
      }

      let envRelease = 0
      if (u > voicedEndFrac - 0.05) {
        const rProg = (u - (voicedEndFrac - 0.05)) / Math.max(1e-4, 1 - (voicedEndFrac - 0.05))
        envRelease =
          releaseBreathGain * Math.sin(Math.min(1, rProg) * Math.PI) * Math.exp(-1.5 * rProg)
      }

      // Zero-DC softer LF/Rosenberg glottal flow derivative g'(phi)
      const phi = cycleSample / Math.max(1, cycleLen)
      const tp = currentCycleOq * 0.72
      const te = currentCycleOq
      const retEnd = Math.min(0.97, te + 2.8 * returnQuotient)
      const areaPos = 0.53476 * tp
      const areaNeg =
        closingEmphasis * ((te - tp) * (2 / Math.PI) + 0.66459 * returnQuotient)
      const posNorm = areaNeg / Math.max(1e-4, areaPos)

      let glottalPulse = 0
      if (phi < tp) {
        const p = phi / tp
        glottalPulse = posNorm * Math.sin(Math.PI * p) * (0.68 + 0.32 * p)
      } else if (phi < te) {
        const s = (phi - tp) / Math.max(1e-4, te - tp)
        glottalPulse = -closingEmphasis * Math.sin(0.5 * Math.PI * s)
      } else if (phi < retEnd) {
        const r = (phi - te) / returnQuotient
        glottalPulse =
          -closingEmphasis *
          Math.exp(-r) *
          (1 - (phi - te) / Math.max(1e-4, 2.8 * returnQuotient))
      }

      if (u >= catchEndFrac && u <= voicedEndFrac) {
        glottalDcSum += glottalPulse
        glottalSampleCount += 1
      }

      let glottalOpenArea = 0
      const openLimit = Math.min(0.95, te + returnQuotient)
      if (phi < openLimit) {
        const sOpen = Math.sin((Math.PI * phi) / openLimit)
        glottalOpenArea = sOpen * sOpen
      }

      // Wide-band turbulent airflow noise (1.35-8.2 kHz tract turbulence + >2.65 kHz breath air)
      const white = nextBipolar()
      noiseHpState = turbHpPole * (noiseHpState + white - noiseHpPrevIn)
      noiseHpPrevIn = white
      noiseLpState = (1 - turbLpAlpha) * noiseLpState + turbLpAlpha * noiseHpState
      const turbSample = noiseLpState

      airHpState = airHpPole * (airHpState + turbSample - airHpPrevIn)
      airHpPrevIn = turbSample

      // Pitch-synchronous aspiration: modulated by instantaneous glottal opening during voiced core
      const syncAspGate = 0.06 + 0.94 * glottalOpenArea
      const pitchSyncAsp = turbSample * aspirationLevel * syncAspGate * envVoiced

      if (u >= catchEndFrac && u <= voicedEndFrac) {
        if (glottalOpenArea >= 0.45) {
          openPhaseAspEnergy += pitchSyncAsp * pitchSyncAsp
          openPhaseSampleCount += 1
        } else if (glottalOpenArea <= 0.05) {
          closedPhaseAspEnergy += pitchSyncAsp * pitchSyncAsp
          closedPhaseSampleCount += 1
        }
      }

      // Total excitation feeding the single-path minimum-phase vocal-tract cascade
      const voicedExcitation = glottalPulse * currentCycleAmp * envVoiced
      const popExcitation = (turbSample * 0.78 + (phi < 0.24 ? 0.35 : -0.14)) * envPop
      const unvoicedBreath = turbSample * (envIntake + envRelease)
      const tractInput =
        (voicedExcitation + pitchSyncAsp + popExcitation + unvoicedBreath) * excitationGain

      // 4-stage cascade resonators (R1 -> R2 -> R3 -> R4) + lip radiation
      const y1 = r1a * tractInput + r1b * r1z1 + r1c * r1z2
      r1z2 = r1z1
      r1z1 = y1

      const y2 = r2a * y1 + r2b * r2z1 + r2c * r2z2
      r2z2 = r2z1
      r2z1 = y2

      const y3 = r3a * y2 + r3b * r3z1 + r3c * r3z2
      r3z2 = r3z1
      r3z1 = y3

      const y4 = r4a * y3 + r4b * r4z1 + r4c * r4z2
      r4z2 = r4z1
      r4z1 = y4

      const radiatedCascade = y4 - radiationCoeff * prevTractOut
      prevTractOut = y4

      // Minimum-phase higher-pole spectral tilt equalizer + gentle chest-resonance trim
      const sh1Out =
        sh1.b0 * radiatedCascade + sh1.b1 * sx1 + sh1.b2 * sx2 - sh1.a1 * sy1 - sh1.a2 * sy2
      sx2 = sx1
      sx1 = radiatedCascade
      sy2 = sy1
      sy1 = sh1Out

      const sh2Out =
        sh2.b0 * sh1Out + sh2.b1 * s2x1 + sh2.b2 * s2x2 - sh2.a1 * s2y1 - sh2.a2 * s2y2
      s2x2 = s2x1
      s2x1 = sh1Out
      s2y2 = s2y1
      s2y1 = sh2Out

      const tractBalanced =
        dip1.b0 * sh2Out + dip1.b1 * dx1 + dip1.b2 * dx2 - dip1.a1 * dy1 - dip1.a2 * dy2
      dx2 = dx1
      dx1 = sh2Out
      dy2 = dy1
      dy1 = tractBalanced

      // Natural >2.65 kHz human breath/air presence (keeps 5 kHz+ alive without harsh hiss)
      const airEnv = envIntake + envRelease + aspirationLevel * (0.08 + 0.92 * glottalOpenArea) * envVoiced
      const withAir = tractBalanced + airHpState * airEnv * airBypassGain * excitationGain

      // Subsonic/DC proximity blocker (gentle 110-114 Hz, preserves H1)
      const cleanOut = withAir - dcPrevIn + dcPole * dcPrevOut
      dcPrevIn = withAir
      dcPrevOut = cleanOut

      channelData[i] = Number.isFinite(cleanOut) ? cleanOut : 0
      cycleSample += 1
    }
  }

  // Dynamic-preserving soft-knee saturation + boundary de-click fade + headroom-bounded peak scaling
  let rawPeak = 0
  for (let i = 0; i < numSamples; i += 1) {
    const absV = Math.abs(channelData[i])
    if (absV > rawPeak) rawPeak = absV
  }

  const refRawPeak = Math.max(rawPeak, 0.145)
  const preScale = refRawPeak > 1e-7 ? softClipDrive / refRawPeak : 1
  const fadeSamples = Math.max(12, Math.min(Math.floor(numSamples * 0.08), Math.round(sampleRate * 0.0035)))
  let postSoftClipPeak = 0

  for (let i = 0; i < numSamples; i += 1) {
    const x = channelData[i] * preScale
    let y = x / (1 + 0.16 * x * x)
    if (i < fadeSamples) {
      y *= i / fadeSamples
    } else if (i >= numSamples - fadeSamples) {
      y *= (numSamples - 1 - i) / fadeSamples
    }
    channelData[i] = y
    const absY = Math.abs(y)
    if (absY > postSoftClipPeak) postSoftClipPeak = absY
  }

  const baseDrive = Math.max(0.5, Number(baseSpec.softClipDrive) || 0.82)
  const driveRatio = Math.min(1.25, Math.sqrt(softClipDrive / baseDrive))
  const dynamicScale = (rawPeak < 0.145 ? rawPeak / 0.145 : 1.0) * driveRatio
  const effectiveTargetPeak = Math.max(0.12, Math.min(0.94, targetPeak * dynamicScale))
  const finalGain = postSoftClipPeak > 1e-7 ? effectiveTargetPeak / postSoftClipPeak : 0
  let finalPeak = 0
  for (let i = 0; i < numSamples; i += 1) {
    const v = channelData[i] * finalGain
    const safeV = Number.isFinite(v) ? Math.max(-0.95, Math.min(0.95, v)) : 0
    channelData[i] = safeV
    const absV = Math.abs(safeV)
    if (absV > finalPeak) finalPeak = absV
  }

  const meanOpenAspRms = Math.sqrt(openPhaseAspEnergy / Math.max(1, openPhaseSampleCount))
  const meanClosedAspRms = Math.sqrt(closedPhaseAspEnergy / Math.max(1, closedPhaseSampleCount))

  buffer._vocalMeta = {
    preset: presetKey,
    profile: baseSpec.profile,
    synthesizer: baseSpec.synthesizer,
    synthesisArchitecture: isParallelChestFormant
      ? 'parallel_chest_formant'
      : baseSpec.synthesisArchitecture || 'cascade_lf',
    parallelChestFormantModel: isParallelChestFormant,
    continuousBandLimitedGlottal: isContinuousModal,
    seed,
    sampleRate,
    durationSec: numSamples / sampleRate,
    numSamples,
    voicedCycleCount,
    pitchStart,
    pitchPeakAt: step0At,
    pitchPeak: step0Freq,
    pitchMidAt: step1At,
    pitchMid: step1Freq,
    pitchEnd: step2Freq,
    f1Start,
    f1End,
    f2Start,
    f2End,
    f3Start,
    f3End,
    f4Hz,
    shelf1Hz,
    shelf1GainDb,
    shelf2Hz,
    shelf2GainDb,
    chestDipHz,
    chestDipDb,
    airBypassGain,
    lowCutHz,
    openQuotient: baseOq,
    returnQuotient,
    closingEmphasis,
    aspirationLevel,
    softClipDrive,
    targetPeak,
    effectiveTargetPeak,
    rawPeak,
    glottalDcMean: glottalSampleCount > 0 ? glottalDcSum / glottalSampleCount : 0,
    meanPitchJitterRatio: jitterDiffCount > 0 ? jitterRatioSum / jitterDiffCount : 0,
    meanAmplitudeShimmerRatio: jitterDiffCount > 0 ? shimmerRatioSum / jitterDiffCount : 0,
    subharmonicAlternationRatio:
      subharmonicPairCount > 0 ? subharmonicDiffSum / subharmonicPairCount : 0,
    openClosedAspirationRatio:
      meanClosedAspRms > 1e-7 ? meanOpenAspRms / meanClosedAspRms : meanOpenAspRms > 0 ? 12 : 1,
    peakSample: finalPeak,
  }

  return buffer
}

function playVocalPcmBufferCue(
  ctx,
  dest,
  pcmBuffer,
  {
    delaySec = 0,
    cueGainValue = 0.8,
    highpassHz = 95,
    lowpassHz = 8200,
    kind = 'damage_vocal',
    variant = 'short_grunt',
    profile = 'pain_pressed',
    synthesizer = 'pain_reaction',
    preset = 'damage_short_grunt',
    onComplete = null,
  } = {}
) {
  if (!ctx || !dest || !pcmBuffer || typeof ctx.createBufferSource !== 'function') return null
  const safeDelay = Math.max(0, Number.isFinite(delaySec) ? delaySec : 0)
  const bufDuration =
    Number.isFinite(pcmBuffer.duration) && pcmBuffer.duration > 0
      ? pcmBuffer.duration
      : pcmBuffer.length / (pcmBuffer.sampleRate || ctx.sampleRate || 44100)
  const now = (ctx.currentTime || 0) + safeDelay

  const handle = createCueBusHandle(ctx, dest, {
    cueGainValue,
    highpassHz,
    lowpassHz,
    durationSec: safeDelay + bufDuration,
    kind,
    variant,
    onComplete,
  })
  handle.profile = profile
  handle.synthesizer = synthesizer
  handle.preset = preset
  handle.pcmBuffer = pcmBuffer
  handle.vocalMeta = pcmBuffer._vocalMeta || null

  const src = ctx.createBufferSource()
  src.buffer = pcmBuffer
  src.loop = false
  src.connect(handle.target)
  src.start?.(now)
  src.stop?.(now + bufDuration + 0.005)
  handle.track(src)

  return handle
}

/**
 * Dedicated startled balance-jolt PCM synthesizer ("Huh!" / "Oof!") for the starting elevator landing.
 * Generates a mono PCM AudioBuffer via renderHumanVocalTrackBuffer() using VOCAL_PCM_PRESET_SPECS.elevator_startled
 * as the single source of truth for duration, pitch contour, and formant parameters.
 */
function synthesizeStartledExertionVocalCue(
  ctx,
  dest,
  _noiseBuffer,
  {
    delaySec = 0.08,
    durationSec = null,
    cueGainValue = null,
    pitchStart = null,
    pitchSteps = null,
    seed = null,
    onComplete = null,
  } = {}
) {
  if (!ctx || !dest || typeof ctx.createBufferSource !== 'function') return null
  const baseSpec = VOCAL_PCM_PRESET_SPECS.elevator_startled
  const rawDur = Number(durationSec)
  const safeDur = Math.max(
    0.2,
    Math.min(0.34, Number.isFinite(rawDur) && rawDur > 0 ? rawDur : baseSpec.durationSec)
  )
  const resolvedCueGain =
    Number.isFinite(Number(cueGainValue)) && Number(cueGainValue) > 0
      ? Number(cueGainValue)
      : baseSpec.cueGainValue
  const pcmBuffer = renderHumanVocalTrackBuffer(ctx, {
    preset: 'elevator_startled',
    durationSec: safeDur,
    ...(Number.isFinite(Number(pitchStart)) && Number(pitchStart) > 0
      ? { pitchStart: Number(pitchStart) }
      : {}),
    ...(Array.isArray(pitchSteps) && pitchSteps.length > 0 ? { pitchSteps } : {}),
    seed,
  })
  return playVocalPcmBufferCue(ctx, dest, pcmBuffer, {
    delaySec,
    cueGainValue: resolvedCueGain,
    highpassHz: 42,
    lowpassHz: 3000,
    kind: 'impact_grunt',
    variant: 'balance_shock',
    profile: baseSpec.profile,
    synthesizer: baseSpec.synthesizer,
    preset: 'elevator_startled',
    onComplete,
  })
}

/**
 * Dedicated male pain-reaction PCM synthesizer ("Ugh!" / "Aah!" / "Aaagh...") for enemy and hazard damage.
 * Generates a mono PCM AudioBuffer via renderHumanVocalTrackBuffer() using VOCAL_PCM_PRESET_SPECS[preset]
 * as the single source of truth for duration, pitch contour, and formant parameters.
 */
function synthesizePainVocalCue(
  ctx,
  dest,
  _noiseBuffer,
  {
    variant = 'short_grunt',
    preset = 'damage_short_grunt',
    glottalProfile = null,
    durationSec = null,
    cueGainValue = null,
    pitchStart = null,
    pitchSteps = null,
    seed = null,
    onComplete = null,
  } = {}
) {
  if (!ctx || !dest || typeof ctx.createBufferSource !== 'function') return null
  const presetKey =
    typeof preset === 'string' && preset in VOCAL_PCM_PRESET_SPECS
      ? preset
      : 'damage_short_grunt'
  const baseSpec = VOCAL_PCM_PRESET_SPECS[presetKey]
  const rawDur = Number(durationSec)
  const resolvedDur =
    Number.isFinite(rawDur) && rawDur > 0 ? rawDur : baseSpec.durationSec
  const resolvedCueGain =
    Number.isFinite(Number(cueGainValue)) && Number(cueGainValue) > 0
      ? Number(cueGainValue)
      : baseSpec.cueGainValue
  const resolvedProfile = glottalProfile || baseSpec.profile

  const pcmBuffer = renderHumanVocalTrackBuffer(ctx, {
    preset: presetKey,
    durationSec: resolvedDur,
    ...(Number.isFinite(Number(pitchStart)) && Number(pitchStart) > 0
      ? { pitchStart: Number(pitchStart) }
      : {}),
    ...(Array.isArray(pitchSteps) && pitchSteps.length > 0 ? { pitchSteps } : {}),
    seed,
  })
  return playVocalPcmBufferCue(ctx, dest, pcmBuffer, {
    delaySec: 0,
    cueGainValue: resolvedCueGain,
    highpassHz: 95,
    lowpassHz: 8200,
    kind: 'damage_vocal',
    variant,
    profile: resolvedProfile,
    synthesizer: baseSpec.synthesizer,
    preset: presetKey,
    onComplete,
  })
}

export const PLAYER_BREATH_PROFILES = Object.freeze({
  resting: Object.freeze({
    inhaleDuration: 0.54,
    exhaleDuration: 0.72,
    pauseDuration: 0.06,
    inhaleGain: 0.038,
    exhaleGain: 0.042,
    inhaleFilter: 740,
    exhaleFilter: 380,
    hasChestTone: false,
  }),
  walking: Object.freeze({
    inhaleDuration: 0.40,
    exhaleDuration: 0.54,
    pauseDuration: 0.05,
    inhaleGain: 0.058,
    exhaleGain: 0.064,
    inhaleFilter: 820,
    exhaleFilter: 440,
    hasChestTone: false,
  }),
  running: Object.freeze({
    inhaleDuration: 0.28,
    exhaleDuration: 0.38,
    pauseDuration: 0.04,
    inhaleGain: 0.092,
    exhaleGain: 0.104,
    inhaleFilter: 920,
    exhaleFilter: 520,
    hasChestTone: false,
  }),
  low_stamina: Object.freeze({
    inhaleDuration: 0.34,
    exhaleDuration: 0.48,
    pauseDuration: 0.04,
    inhaleGain: 0.115,
    exhaleGain: 0.128,
    inhaleFilter: 880,
    exhaleFilter: 460,
    hasChestTone: true,
    chestToneFreq: 76,
    chestToneGain: 0.035,
  }),
  exhausted: Object.freeze({
    inhaleDuration: 0.38,
    exhaleDuration: 0.56,
    pauseDuration: 0.04,
    inhaleGain: 0.142,
    exhaleGain: 0.155,
    inhaleFilter: 980,
    exhaleFilter: 420,
    hasChestTone: true,
    chestToneFreq: 70,
    chestToneGain: 0.045,
  }),
  danger: Object.freeze({
    inhaleDuration: 0.26,
    exhaleDuration: 0.32,
    pauseDuration: 0.03,
    inhaleGain: 0.082,
    exhaleGain: 0.088,
    inhaleFilter: 1140,
    exhaleFilter: 580,
    hasChestTone: false,
  }),
  strained: Object.freeze({
    inhaleDuration: 0.36,
    exhaleDuration: 0.48,
    pauseDuration: 0.04,
    inhaleGain: 0.112,
    exhaleGain: 0.124,
    inhaleFilter: 860,
    exhaleFilter: 480,
    hasChestTone: true,
    chestToneFreq: 82,
    chestToneGain: 0.04,
  }),
})

export function triggerPlayerBreathCue(ctx, dest, noiseBuffer, options = {}) {
  if (!ctx || !dest) return null

  let mode = typeof options?.mode === 'string' ? options.mode.toLowerCase() : ''
  if (!PLAYER_BREATH_PROFILES[mode]) {
    if (options?.isStrained) mode = 'strained'
    else if (options?.isExhausted) mode = 'exhausted'
    else if (options?.isLowStamina) mode = 'low_stamina'
    else if (options?.isDanger) mode = 'danger'
    else if (options?.isRunning) mode = 'running'
    else if (options?.isWalking) mode = 'walking'
    else mode = 'resting'
  }

  const profile = PLAYER_BREATH_PROFILES[mode] || PLAYER_BREATH_PROFILES.resting
  const rawIntensity = Number.isFinite(Number(options?.intensity)) && Number(options.intensity) > 0
    ? Number(options.intensity)
    : 1.0
  const intensity = Math.max(0.25, Math.min(1.4, rawIntensity))

  const phase = options?.phase === 'inhale' || options?.phase === 'exhale' ? options.phase : 'cycle'

  const hasSeed = options?.seed !== undefined && options?.seed !== null
  const rng = hasSeed ? () => 0.5 : Math.random
  const jitterDur = 1 + (rng() - 0.5) * 0.08
  const jitterFreq = 1 + (rng() - 0.5) * 0.06

  const inhaleDur = profile.inhaleDuration * jitterDur
  const exhaleDur = profile.exhaleDuration * jitterDur
  const pauseDur = profile.pauseDuration
  const totalDur = phase === 'inhale' ? inhaleDur : phase === 'exhale' ? exhaleDur : inhaleDur + pauseDur + exhaleDur

  // Profile gains (inhaleGain / exhaleGain / chestToneGain) already encode the
  // target amplitude on each layer; multiplying cueGain by maxGain squared the
  // attenuation (e.g. 0.042^2 for resting), making breathing inaudible.
  const cueGainValue = Number.isFinite(Number(options?.cueGainValue)) && Number(options.cueGainValue) > 0
    ? Number(options.cueGainValue)
    : 1.0

  const handle = createCueBusHandle(ctx, dest, {
    cueGainValue,
    durationSec: totalDur,
    kind: 'player_breath',
    variant: mode,
    onComplete: options?.onComplete,
    onStop: options?.onStop,
  })
  handle.mode = mode
  handle.phase = phase

  // Synthesize Inhale airflow
  if (phase === 'cycle' || phase === 'inhale') {
    const inhaleGain = profile.inhaleGain * intensity
    const inhaleF1 = profile.inhaleFilter * jitterFreq
    const inhaleF2 = Math.min(3200, inhaleF1 * 2.5)

    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.target, noiseBuffer, {
          duration: inhaleDur,
          attack: inhaleDur * 0.42,
          gain: inhaleGain,
          filterType: 'bandpass',
          filterFreq: inhaleF1,
          filterFreqEnd: inhaleF1 * 1.15,
          filterQ: 1.8,
          delay: 0,
          offset: rng() * 4.0,
        })
      )
      handle.track(
        playNoiseBurst(ctx, handle.target, noiseBuffer, {
          duration: inhaleDur * 0.85,
          attack: inhaleDur * 0.5,
          gain: inhaleGain * 0.35,
          filterType: 'bandpass',
          filterFreq: inhaleF2,
          filterQ: 2.2,
          delay: 0,
          offset: rng() * 4.0 + 1.0,
        })
      )
    }
  }

  // Synthesize Exhale airflow
  if (phase === 'cycle' || phase === 'exhale') {
    const exhaleDelay = phase === 'cycle' ? inhaleDur + pauseDur : 0
    const exhaleGain = profile.exhaleGain * intensity
    const exhaleF1 = profile.exhaleFilter * jitterFreq

    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.target, noiseBuffer, {
          duration: exhaleDur,
          attack: Math.min(0.12, exhaleDur * 0.22),
          gain: exhaleGain,
          filterType: mode === 'danger' || mode === 'strained' ? 'bandpass' : 'lowpass',
          filterFreq: exhaleF1,
          filterFreqEnd: exhaleF1 * 0.85,
          filterQ: 1.4,
          delay: exhaleDelay,
          offset: rng() * 4.0 + 2.0,
        })
      )
    }

    if (profile.hasChestTone) {
      handle.track(
        playToneBurst(ctx, handle.target, {
          type: 'sine',
          freqStart: (profile.chestToneFreq || 72) * jitterFreq,
          freqEnd: (profile.chestToneFreq || 72) * 0.85 * jitterFreq,
          duration: exhaleDur * 0.75,
          attack: 0.1,
          gain: (profile.chestToneGain || 0.035) * intensity,
          filterType: 'lowpass',
          filterFreq: 180,
          delay: exhaleDelay + 0.03,
        })
      )
    }
  }

  return handle
}

export function triggerPlayerImpactVocalCue(ctx, dest, noiseBuffer, options = {}) {
  if (!ctx || !dest) return null
  const baseSpec = VOCAL_PCM_PRESET_SPECS.elevator_startled
  const delaySec = Number.isFinite(Number(options?.delaySec))
    ? Math.max(0, Math.min(0.12, Number(options.delaySec)))
    : 0.08
  const hasExplicitSeed = options?.seed !== undefined && options?.seed !== null
  const pitchJitter = hasExplicitSeed ? 1.0 : 1 + (Math.random() - 0.5) * 0.04
  const durJitter = hasExplicitSeed ? 1.0 : 1 + (Math.random() - 0.5) * 0.05

  return synthesizeStartledExertionVocalCue(ctx, dest, noiseBuffer, {
    delaySec,
    durationSec: baseSpec.durationSec * durJitter,
    cueGainValue: baseSpec.cueGainValue,
    pitchStart: baseSpec.pitchStart * pitchJitter,
    pitchSteps: [
      { at: baseSpec.pitchPeakAt, freq: baseSpec.pitchPeak * pitchJitter },
      { at: baseSpec.pitchMidAt, freq: baseSpec.pitchMid * pitchJitter },
      { at: 1.0, freq: baseSpec.pitchEnd * pitchJitter },
    ],
    seed: options?.seed,
    onComplete: options?.onComplete,
  })
}

export function triggerPlayerDamageCue(ctx, dest, noiseBuffer, options = {}) {
  if (!ctx || !dest) return null
  const variantInput = options?.variant
  const variantIndex =
    typeof variantInput === 'number' && Number.isFinite(variantInput)
      ? Math.abs(Math.floor(variantInput)) % PLAYER_DAMAGE_VOCAL_VARIANTS.length
      : typeof variantInput === 'string' && PLAYER_DAMAGE_VOCAL_VARIANTS.includes(variantInput)
        ? PLAYER_DAMAGE_VOCAL_VARIANTS.indexOf(variantInput)
        : 0
  const variant = PLAYER_DAMAGE_VOCAL_VARIANTS[variantIndex]
  const presetKey =
    variant === 'sharp_impact'
      ? 'damage_sharp_impact'
      : variant === 'strained_groan'
        ? 'damage_strained_groan'
        : 'damage_short_grunt'
  const baseSpec = VOCAL_PCM_PRESET_SPECS[presetKey]

  const intensity = Math.max(0.85, Math.min(1.08, Number(options?.intensity) || 1.0))
  const hasExplicitSeed = options?.seed !== undefined && options?.seed !== null
  const pitchJitter = hasExplicitSeed ? 1.0 : 1 + (Math.random() - 0.5) * 0.04
  const durJitter = hasExplicitSeed ? 1.0 : 1 + (Math.random() - 0.5) * 0.05
  const minDur = baseSpec.durationSec * 0.85
  const maxDur = baseSpec.durationSec * 1.15

  return synthesizePainVocalCue(ctx, dest, noiseBuffer, {
    variant,
    preset: presetKey,
    glottalProfile: baseSpec.profile,
    durationSec: Math.max(minDur, Math.min(maxDur, baseSpec.durationSec * durJitter)),
    cueGainValue: Math.min(0.88, (baseSpec.cueGainValue ?? 0.8) * intensity),
    pitchStart: baseSpec.pitchStart * pitchJitter,
    pitchSteps: [
      { at: baseSpec.pitchPeakAt, freq: baseSpec.pitchPeak * pitchJitter },
      { at: baseSpec.pitchMidAt, freq: baseSpec.pitchMid * pitchJitter },
      { at: 1.0, freq: baseSpec.pitchEnd * pitchJitter },
    ],
    seed: options?.seed,
    onComplete: options?.onComplete,
  })
}

export function triggerHidingSpotCue(ctx, dest, noiseBuffer, action = 'enter') {
  const isEnter = action === 'enter'
  // Locker door hinge creak + heavy steel latch clunk
  playNoiseBurst(ctx, dest, noiseBuffer, {
    duration: 0.24,
    gain: 0.26,
    filterType: 'bandpass',
    filterFreq: isEnter ? 720 : 540,
    filterFreqEnd: isEnter ? 420 : 880,
    filterQ: 4.5,
  })
  playToneBurst(ctx, dest, {
    type: 'square',
    freqStart: isEnter ? 160 : 210,
    freqEnd: 65,
    duration: 0.09,
    attack: 0.004,
    gain: 0.2,
    filterType: 'lowpass',
    filterFreq: 520,
    delay: isEnter ? 0.14 : 0.02,
  })
}

export function triggerHazardCue(ctx, dest, noiseBuffer, hazardType, state) {
  if (state === 'warning') {
    if (hazardType === 'pressure_plate') {
      // Sharp mechanical trigger click
      playToneBurst(ctx, dest, {
        type: 'square',
        freqStart: 580,
        freqEnd: 240,
        duration: 0.08,
        attack: 0.002,
        gain: 0.28,
        filterType: 'bandpass',
        filterFreq: 1100,
      })
    } else if (hazardType === 'electric_grid') {
      // Capacitor whine buildup
      playToneBurst(ctx, dest, {
        type: 'sawtooth',
        freqStart: 180,
        freqEnd: 620,
        duration: 0.42,
        attack: 0.05,
        gain: 0.18,
        filterType: 'bandpass',
        filterFreq: 1300,
        filterQ: 3.0,
      })
    } else {
      // Floor spikes pneumatic ratchet warning
      playNoiseBurst(ctx, dest, noiseBuffer, {
        duration: 0.14,
        gain: 0.22,
        filterType: 'bandpass',
        filterFreq: 1450,
        filterQ: 3.2,
      })
    }
    return
  }

  if (state === 'active') {
    if (hazardType === 'electric_grid') {
      // Crackle discharge arc
      playNoiseBurst(ctx, dest, noiseBuffer, {
        duration: 0.35,
        gain: 0.36,
        filterType: 'highpass',
        filterFreq: 1600,
        filterFreqEnd: 2800,
        filterQ: 1.8,
      })
      playToneBurst(ctx, dest, {
        type: 'sawtooth',
        freqStart: 120,
        freqEnd: 95,
        duration: 0.32,
        attack: 0.01,
        gain: 0.26,
        filterType: 'bandpass',
        filterFreq: 420,
      })
    } else {
      // Spikes / pressure plate trap slam
      playNoiseBurst(ctx, dest, noiseBuffer, {
        duration: 0.18,
        gain: 0.34,
        filterType: 'highpass',
        filterFreq: 900,
      })
      playToneBurst(ctx, dest, {
        type: 'triangle',
        freqStart: 280,
        freqEnd: 58,
        duration: 0.16,
        attack: 0.003,
        gain: 0.32,
      })
    }
  }
}

export function triggerSubtleHorrorAccent(ctx, dest, noiseBuffer, variant = 0) {
  if (variant % 3 === 0) {
    // Distant structural metallic groan
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: 68,
      freqEnd: 54,
      duration: 1.4,
      attack: 0.28,
      gain: 0.11,
      filterType: 'bandpass',
      filterFreq: 210,
      filterQ: 6.0,
    })
  } else if (variant % 3 === 1) {
    // Cold corridor air draft
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 1.5,
      attack: 0.35,
      gain: 0.12,
      filterType: 'bandpass',
      filterFreq: 420,
      filterFreqEnd: 260,
      filterQ: 3.0,
    })
  } else {
    // Subterranean low knock
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 78,
      freqEnd: 36,
      duration: 0.45,
      attack: 0.01,
      gain: 0.16,
    })
  }
}

export function triggerGameOverCue(ctx, dest, noiseBuffer) {
  playToneBurst(ctx, dest, {
    type: 'sawtooth',
    freqStart: 130,
    freqEnd: 38,
    duration: 1.5,
    attack: 0.03,
    gain: 0.38,
    filterType: 'lowpass',
    filterFreq: 680,
  })
  playToneBurst(ctx, dest, {
    type: 'sine',
    freqStart: 195,
    freqEnd: 46,
    duration: 1.35,
    attack: 0.05,
    gain: 0.3,
    delay: 0.08,
  })
  playNoiseBurst(ctx, dest, noiseBuffer, {
    duration: 0.9,
    attack: 0.04,
    gain: 0.24,
    filterType: 'lowpass',
    filterFreq: 520,
    filterFreqEnd: 120,
  })
}

export function triggerCoinPickupCue(ctx, dest, coinsGained = 1) {
  const pitchLift = coinsGained > 1 ? Math.min(1.22, 1 + (coinsGained - 1) * 0.06) : 1
  // Crisp crystalline two-note chime (B5 -> E6)
  playToneBurst(ctx, dest, {
    type: 'sine',
    freqStart: 987.77 * pitchLift,
    freqEnd: 987.77 * pitchLift,
    duration: 0.11,
    attack: 0.004,
    gain: 0.24,
  })
  playToneBurst(ctx, dest, {
    type: 'sine',
    freqStart: 1318.51 * pitchLift,
    freqEnd: 1330 * pitchLift,
    duration: 0.22,
    attack: 0.005,
    gain: 0.26,
    delay: 0.055,
  })
  playToneBurst(ctx, dest, {
    type: 'triangle',
    freqStart: 1975.53 * pitchLift,
    freqEnd: 2637.02 * pitchLift,
    duration: 0.16,
    attack: 0.004,
    gain: 0.09,
    delay: 0.055,
  })
}

export function triggerCollectiblePickupCue(ctx, dest, itemType = 'soul_shards', meta = {}) {
  if (itemType === 'health_capsule') {
    // Warm organic restorative ascending triad (F4 -> A4 -> C5 -> F5)
    const notes = [349.23, 440.0, 523.25, 698.46]
    for (let i = 0; i < notes.length; i += 1) {
      playToneBurst(ctx, dest, {
        type: i % 2 === 0 ? 'sine' : 'triangle',
        freqStart: notes[i],
        freqEnd: notes[i] * 1.015,
        duration: i === notes.length - 1 ? 0.34 : 0.14,
        attack: 0.008,
        gain: i === notes.length - 1 ? 0.24 : 0.18,
        filterType: 'lowpass',
        filterFreq: 2800,
        delay: i * 0.055,
      })
    }
    return
  }

  if (itemType === 'energy_cell') {
    // Crisp high-voltage battery recharge chirp (290Hz -> 920Hz sweep + E5/B5 lock tone)
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: 290,
      freqEnd: 920,
      duration: 0.22,
      attack: 0.01,
      gain: 0.16,
      filterType: 'lowpass',
      filterFreq: 2100,
    })
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 659.25,
      freqEnd: 987.77,
      duration: 0.24,
      attack: 0.006,
      gain: 0.22,
      delay: 0.075,
    })
    return
  }

  if (itemType === 'soul_shards') {
    const count = Math.max(1, Number(meta?.shardsCollected) || 1)
    const lift = count > 1 ? Math.min(1.18, 1 + (count - 1) * 0.025) : 1
    // Ethereal amethyst crystal resonance chime (D6 -> A6 -> D7 shimmer)
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 1174.66 * lift,
      freqEnd: 1185 * lift,
      duration: 0.16,
      attack: 0.004,
      gain: 0.22,
    })
    playToneBurst(ctx, dest, {
      type: 'triangle',
      freqStart: 1760.0 * lift,
      freqEnd: 1775 * lift,
      duration: 0.26,
      attack: 0.006,
      gain: 0.19,
      filterType: 'lowpass',
      filterFreq: 4200,
      delay: 0.05,
    })
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 2349.32 * lift,
      freqEnd: 2370 * lift,
      duration: 0.28,
      attack: 0.01,
      gain: 0.1,
      delay: 0.095,
    })
    return
  }

  if (itemType === 'time_fragment') {
    // Chrono slow-down downward harmonic warp (740 -> 260 Hz + shimmering crystal fifth)
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 740.0,
      freqEnd: 260.0,
      duration: 0.38,
      attack: 0.008,
      gain: 0.24,
      filterType: 'lowpass',
      filterFreq: 2600,
    })
    playToneBurst(ctx, dest, {
      type: 'triangle',
      freqStart: 1108.73,
      freqEnd: 554.37,
      duration: 0.34,
      attack: 0.01,
      gain: 0.16,
      delay: 0.055,
    })
    return
  }

  if (itemType === 'watchers_eye') {
    // Spectral clairvoyance shimmer (D5 -> A5 -> E6 resonant sweep)
    const notes = [587.33, 880.0, 1318.51]
    for (let i = 0; i < notes.length; i += 1) {
      playToneBurst(ctx, dest, {
        type: 'sine',
        freqStart: notes[i],
        freqEnd: notes[i] * 1.03,
        duration: 0.3,
        attack: 0.012,
        gain: 0.19,
        filterType: 'lowpass',
        filterFreq: 3600,
        delay: i * 0.065,
      })
    }
    return
  }

  if (itemType === 'echo_pulse') {
    // Deep supernatural shockwave sub-punch + cyan ring shimmer
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 185,
      freqEnd: 48,
      duration: 0.42,
      attack: 0.005,
      gain: 0.32,
      filterType: 'lowpass',
      filterFreq: 950,
    })
    playToneBurst(ctx, dest, {
      type: 'triangle',
      freqStart: 987.77,
      freqEnd: 440.0,
      duration: 0.36,
      attack: 0.008,
      gain: 0.21,
      filterType: 'bandpass',
      filterFreq: 1600,
      delay: 0.03,
    })
    return
  }

  if (itemType === 'spirit_lantern') {
    // Radiant warm amber ignition chord (A4 -> C#5 -> E5 -> A5)
    const notes = [440.0, 554.37, 659.25, 880.0]
    for (let i = 0; i < notes.length; i += 1) {
      playToneBurst(ctx, dest, {
        type: i % 2 === 0 ? 'triangle' : 'sine',
        freqStart: notes[i],
        freqEnd: notes[i] * 1.01,
        duration: i === notes.length - 1 ? 0.42 : 0.2,
        attack: 0.01,
        gain: i === notes.length - 1 ? 0.23 : 0.16,
        filterType: 'lowpass',
        filterFreq: 3000,
        delay: i * 0.055,
      })
    }
    return
  }

  // Fallback for echo_reveal and any ability/tactical collectible
  const notes =
    itemType === 'echo_reveal'
      ? [659.25, 830.61, 987.77, 1318.51] // E major crystalline sonar rise
      : itemType === 'spectral_compass'
        ? [523.25, 659.25, 783.99, 1046.5]
        : itemType === 'phantom_veil'
          ? [493.88, 739.99, 987.77]
          : itemType === 'warding_charm'
            ? [392.0, 587.33, 783.99]
            : [587.33, 880.0, 1174.66]

  for (let i = 0; i < notes.length; i += 1) {
    const freq = notes[i]
    playToneBurst(ctx, dest, {
      type: i === notes.length - 1 ? 'sine' : 'triangle',
      freqStart: freq,
      freqEnd: freq * 1.01,
      duration: i === notes.length - 1 ? 0.32 : 0.14,
      attack: 0.006,
      gain: i === notes.length - 1 ? 0.24 : 0.18,
      filterType: 'lowpass',
      filterFreq: 3200,
      delay: i * 0.06,
    })
  }
}

export function triggerPickupRejectedCue(ctx, dest) {
  // Subtle muted low double tap indicating full vitals/battery (non-intrusive)
  playToneBurst(ctx, dest, {
    type: 'triangle',
    freqStart: 220,
    freqEnd: 165,
    duration: 0.09,
    attack: 0.004,
    gain: 0.14,
    filterType: 'lowpass',
    filterFreq: 680,
  })
  playToneBurst(ctx, dest, {
    type: 'triangle',
    freqStart: 185,
    freqEnd: 140,
    duration: 0.1,
    attack: 0.004,
    gain: 0.11,
    filterType: 'lowpass',
    filterFreq: 560,
    delay: 0.065,
  })
}

export function triggerPowerUpPickupCue(ctx, dest, powerUpType = 'wall_pass') {
  triggerCollectiblePickupCue(ctx, dest, powerUpType)
}

export function triggerAbilityActivateCue(ctx, dest, noiseBuffer, abilityType = 'wall_pass_armed') {
  if (abilityType === 'wall_pass_armed') {
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 329.63,
      freqEnd: 659.25,
      duration: 0.24,
      attack: 0.01,
      gain: 0.22,
    })
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.18,
      gain: 0.12,
      filterType: 'bandpass',
      filterFreq: 1200,
      filterFreqEnd: 2400,
      filterQ: 3.0,
    })
    return
  }

  if (abilityType === 'wall_pass_used') {
    playToneBurst(ctx, dest, {
      type: 'triangle',
      freqStart: 220,
      freqEnd: 92,
      duration: 0.28,
      attack: 0.006,
      gain: 0.28,
      filterType: 'lowpass',
      filterFreq: 950,
    })
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.24,
      gain: 0.2,
      filterType: 'bandpass',
      filterFreq: 1600,
      filterFreqEnd: 480,
      filterQ: 2.2,
    })
    return
  }

  if (abilityType === 'echo_reveal_activated') {
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 880,
      freqEnd: 880,
      duration: 0.24,
      attack: 0.004,
      gain: 0.25,
    })
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 1318.51,
      freqEnd: 1318.51,
      duration: 0.34,
      attack: 0.008,
      gain: 0.17,
      delay: 0.11,
    })
    return
  }

  if (abilityType === 'coin_magnet_activated') {
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: 220,
      freqEnd: 440,
      duration: 0.26,
      attack: 0.02,
      gain: 0.18,
      filterType: 'lowpass',
      filterFreq: 1400,
    })
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 659.25,
      freqEnd: 987.77,
      duration: 0.24,
      attack: 0.01,
      gain: 0.2,
      delay: 0.05,
    })
    return
  }

  if (
    abilityType === 'phantom_veil' ||
    abilityType === 'time_fragment' ||
    abilityType === 'watchers_eye' ||
    abilityType === 'echo_pulse'
  ) {
    triggerCollectiblePickupCue(ctx, dest, abilityType)
  }
}

export function triggerExitVictoryCue(ctx, dest) {
  const chord = [523.25, 659.25, 783.99, 987.77, 1046.5]
  for (let i = 0; i < chord.length; i += 1) {
    const isFinal = i === chord.length - 1
    playToneBurst(ctx, dest, {
      type: i % 2 === 0 ? 'triangle' : 'sine',
      freqStart: chord[i],
      freqEnd: chord[i],
      duration: isFinal ? 0.72 : 0.36,
      attack: 0.012,
      gain: isFinal ? 0.28 : 0.2,
      filterType: 'lowpass',
      filterFreq: 3600,
      delay: i * 0.075,
    })
  }
}

export function triggerEnvironmentalDisturbanceCue(ctx, dest, noiseBuffer, variant = 0) {
  const mode = Math.abs(Math.floor(variant)) % 3
  if (mode === 0) {
    // Distant metallic pipe / grate clatter
    playToneBurst(ctx, dest, {
      type: 'triangle',
      freqStart: 410,
      freqEnd: 295,
      duration: 0.34,
      attack: 0.004,
      gain: 0.28,
      filterType: 'bandpass',
      filterFreq: 950,
      filterQ: 4.2,
    })
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 620,
      freqEnd: 480,
      duration: 0.28,
      attack: 0.005,
      gain: 0.22,
      delay: 0.08,
    })
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.16,
      gain: 0.24,
      filterType: 'bandpass',
      filterFreq: 1100,
      filterQ: 2.0,
    })
  } else if (mode === 1) {
    // Unexpected distant locker/door bang & hinge squeak
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.28,
      gain: 0.22,
      filterType: 'bandpass',
      filterFreq: 680,
      filterFreqEnd: 1180,
      filterQ: 5.5,
    })
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 94,
      freqEnd: 38,
      duration: 0.26,
      attack: 0.006,
      gain: 0.36,
      delay: 0.12,
    })
  } else {
    // Overhead vent scrape / breath whisper
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.72,
      attack: 0.12,
      gain: 0.24,
      filterType: 'bandpass',
      filterFreq: 840,
      filterFreqEnd: 420,
      filterQ: 3.4,
    })
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: 120,
      freqEnd: 78,
      duration: 0.48,
      attack: 0.06,
      gain: 0.14,
      filterType: 'lowpass',
      filterFreq: 380,
    })
  }
}

export function triggerLightFailureCue(ctx, dest, noiseBuffer, isBlackout = false) {
  // Relay switch snap + dying ballast buzz
  playNoiseBurst(ctx, dest, noiseBuffer, {
    duration: 0.07,
    gain: 0.26,
    filterType: 'highpass',
    filterFreq: 1800,
  })
  playToneBurst(ctx, dest, {
    type: 'sawtooth',
    freqStart: isBlackout ? 120 : 150,
    freqEnd: isBlackout ? 44 : 98,
    duration: isBlackout ? 0.55 : 0.22,
    attack: 0.008,
    gain: isBlackout ? 0.24 : 0.14,
    filterType: 'bandpass',
    filterFreq: 420,
    filterQ: 2.2,
  })
}

export function triggerPresenceWarningCue(ctx, dest, noiseBuffer, tension = 0.6) {
  const safeTension = Math.max(0, Math.min(1, tension))
  const amp = 0.24 + safeTension * 0.14
  // Clear non-directional heartbeat + low ominous air swell (no sawtooth buzz)
  playToneBurst(ctx, dest, {
    type: 'sine',
    freqStart: 68,
    freqEnd: 44,
    duration: 0.18,
    attack: 0.014,
    gain: amp,
  })
  playToneBurst(ctx, dest, {
    type: 'sine',
    freqStart: 60,
    freqEnd: 40,
    duration: 0.2,
    attack: 0.014,
    gain: amp * 0.8,
    delay: 0.24,
  })
  playToneBurst(ctx, dest, {
    type: 'sine',
    freqStart: 220,
    freqEnd: 185,
    duration: 0.65,
    attack: 0.08,
    gain: 0.12 + safeTension * 0.06,
    filterType: 'lowpass',
    filterFreq: 420,
  })
  if (noiseBuffer) {
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.42,
      attack: 0.1,
      gain: 0.16 + safeTension * 0.08,
      filterType: 'bandpass',
      filterFreq: 460,
      filterFreqEnd: 280,
      filterQ: 1.5,
    })
  }
}

export function triggerSilhouetteStingCue(ctx, dest, noiseBuffer) {
  const handle = createAmbientCueHandle(ctx, dest, 1.62, { setInitialGain: false })
  if (!handle.cueDest) return handle.finish()

  // Layer 1: Distant uncanny human-like formant moan / wavering vocal texture
  handle.track(
    playToneBurst(ctx, handle.cueDest, {
      type: 'triangle',
      freqStart: 312,
      freqSteps: [
        { at: 0.18, freq: 344 },
        { at: 0.44, freq: 286 },
        { at: 0.72, freq: 304 },
        { at: 1.0, freq: 238 },
      ],
      duration: 1.18,
      delay: 0.03,
      filterType: 'bandpass',
      filterFreq: 540,
      filterSteps: [
        { at: 0.28, freq: 780 },
        { at: 0.65, freq: 490 },
        { at: 1.0, freq: 360 },
      ],
      filterQ: 3.4,
      gainSteps: [
        { at: 0.14, gain: 0.21 },
        { at: 0.42, gain: 0.13 },
        { at: 0.64, gain: 0.22 },
        { at: 0.88, gain: 0.06 },
      ],
    })
  )

  // Layer 2: Dissonant narrow metallic resonance & inharmonic eerie beating
  handle.track(
    playToneBurst(ctx, handle.cueDest, {
      type: 'triangle',
      freqStart: 468,
      freqSteps: [
        { at: 0.25, freq: 446 },
        { at: 0.58, freq: 472 },
        { at: 1.0, freq: 421 },
      ],
      duration: 1.34,
      delay: 0.05,
      filterType: 'bandpass',
      filterFreq: 920,
      filterSteps: [
        { at: 0.45, freq: 1180 },
        { at: 1.0, freq: 580 },
      ],
      filterQ: 4.5,
      gainSteps: [
        { at: 0.16, gain: 0.15 },
        { at: 0.48, gain: 0.09 },
        { at: 0.72, gain: 0.13 },
        { at: 0.92, gain: 0.035 },
      ],
    })
  )
  handle.track(
    playToneBurst(ctx, handle.cueDest, {
      type: 'sine',
      freqStart: 634,
      freqSteps: [
        { at: 0.3, freq: 658 },
        { at: 0.68, freq: 618 },
        { at: 1.0, freq: 584 },
      ],
      duration: 1.12,
      delay: 0.09,
      filterType: 'bandpass',
      filterFreq: 860,
      filterQ: 3.8,
      gainSteps: [
        { at: 0.22, gain: 0.11 },
        { at: 0.6, gain: 0.075 },
        { at: 0.9, gain: 0.02 },
      ],
    })
  )

  // Layer 3: Subtle distorted rasping corridor breath + consonant throat flutter
  if (noiseBuffer) {
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: 1.02,
        filterType: 'bandpass',
        filterFreq: 720,
        filterSteps: [
          { at: 0.16, freq: 1460 },
          { at: 0.42, freq: 920 },
          { at: 0.68, freq: 1240 },
          { at: 1.0, freq: 460 },
        ],
        filterQ: 3.6,
        gainSteps: [
          { at: 0.08, gain: 0.18 },
          { at: 0.24, gain: 0.27 },
          { at: 0.5, gain: 0.12 },
          { at: 0.72, gain: 0.21 },
          { at: 0.92, gain: 0.05 },
        ],
        offset: 0.24,
      })
    )
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: 0.58,
        delay: 0.12,
        filterType: 'bandpass',
        filterFreq: 1850,
        filterSteps: [
          { at: 0.35, freq: 1320 },
          { at: 0.75, freq: 1620 },
          { at: 1.0, freq: 820 },
        ],
        filterQ: 5.0,
        gainSteps: [
          { at: 0.18, gain: 0.12 },
          { at: 0.52, gain: 0.07 },
          { at: 0.85, gain: 0.03 },
        ],
        offset: 0.86,
      })
    )

    // Layer 4: Dark atmospheric hollow corridor tail
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: 1.45,
        delay: 0.15,
        filterType: 'bandpass',
        filterFreq: 390,
        filterSteps: [
          { at: 0.3, freq: 310 },
          { at: 0.65, freq: 365 },
          { at: 1.0, freq: 210 },
        ],
        filterQ: 2.4,
        gainSteps: [
          { at: 0.18, gain: 0.14 },
          { at: 0.42, gain: 0.2 },
          { at: 0.74, gain: 0.11 },
          { at: 0.94, gain: 0.03 },
        ],
        offset: 0.52,
      })
    )
  }

  return handle.finish()
}

export function triggerScriptedScareCue(ctx, dest, noiseBuffer, beat = 1) {
  if (beat === 1) {
    // Beat 1: sudden deep vault power drop + metallic shriek sting
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: 135,
      freqEnd: 38,
      duration: 0.72,
      attack: 0.012,
      gain: 0.42,
      filterType: 'lowpass',
      filterFreq: 560,
    })
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.26,
      gain: 0.34,
      filterType: 'highpass',
      filterFreq: 1600,
    })
  } else if (beat === 2) {
    // Beat 2: sharp corridor scrape & dissonant shimmer
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: 277,
      freqEnd: 311,
      duration: 0.45,
      attack: 0.035,
      gain: 0.28,
      filterType: 'bandpass',
      filterFreq: 1150,
      filterQ: 2.8,
    })
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.34,
      gain: 0.32,
      filterType: 'bandpass',
      filterFreq: 1450,
      filterFreqEnd: 620,
    })
  } else {
    // Beat 3: relay restoration hum
    playToneBurst(ctx, dest, {
      type: 'triangle',
      freqStart: 62,
      freqEnd: 110,
      duration: 0.48,
      attack: 0.05,
      gain: 0.26,
      filterType: 'lowpass',
      filterFreq: 480,
    })
  }
}

/**
 * Starts a subtle, speaker-audible underground room-air floor routed to ambienceGain.
 * Uses pure sine harmonics (55/110/165 Hz) with zero looping noise hiss or sawtooth buzz
 * so exploration stays atmospheric without dead silence or intrusive background noise.
 */
export function startAmbientBed(ctx, dest) {
  if (!ctx || !dest || typeof ctx.createOscillator !== 'function') {
    return {
      setStealthDucking: () => {},
      stop: () => {},
    }
  }

  const now = ctx.currentTime || 0
  const bedGain = ctx.createGain()
  const filter = typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null

  if (bedGain.gain) {
    bedGain.gain.setValueAtTime?.(0.0001, now)
    setParamSmooth(bedGain.gain, 0.072, now, 0.45)
  }

  if (filter) {
    filter.type = 'lowpass'
    filter.frequency?.setValueAtTime?.(240, now)
    filter.connect(bedGain)
    bedGain.connect(dest)
  } else {
    bedGain.connect(dest)
  }

  const subDest = filter || bedGain

  // Pure sine harmonic room-air presence (zero noise hiss, zero harsh harmonics)
  const oscA = ctx.createOscillator()
  oscA.type = 'sine'
  oscA.frequency?.setValueAtTime?.(55, now)
  const oscAGain = ctx.createGain()
  if (oscAGain.gain) oscAGain.gain.value = 0.2
  oscA.connect(oscAGain)
  oscAGain.connect(subDest)

  const oscB = ctx.createOscillator()
  oscB.type = 'sine'
  oscB.frequency?.setValueAtTime?.(110, now)
  const oscBGain = ctx.createGain()
  if (oscBGain.gain) oscBGain.gain.value = 0.16
  oscB.connect(oscBGain)
  oscBGain.connect(subDest)

  const oscC = ctx.createOscillator()
  oscC.type = 'sine'
  oscC.frequency?.setValueAtTime?.(165, now)
  const oscCGain = ctx.createGain()
  if (oscCGain.gain) oscCGain.gain.value = 0.065
  oscC.connect(oscCGain)
  oscCGain.connect(subDest)

  oscA.start?.(now)
  oscB.start?.(now)
  oscC.start?.(now)

  let stopped = false

  return {
    setStealthDucking(isHidden) {
      if (stopped) return
      const t = ctx.currentTime || 0
      if (filter?.frequency) {
        setParamSmooth(filter.frequency, isHidden ? 165 : 240, t, 0.18)
      }
      if (bedGain.gain) {
        setParamSmooth(bedGain.gain, isHidden ? 0.04 : 0.072, t, 0.18)
      }
    },
    stop() {
      if (stopped) return
      stopped = true
      const t = ctx.currentTime || 0
      try {
        oscA.stop?.(t + 0.05)
        oscB.stop?.(t + 0.05)
        oscC.stop?.(t + 0.05)
      } catch {
        // Ignore stop calls on unstarted nodes
      }
      try {
        oscA.disconnect()
        oscB.disconnect()
        oscC.disconnect()
        oscAGain.disconnect()
        oscBGain.disconnect()
        oscCGain.disconnect()
        filter?.disconnect()
        bedGain.disconnect()
      } catch {
        // Ignore cleanup errors
      }
    },
  }
}

export const THUNDERSTORM_RAIN_CONSTANTS = Object.freeze({
  bufferDurationSec: 4.8,
  maxSourceGain: 0.014,
  normalGain: 0.011,
  hiddenGain: 0.0055,
  duckedGain: 0.0042,
  hiddenDuckedGain: 0.0028,
  highpassHz: 220,
  lowpassHz: 680,
})

/**
 * Generates a dedicated ~4.8-second pink/storm noise buffer with normalized RMS and
 * a 45ms equal-power head/tail crossfade so rainfall and thunder loop cleanly with zero wrap clicks.
 */
export function createRainNoiseBuffer(ctx, durationSec = THUNDERSTORM_RAIN_CONSTANTS.bufferDurationSec) {
  if (!ctx || typeof ctx.createBuffer !== 'function') return null
  const sampleRate = ctx.sampleRate || 44100
  const safeDuration =
    Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : THUNDERSTORM_RAIN_CONSTANTS.bufferDurationSec
  const length = Math.max(1, Math.floor(sampleRate * safeDuration))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  const overlap =
    length >= 64 ? Math.min(Math.floor(sampleRate * 0.045), Math.floor(length / 4)) : 0
  let b0 = 0
  let b1 = 0
  let b2 = 0
  const nextRawSample = () => {
    const white = Math.random() * 2 - 1
    b0 = 0.996 * b0 + white * 0.032
    b1 = 0.982 * b1 + white * 0.044
    b2 = 0.942 * b2 + white * 0.068
    return b0 + b1 + b2 + white * 0.34
  }

  let sumSq = 0
  for (let i = 0; i < length; i += 1) {
    const sample = nextRawSample()
    data[i] = sample
    sumSq += sample * sample
  }

  const rms = Math.sqrt(sumSq / length)
  const normScale = rms > 1e-6 ? Math.min(0.95, 0.34 / rms) : 0.68
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.max(-0.96, Math.min(0.96, data[i] * normScale))
  }

  if (overlap > 1) {
    for (let i = 0; i < overlap; i += 1) {
      const tailSample = Math.max(-0.96, Math.min(0.96, nextRawSample() * normScale))
      const t = i / (overlap - 1)
      const fadeIn = Math.sin(t * Math.PI * 0.5)
      const fadeOut = Math.cos(t * Math.PI * 0.5)
      let blended = data[i] * fadeIn + tailSample * fadeOut
      if (i === 0) {
        blended = data[length - 1] * 0.5 + blended * 0.5
      }
      data[i] = Math.max(-0.96, Math.min(0.96, blended))
    }
  }

  return buffer
}

/**
 * Starts a subtle, enclosed underground facility rainfall bed routed exclusively to ambienceGain.
 * Uses a single mono-compatible concrete-muffled filter path (220–680 Hz) with zero bright >1 kHz hiss
 * and low continuous gain (<= 0.014) so footsteps, ambient horror cues, enemy sounds, and thunder stay clear.
 */
export function startThunderstormRainBed(ctx, dest, noiseBuffer) {
  if (
    !ctx ||
    !dest ||
    !noiseBuffer ||
    typeof ctx.createBufferSource !== 'function' ||
    typeof ctx.createGain !== 'function'
  ) {
    return {
      setContext: () => {},
      setPaused: () => {},
      stop: () => {},
      getState: () => ({ active: false }),
    }
  }

  const now = ctx.currentTime || 0
  const bufferDuration =
    Number.isFinite(noiseBuffer.duration) && noiseBuffer.duration > 0
      ? noiseBuffer.duration
      : Number.isFinite(noiseBuffer.length) &&
          noiseBuffer.length > 0 &&
          Number.isFinite(noiseBuffer.sampleRate) &&
          noiseBuffer.sampleRate > 0
        ? noiseBuffer.length / noiseBuffer.sampleRate
        : THUNDERSTORM_RAIN_CONSTANTS.bufferDurationSec

  const bedGain = ctx.createGain()
  if (bedGain.gain) {
    bedGain.gain.setValueAtTime?.(0.0001, now)
    setParamSmooth(bedGain.gain, THUNDERSTORM_RAIN_CONSTANTS.normalGain, now, 0.55)
  }
  bedGain.connect(dest)

  // Single mono-compatible enclosed subterranean murmur (zero detuned chorusing or bright HF hiss)
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  src.loop = true
  src.loopStart = 0
  src.loopEnd = bufferDuration

  const hp = typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null
  if (hp) {
    hp.type = 'highpass'
    hp.frequency?.setValueAtTime?.(THUNDERSTORM_RAIN_CONSTANTS.highpassHz, now)
    if (hp.Q) hp.Q.value = 0.65
  }
  const lp = typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null
  if (lp) {
    lp.type = 'lowpass'
    lp.frequency?.setValueAtTime?.(THUNDERSTORM_RAIN_CONSTANTS.lowpassHz, now)
    if (lp.Q) lp.Q.value = 0.62
  }

  if (hp && lp) {
    src.connect(hp)
    hp.connect(lp)
    lp.connect(bedGain)
  } else if (lp) {
    src.connect(lp)
    lp.connect(bedGain)
  } else {
    src.connect(bedGain)
  }

  src.start?.(now, 0)

  let stopped = false
  let paused = false
  let currentHidden = false
  let currentDucked = false
  let currentReducedMotion = false
  let currentBreath = 0.5
  let targetGain = THUNDERSTORM_RAIN_CONSTANTS.normalGain

  const applyTargets = (tau = 0.25) => {
    if (stopped) return
    const t = ctx.currentTime || 0
    const clampedBreath = currentReducedMotion
      ? 0.5
      : Math.max(0, Math.min(1, Number.isFinite(currentBreath) ? currentBreath : 0.5))

    if (currentHidden && currentDucked) {
      targetGain = THUNDERSTORM_RAIN_CONSTANTS.hiddenDuckedGain
    } else if (currentDucked) {
      targetGain = THUNDERSTORM_RAIN_CONSTANTS.duckedGain
    } else if (currentHidden) {
      targetGain = THUNDERSTORM_RAIN_CONSTANTS.hiddenGain
    } else {
      targetGain = THUNDERSTORM_RAIN_CONSTANTS.normalGain
    }

    const baseLp =
      currentHidden && currentDucked
        ? 380
        : currentHidden
          ? 440
          : currentDucked
            ? 520
            : THUNDERSTORM_RAIN_CONSTANTS.lowpassHz
    const drift = currentHidden || currentDucked || currentReducedMotion ? 0 : (clampedBreath - 0.5) * 140

    if (lp?.frequency) {
      setParamSmooth(lp.frequency, baseLp + drift, t, tau)
    }
    if (bedGain.gain) {
      setParamSmooth(bedGain.gain, paused ? 0 : targetGain, t, paused ? 0.025 : tau)
    }
  }

  return {
    setContext({ hidden = false, ducked = false, reducedMotion = false, breath = 0.5 } = {}, tau = 0.28) {
      if (stopped) return
      currentHidden = Boolean(hidden)
      currentDucked = Boolean(ducked)
      currentReducedMotion = Boolean(reducedMotion)
      currentBreath = breath
      applyTargets(tau)
    },
    setPaused(nextPaused) {
      if (stopped) return
      paused = Boolean(nextPaused)
      applyTargets(paused ? 0.025 : 0.18)
    },
    getState() {
      return {
        active: !stopped,
        paused,
        hidden: currentHidden,
        ducked: currentDucked,
        targetGain: paused ? 0 : targetGain,
      }
    },
    stop({ immediate = false } = {}) {
      if (stopped) return
      stopped = true
      const t = ctx.currentTime || 0
      if (bedGain.gain) {
        if (immediate) {
          if (typeof bedGain.gain.cancelScheduledValues === 'function') {
            bedGain.gain.cancelScheduledValues(t)
          }
          if (typeof bedGain.gain.setValueAtTime === 'function') {
            bedGain.gain.setValueAtTime(0, t)
          } else {
            bedGain.gain.value = 0
          }
        } else {
          setParamSmooth(bedGain.gain, 0, t, 0.02)
        }
      }
      try {
        src.stop?.(immediate ? t : t + 0.04)
      } catch {
        // Ignore stop calls on unstarted or already-stopped nodes
      }
      try {
        src.disconnect()
        hp?.disconnect()
        lp?.disconnect()
        bedGain.disconnect()
      } catch {
        // Ignore disconnect errors on already-cleaned nodes
      }
    },
  }
}

/**
 * Adaptive horror music layer. Remains silent during normal ambient/exploration
 * (no continuous background drone or patrolling proximity buzz), swells gently
 * during active enemy investigation/search, and drives a clean rhythmic pulse during chases.
 */
export function startAdaptiveMusicLayer(ctx, dest) {
  if (!ctx || !dest || typeof ctx.createOscillator !== 'function') {
    return {
      setMood: () => {},
      tick: () => {},
      stop: () => {},
    }
  }

  const now = ctx.currentTime || 0
  const musicOut = ctx.createGain()
  if (musicOut.gain) {
    musicOut.gain.setValueAtTime?.(0.0001, now)
  }
  const filter = typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null
  if (filter) {
    filter.type = 'lowpass'
    filter.frequency?.setValueAtTime?.(260, now)
    filter.connect(musicOut)
    musicOut.connect(dest)
  } else {
    musicOut.connect(dest)
  }

  const innerDest = filter || musicOut

  // Clean sine + muted triangle octave pulse (zero minor-second sawtooth buzz)
  const padOsc = ctx.createOscillator()
  padOsc.type = 'sine'
  padOsc.frequency?.setValueAtTime?.(73.42, now) // D2
  const padGain = ctx.createGain()
  if (padGain.gain) padGain.gain.value = 0.0
  padOsc.connect(padGain)
  padGain.connect(innerDest)
  padOsc.start?.(now)

  const tensionOsc = ctx.createOscillator()
  tensionOsc.type = 'triangle'
  tensionOsc.frequency?.setValueAtTime?.(146.83, now) // D3 octave pulse
  const tensionGain = ctx.createGain()
  if (tensionGain.gain) tensionGain.gain.value = 0.0
  tensionOsc.connect(tensionGain)
  tensionGain.connect(innerDest)
  tensionOsc.start?.(now)

  let mood = 'silent'
  let pulsePhase = 0
  let stopped = false

  return {
    setMood(nextMood) {
      if (stopped || nextMood === mood) return
      mood = nextMood
      const t = ctx.currentTime || 0
      if (mood === 'silent' || mood === 'ambient') {
        // Keep normal exploration completely free of continuous drone/buzz
        setParamSmooth(musicOut.gain, 0.0001, t, 0.2)
        if (padGain.gain) setParamSmooth(padGain.gain, 0.0, t, 0.2)
        if (tensionGain.gain) setParamSmooth(tensionGain.gain, 0.0, t, 0.2)
      } else if (mood === 'tension') {
        // Restrained, non-sawtooth breathing tension solely during enemy investigate/search
        setParamSmooth(musicOut.gain, 0.095, t, 0.28)
        if (filter?.frequency) setParamSmooth(filter.frequency, 320, t, 0.28)
        if (padGain.gain) setParamSmooth(padGain.gain, 0.12, t, 0.28)
        if (tensionGain.gain) setParamSmooth(tensionGain.gain, 0.06, t, 0.28)
      } else if (mood === 'chase') {
        setParamSmooth(musicOut.gain, 0.24, t, 0.12)
        if (filter?.frequency) setParamSmooth(filter.frequency, 420, t, 0.12)
        if (padGain.gain) setParamSmooth(padGain.gain, 0.2, t, 0.12)
        if (tensionGain.gain) setParamSmooth(tensionGain.gain, 0.14, t, 0.12)
      }
    },
    tick(delta = 0.016) {
      if (stopped || (mood !== 'chase' && mood !== 'tension')) return
      const rate = mood === 'chase' ? 5.8 : 2.1
      pulsePhase = (pulsePhase + delta * rate) % (Math.PI * 2)
      const pulse = 0.5 + 0.5 * Math.sin(pulsePhase)
      const t = ctx.currentTime || 0
      if (mood === 'tension') {
        if (filter?.frequency) {
          setParamSmooth(filter.frequency, 260 + pulse * 120, t, 0.08)
        }
        if (tensionGain.gain) {
          setParamSmooth(tensionGain.gain, 0.04 + pulse * 0.06, t, 0.08)
        }
        return
      }
      if (filter?.frequency) {
        setParamSmooth(filter.frequency, 260 + pulse * 360, t, 0.04)
      }
      if (tensionGain.gain) {
        setParamSmooth(tensionGain.gain, 0.08 + pulse * 0.16, t, 0.04)
      }
    },
    stop() {
      if (stopped) return
      stopped = true
      const t = ctx.currentTime || 0
      try {
        padOsc.stop?.(t + 0.05)
        tensionOsc.stop?.(t + 0.05)
      } catch {
        // Ignore stop errors
      }
      try {
        padOsc.disconnect()
        tensionOsc.disconnect()
        padGain.disconnect()
        tensionGain.disconnect()
        filter?.disconnect()
        musicOut.disconnect()
      } catch {
        // Ignore cleanup errors
      }
    },
  }
}

export function triggerFlashlightCue(ctx, dest, noiseBuffer, active = true) {
  playToneBurst(ctx, dest, {
    type: 'triangle',
    freqStart: active ? 850 : 620,
    freqEnd: active ? 320 : 410,
    duration: 0.06,
    attack: 0.002,
    gain: 0.22,
  })
  playNoiseBurst(ctx, dest, noiseBuffer, {
    duration: 0.05,
    gain: 0.15,
    filterType: 'highpass',
    filterFreq: 2200,
  })
}

export function triggerStaminaWarningCue(ctx, dest, noiseBuffer, type = 'breathing', options = {}) {
  const mode = type === 'heartbeat' ? 'exhausted' : 'low_stamina'
  return triggerPlayerBreathCue(ctx, dest, noiseBuffer, {
    mode,
    phase: 'cycle',
    ...options,
  })
}

export function triggerKeycardPickupCue(ctx, dest, keysCollected = 1, totalKeys = 1) {
  const ratio = totalKeys > 1 ? (keysCollected - 1) / Math.max(1, totalKeys - 1) : 0
  const lift = 1 + ratio * 0.12
  const notes = [659.25, 880, 1318.51]
  for (let i = 0; i < notes.length; i += 1) {
    const f = notes[i] * lift
    playToneBurst(ctx, dest, {
      type: i === 1 ? 'triangle' : 'sine',
      freqStart: f,
      freqEnd: f * 1.015,
      duration: i === notes.length - 1 ? 0.28 : 0.13,
      attack: 0.004,
      gain: i === notes.length - 1 ? 0.25 : 0.2,
      delay: i * 0.055,
    })
  }
}

export function triggerGateUnlockCue(ctx, dest, noiseBuffer) {
  // Low electromagnetic relay release + filtered air surge
  playToneBurst(ctx, dest, {
    type: 'triangle',
    freqStart: 190,
    freqEnd: 72,
    duration: 0.34,
    attack: 0.01,
    gain: 0.24,
    filterType: 'lowpass',
    filterFreq: 950,
  })
  playNoiseBurst(ctx, dest, noiseBuffer, {
    duration: 0.32,
    attack: 0.02,
    gain: 0.16,
    filterType: 'bandpass',
    filterFreq: 600,
    filterFreqEnd: 1650,
    filterQ: 1.5,
  })

  // Harmonic portal activation chord (C5 -> E5 -> G5 -> C6)
  const chord = [523.25, 659.25, 783.99, 1046.5]
  for (let i = 0; i < chord.length; i += 1) {
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: chord[i],
      freqEnd: chord[i] * 1.008,
      duration: 0.45,
      attack: 0.008,
      gain: 0.2,
      delay: 0.08 + i * 0.075,
    })
  }
}

export function triggerLockedExitCue(ctx, dest) {
  playToneBurst(ctx, dest, {
    type: 'sawtooth',
    freqStart: 155,
    freqEnd: 120,
    duration: 0.14,
    attack: 0.006,
    gain: 0.18,
    filterType: 'lowpass',
    filterFreq: 520,
  })
  playToneBurst(ctx, dest, {
    type: 'sawtooth',
    freqStart: 130,
    freqEnd: 96,
    duration: 0.2,
    attack: 0.006,
    gain: 0.18,
    filterType: 'lowpass',
    filterFreq: 460,
    delay: 0.13,
  })
}

/**
 * Creates a reusable positional 60Hz/120Hz industrial ballast hum voice for
 * overhead ceiling fixtures. Reused across frames to avoid per-frame allocations.
 */
export function createCeilingLightVoice(
  ctx,
  dest,
  { spatialAudio = true, refDistance = 1.9, maxDistance = 13.5 } = {}
) {
  if (!ctx || !dest || typeof ctx.createOscillator !== 'function') {
    return {
      update: () => {},
      silence: () => {},
      stop: () => {},
    }
  }

  const now = ctx.currentTime || 0
  const voiceGain = ctx.createGain()
  if (voiceGain.gain) {
    voiceGain.gain.setValueAtTime?.(0, now)
  }

  const filter =
    typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null
  if (filter) {
    filter.type = 'lowpass'
    filter.frequency?.setValueAtTime?.(780, now)
    if (filter.Q) filter.Q.value = 1.15
  }

  let panner = null
  if (spatialAudio && typeof ctx.createPanner === 'function') {
    panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'linear'
    panner.refDistance = refDistance
    panner.maxDistance = maxDistance
    panner.rolloffFactor = 0
  }

  if (filter) {
    filter.connect(voiceGain)
  }
  if (panner) {
    voiceGain.connect(panner)
    panner.connect(dest)
  } else {
    voiceGain.connect(dest)
  }

  const innerDest = filter || voiceGain

  const humOsc = ctx.createOscillator()
  humOsc.type = 'triangle'
  humOsc.frequency?.setValueAtTime?.(60, now)
  const humGain = ctx.createGain()
  if (humGain.gain) humGain.gain.value = 0.42
  humOsc.connect(humGain)
  humGain.connect(innerDest)

  const buzzOsc = ctx.createOscillator()
  buzzOsc.type = 'sawtooth'
  buzzOsc.frequency?.setValueAtTime?.(120, now)
  const buzzGain = ctx.createGain()
  if (buzzGain.gain) buzzGain.gain.value = 0.22
  buzzOsc.connect(buzzGain)
  buzzGain.connect(innerDest)

  humOsc.start?.(now)
  buzzOsc.start?.(now)

  let stopped = false
  let lastX = NaN
  let lastY = NaN
  let lastZ = NaN
  let lastCutoff = 780
  let lastHumHz = 60
  let lastBuzzHz = 120
  let lastBuzzLevel = 0.22
  let lastGain = 0
  let lastSilenceTau = 0

  return {
    update({
      x = 0,
      y = 3.4,
      z = 0,
      gain = 0,
      cutoff = 780,
      humHz = 60,
      buzzHz = 120,
      buzzLevel = 0.22,
      tau = 0.045,
    } = {}) {
      if (stopped) return
      const t = ctx.currentTime || 0

      if (panner) {
        if (panner.positionX) {
          if (Number.isNaN(lastX) || Math.abs(x - lastX) > 1e-4) {
            setParamSmooth(panner.positionX, x, t, 0.025)
            lastX = x
          }
          if (Number.isNaN(lastY) || Math.abs(y - lastY) > 1e-4) {
            setParamSmooth(panner.positionY, y, t, 0.025)
            lastY = y
          }
          if (Number.isNaN(lastZ) || Math.abs(z - lastZ) > 1e-4) {
            setParamSmooth(panner.positionZ, z, t, 0.025)
            lastZ = z
          }
        } else if (
          Number.isNaN(lastX) ||
          Math.abs(x - lastX) > 1e-4 ||
          Math.abs(y - lastY) > 1e-4 ||
          Math.abs(z - lastZ) > 1e-4
        ) {
          panner.setPosition?.(x, y, z)
          lastX = x
          lastY = y
          lastZ = z
        }
      }

      const safeCutoff = Math.max(180, cutoff)
      if (filter?.frequency && Math.abs(safeCutoff - lastCutoff) > 0.5) {
        setParamSmooth(filter.frequency, safeCutoff, t, 0.035)
        lastCutoff = safeCutoff
      }
      const safeHumHz = Math.max(40, humHz)
      if (humOsc.frequency && Math.abs(safeHumHz - lastHumHz) > 1e-3) {
        setParamSmooth(humOsc.frequency, safeHumHz, t, 0.04)
        lastHumHz = safeHumHz
      }
      const safeBuzzHz = Math.max(80, buzzHz)
      if (buzzOsc.frequency && Math.abs(safeBuzzHz - lastBuzzHz) > 1e-3) {
        setParamSmooth(buzzOsc.frequency, safeBuzzHz, t, 0.04)
        lastBuzzHz = safeBuzzHz
      }
      const safeBuzzLevel = Math.max(0.05, Math.min(0.6, buzzLevel))
      if (buzzGain.gain && Math.abs(safeBuzzLevel - lastBuzzLevel) > 1e-4) {
        setParamSmooth(buzzGain.gain, safeBuzzLevel, t, 0.04)
        lastBuzzLevel = safeBuzzLevel
      }
      const safeGain = Math.max(0, gain)
      if (safeGain > 0) {
        lastSilenceTau = Infinity
      }
      if (
        voiceGain.gain &&
        (Math.abs(safeGain - lastGain) > 1e-5 || (safeGain === 0 && lastGain !== 0))
      ) {
        setParamSmooth(voiceGain.gain, safeGain, t, tau)
        lastGain = safeGain
      }
    },
    silence(tau = 0.03) {
      if (stopped) return
      if (lastGain <= 0 && tau >= lastSilenceTau) return
      const t = ctx.currentTime || 0
      if (voiceGain.gain) {
        setParamSmooth(voiceGain.gain, 0, t, tau)
      }
      lastGain = 0
      lastSilenceTau = tau
    },
    stop() {
      if (stopped) return
      stopped = true
      const t = ctx.currentTime || 0
      try {
        humOsc.stop?.(t + 0.04)
        buzzOsc.stop?.(t + 0.04)
      } catch {
        // Ignore stop errors on already-stopped nodes
      }
      try {
        humOsc.disconnect()
        buzzOsc.disconnect()
        humGain.disconnect()
        buzzGain.disconnect()
        filter?.disconnect()
        panner?.disconnect()
        voiceGain.disconnect()
      } catch {
        // Ignore disconnect errors on already-cleaned nodes
      }
    },
  }
}

/**
 * Restrained industrial fluorescent ballast sputter & faint arc crackle
 * triggered when a flickering fixture enters a visual dip.
 */
export function triggerCeilingLightSputterCue(
  ctx,
  dest,
  noiseBuffer,
  { intensity = 0.7, variant = 0, pitchScale = 1.0 } = {}
) {
  if (!ctx || !dest) return
  const amp = Math.max(0.35, Math.min(1.15, Number(intensity) || 0.7))
  const v = Math.abs(Math.trunc(Number(variant) || 0)) % 3
  const pulseCount = v === 2 ? 3 : 2
  const firstGap = v === 0 ? 0.068 : v === 1 ? 0.052 : 0.046

  for (let i = 0; i < pulseCount; i += 1) {
    const delay = i === 0 ? 0 : firstGap + (i - 1) * 0.062
    const dur = i === 0 ? 0.055 : 0.048
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: (122 + i * 16) * pitchScale,
      freqEnd: (104 + i * 8) * pitchScale,
      duration: dur,
      attack: 0.004,
      gain: (i === 0 ? 0.095 : 0.078) * amp,
      filterType: 'bandpass',
      filterFreq: 520 + i * 110,
      filterQ: 2.0,
      delay,
    })

    if (noiseBuffer) {
      playNoiseBurst(ctx, dest, noiseBuffer, {
        duration: dur * 0.9,
        attack: 0.003,
        gain: (i === 0 ? 0.072 : 0.058) * amp,
        filterType: 'bandpass',
        filterFreq: 1680 - i * 180,
        filterFreqEnd: 920,
        filterQ: 2.5,
        delay,
      })
    }
  }
}

/**
 * Subtle bimetallic starter relay click and brief choke restrike hum when
 * a flickering ceiling tube stabilizes back to brightness.
 */
export function triggerCeilingLightStarterCue(
  ctx,
  dest,
  noiseBuffer,
  { pitchScale = 1.0 } = {}
) {
  if (!ctx || !dest) return
  if (noiseBuffer) {
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.032,
      attack: 0.002,
      gain: 0.075,
      filterType: 'bandpass',
      filterFreq: 2150,
      filterQ: 3.1,
    })
  }
  playToneBurst(ctx, dest, {
    type: 'triangle',
    freqStart: 158 * pitchScale,
    freqEnd: 120 * pitchScale,
    duration: 0.14,
    attack: 0.008,
    gain: 0.072,
    filterType: 'lowpass',
    filterFreq: 560,
    delay: 0.014,
  })
}

/**
 * Subtle ballast choke droop and dry contact crackle for occasional deeper
 * fixture faults.
 */
export function triggerCeilingLightFaultCue(
  ctx,
  dest,
  noiseBuffer,
  { pitchScale = 1.0 } = {}
) {
  if (!ctx || !dest) return
  if (noiseBuffer) {
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.052,
      attack: 0.002,
      gain: 0.068,
      filterType: 'bandpass',
      filterFreq: 1320,
      filterFreqEnd: 740,
      filterQ: 2.2,
    })
  }
  playToneBurst(ctx, dest, {
    type: 'sawtooth',
    freqStart: 134 * pitchScale,
    freqEnd: 68 * pitchScale,
    duration: 0.24,
    attack: 0.006,
    gain: 0.105,
    filterType: 'bandpass',
    filterFreq: 400,
    filterQ: 1.9,
    delay: 0.01,
  })
}

const AMBIENT_CUE_FADE_TAU_SEC = 0.025
const AMBIENT_CUE_CLEANUP_DELAY_MS = 50

function createAmbientCueHandle(
  ctx,
  dest,
  durationSec = 1.0,
  { setInitialGain = true, fadeTauSec = AMBIENT_CUE_FADE_TAU_SEC } = {}
) {
  if (!ctx || !dest) {
    return {
      cueDest: null,
      track: () => null,
      finish: () => ({ durationSec: 0, stop: () => {} }),
    }
  }

  const cueGain = typeof ctx.createGain === 'function' ? ctx.createGain() : null
  if (cueGain) {
    if (cueGain.gain && setInitialGain) {
      setParamSmooth(cueGain.gain, 1, ctx.currentTime || 0, 0.005)
    }
    cueGain.connect?.(dest)
  }

  const cueDest = cueGain || dest
  const nodes = []
  let remaining = 0
  let stopped = false
  let disconnected = false
  let disconnectTimerId = null

  const clearDisconnectTimer = () => {
    if (disconnectTimerId !== null) {
      clearTimeout(disconnectTimerId)
      disconnectTimerId = null
    }
  }

  const disconnectAll = () => {
    if (disconnected) return
    disconnected = true
    clearDisconnectTimer()
    for (let i = 0; i < nodes.length; i += 1) {
      try {
        nodes[i].disconnect?.()
      } catch {
        // Ignore already-disconnected errors
      }
    }
    nodes.length = 0
    if (cueGain) {
      try {
        cueGain.disconnect?.()
      } catch {
        // Ignore already-disconnected errors on cleanup
      }
    }
  }

  const track = (node) => {
    if (!node) return null
    nodes.push(node)
    remaining += 1
    const prevOnEnded = node.onended
    let ended = false
    node.onended = () => {
      if (ended) return
      ended = true
      try {
        prevOnEnded?.()
      } finally {
        remaining -= 1
        if (remaining <= 0 && !stopped) {
          disconnectAll()
        }
      }
    }
    return node
  }

  const stop = (options = {}) => {
    const immediate = Boolean(options?.immediate)
    if (disconnected) return
    if (stopped) {
      if (immediate) {
        disconnectAll()
      }
      return
    }
    stopped = true
    const now = ctx.currentTime || 0

    if (immediate) {
      for (let i = 0; i < nodes.length; i += 1) {
        try {
          nodes[i].stop?.(now)
        } catch {
          // Ignore already-stopped node errors
        }
      }
      if (cueGain?.gain) {
        if (typeof cueGain.gain.cancelScheduledValues === 'function') {
          cueGain.gain.cancelScheduledValues(now)
        }
        if (typeof cueGain.gain.setValueAtTime === 'function') {
          cueGain.gain.setValueAtTime(0, now)
        } else {
          cueGain.gain.value = 0
        }
      }
      disconnectAll()
      return
    }

    const delayMs = Math.max(20, Number(options?.delayMs) || AMBIENT_CUE_CLEANUP_DELAY_MS)
    const stopAtSec = now + delayMs / 1000
    if (cueGain?.gain) {
      setParamSmooth(cueGain.gain, 0, now, fadeTauSec)
    }
    for (let i = 0; i < nodes.length; i += 1) {
      try {
        nodes[i].stop?.(stopAtSec)
      } catch {
        // Ignore already-stopped node errors
      }
    }

    if (typeof options?.scheduleDisconnect === 'function') {
      options.scheduleDisconnect(disconnectAll, delayMs)
    } else {
      clearDisconnectTimer()
      disconnectTimerId = setTimeout(() => {
        disconnectTimerId = null
        disconnectAll()
      }, delayMs)
    }
  }

  return {
    cueDest,
    track,
    finish: () => {
      if (nodes.length === 0) {
        disconnectAll()
        return { durationSec: 0, stop: () => {} }
      }
      return {
        durationSec: Math.max(0, durationSec),
        stop,
      }
    },
  }
}

/**
 * Ambient Category 1: Realistic metallic stick-slip creaks, inharmonic pipe knocks & natural cable/vent snaps.
 * Variant 0: Corroded beam stick-slip friction impulses & non-integer metallic resonance.
 * Variant 1: Irregular hesitant triple pipe-knock with steady inharmonic cylindrical modes.
 * Variant 2: Startling steel cable / vent-seam fracture snap & damped panel shudder.
 */
export function triggerAmbientCreakOrKnockCue(
  ctx,
  dest,
  noiseBuffer,
  { variant = 0, pitchScale = 1.0, intensity = 0.94 } = {}
) {
  const safeVariant = Math.abs(Math.trunc(variant)) % 3
  const scale = Math.max(0.75, Math.min(1.35, pitchScale))
  const amp = Math.max(0.25, Math.min(1.25, intensity))
  const cueDur = safeVariant === 0 ? 2.35 : safeVariant === 1 ? 1.55 : 1.75
  const handle = createAmbientCueHandle(ctx, dest, cueDur)
  if (!handle.cueDest) return handle.finish()

  if (safeVariant === 0) {
    // Metallic stick-slip creak: irregular friction micro-slips + inharmonic metal modes
    const slipClicks = [
      { delay: 0.0, freq: 1120, dur: 0.042, gain: 0.14 },
      { delay: 0.14, freq: 1380, dur: 0.036, gain: 0.16 },
      { delay: 0.25, freq: 980, dur: 0.045, gain: 0.15 },
      { delay: 0.34, freq: 1540, dur: 0.034, gain: 0.18 },
      { delay: 0.57, freq: 1210, dur: 0.048, gain: 0.19 },
      { delay: 0.81, freq: 1690, dur: 0.038, gain: 0.17 },
      { delay: 1.16, freq: 940, dur: 0.052, gain: 0.13 },
    ]
    if (noiseBuffer) {
      for (let i = 0; i < slipClicks.length; i += 1) {
        const s = slipClicks[i]
        handle.track(
          playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
            duration: s.dur,
            attack: 0.003,
            gain: s.gain * amp,
            filterType: 'bandpass',
            filterFreq: s.freq * scale,
            filterFreqEnd: s.freq * 0.72 * scale,
            filterQ: 5.2,
            delay: s.delay,
            offset: (0.12 + i * 0.23) % 1.4,
          })
        )
      }
      // Continuous grating bowed-metal friction bed binding the stick-slip pulses
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 1.72,
          delay: 0.06,
          filterType: 'bandpass',
          filterFreq: 1080 * scale,
          filterSteps: [
            { at: 0.18, freq: 680 * scale },
            { at: 0.42, freq: 940 * scale },
            { at: 0.7, freq: 560 * scale },
            { at: 1.0, freq: 410 * scale },
          ],
          filterQ: 3.6,
          gainSteps: [
            { at: 0.08, gain: 0.14 * amp },
            { at: 0.22, gain: 0.07 * amp },
            { at: 0.44, gain: 0.21 * amp },
            { at: 0.68, gain: 0.18 * amp },
            { at: 0.86, gain: 0.09 * amp },
          ],
          offset: 0.2,
        })
      )
    }

    // Inharmonic metal structural modes (1 : 1.49 ratio) stuttering with slip/grip modulation
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sawtooth',
        freqStart: 174 * scale,
        freqSteps: [
          { at: 0.16, freq: 186 * scale },
          { at: 0.34, freq: 168 * scale },
          { at: 0.58, freq: 194 * scale },
          { at: 0.82, freq: 158 * scale },
          { at: 1.0, freq: 146 * scale },
        ],
        duration: 1.88,
        gainSteps: [
          { at: 0.08, gain: 0.13 * amp },
          { at: 0.2, gain: 0.05 * amp },
          { at: 0.38, gain: 0.21 * amp },
          { at: 0.56, gain: 0.09 * amp },
          { at: 0.74, gain: 0.22 * amp },
          { at: 0.9, gain: 0.06 * amp },
        ],
        filterType: 'bandpass',
        filterFreq: 520 * scale,
        filterSteps: [
          { at: 0.35, freq: 680 * scale },
          { at: 0.7, freq: 580 * scale },
          { at: 1.0, freq: 390 * scale },
        ],
        filterQ: 4.0,
        delay: 0.04,
      })
    )
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'triangle',
        freqStart: 259 * scale,
        freqSteps: [
          { at: 0.2, freq: 278 * scale },
          { at: 0.48, freq: 248 * scale },
          { at: 0.75, freq: 266 * scale },
          { at: 1.0, freq: 218 * scale },
        ],
        duration: 1.72,
        gainSteps: [
          { at: 0.1, gain: 0.09 * amp },
          { at: 0.28, gain: 0.04 * amp },
          { at: 0.48, gain: 0.16 * amp },
          { at: 0.72, gain: 0.15 * amp },
          { at: 0.9, gain: 0.05 * amp },
        ],
        filterType: 'bandpass',
        filterFreq: 840 * scale,
        filterQ: 4.2,
        delay: 0.09,
      })
    )
  } else if (safeVariant === 1) {
    // Unnerving irregular triple pipe-knock with steady inharmonic cylindrical shell modes
    const knocks = [
      { delay: 0, gainScale: 1.0, pitchShift: 1.0 },
      { delay: 0.33, gainScale: 0.74, pitchShift: 0.97 },
      { delay: 0.96, gainScale: 0.88, pitchShift: 1.04 },
    ]
    for (let i = 0; i < knocks.length; i += 1) {
      const k = knocks[i]
      const f0 = 308 * scale * k.pitchShift
      // Sharp mechanical impact transient + brief damped contact thud
      if (noiseBuffer) {
        handle.track(
          playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
            duration: 0.045,
            attack: 0.002,
            gain: 0.22 * amp * k.gainScale,
            filterType: 'bandpass',
            filterFreq: 1220 * scale,
            filterFreqEnd: 580 * scale,
            filterQ: 2.2,
            delay: k.delay,
            offset: 0.28 + i * 0.25,
          })
        )
      }
      handle.track(
        playToneBurst(ctx, handle.cueDest, {
          type: 'triangle',
          freqStart: 158 * scale * k.pitchShift,
          freqEnd: 76 * scale * k.pitchShift,
          duration: 0.055,
          attack: 0.002,
          gain: 0.18 * amp * k.gainScale,
          filterType: 'lowpass',
          filterFreq: 340 * scale,
          delay: k.delay,
        })
      )
      // Steady inharmonic pipe modal partials (1.0 : 1.63 : 2.71, upper modes decay faster)
      handle.track(
        playToneBurst(ctx, handle.cueDest, {
          type: 'triangle',
          freqStart: f0,
          freqEnd: f0 * 0.99,
          duration: 0.46,
          attack: 0.004,
          gain: 0.24 * amp * k.gainScale,
          filterType: 'bandpass',
          filterFreq: 420 * scale,
          filterQ: 3.5,
          delay: k.delay,
        })
      )
      handle.track(
        playToneBurst(ctx, handle.cueDest, {
          type: 'sine',
          freqStart: f0 * 1.63,
          freqEnd: f0 * 1.62,
          duration: 0.3,
          attack: 0.003,
          gain: 0.16 * amp * k.gainScale,
          filterType: 'bandpass',
          filterFreq: 640 * scale,
          filterQ: 3.8,
          delay: k.delay + 0.004,
        })
      )
      handle.track(
        playToneBurst(ctx, handle.cueDest, {
          type: 'sine',
          freqStart: f0 * 2.71,
          freqEnd: f0 * 2.7,
          duration: 0.15,
          attack: 0.002,
          gain: 0.11 * amp * k.gainScale,
          filterType: 'bandpass',
          filterFreq: 920 * scale,
          filterQ: 4.0,
          delay: k.delay + 0.003,
        })
      )
    }
  } else {
    // Sharp natural steel cable / vent-seam SNAP + damped sheet-metal shudder
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.045,
          attack: 0.002,
          gain: 0.31 * amp,
          filterType: 'bandpass',
          filterFreq: 2150 * scale,
          filterFreqEnd: 760 * scale,
          filterQ: 1.6,
          offset: 0.45,
        })
      )
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.11,
          attack: 0.002,
          gain: 0.26 * amp,
          filterType: 'bandpass',
          filterFreq: 740 * scale,
          filterFreqEnd: 260 * scale,
          filterQ: 1.4,
          offset: 0.72,
        })
      )
      // Delayed sheet-metal vent panel shudder + low duct vibration tail
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.15,
          attack: 0.005,
          gain: 0.19 * amp,
          filterType: 'bandpass',
          filterFreq: 960 * scale,
          filterFreqEnd: 410 * scale,
          filterQ: 3.2,
          delay: 0.085,
          offset: 0.18,
        })
      )
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 1.12,
          attack: 0.04,
          gain: 0.16 * amp,
          filterType: 'bandpass',
          filterFreq: 310 * scale,
          filterFreqEnd: 140 * scale,
          filterQ: 2.8,
          delay: 0.055,
          offset: 0.95,
        })
      )
    }
    // Brief damped stiff-wire / plate twang (minimal natural tension drop, zero synth laser sweep)
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'triangle',
        freqStart: 346 * scale,
        freqEnd: 332 * scale,
        duration: 0.18,
        attack: 0.002,
        gain: 0.2 * amp,
        filterType: 'bandpass',
        filterFreq: 680 * scale,
        filterQ: 2.6,
      })
    )
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sine',
        freqStart: 572 * scale,
        freqEnd: 554 * scale,
        duration: 0.13,
        attack: 0.002,
        gain: 0.14 * amp,
        filterType: 'bandpass',
        filterFreq: 860 * scale,
        filterQ: 3.0,
        delay: 0.004,
      })
    )
  }

  return handle.finish()
}

/**
 * Ambient Category 2: Layered, modulated low-frequency underground noise, structural vibration & settling debris.
 * Eliminates musical bass oscillators in favor of organic broadband tremors.
 * Variant 0: Deep tectonic noise roll + structural floor vibration.
 * Variant 1: Shifting seismic vibration + subtle settling gravel/dust debris.
 * Variant 2: Startling cavity pressure thud + cavern tremor + delayed ceiling debris.
 */
export function triggerAmbientUndergroundRumbleCue(
  ctx,
  dest,
  noiseBuffer,
  { variant = 0, durationSec = 3.1, pitchScale = 1.0, intensity = 0.94 } = {}
) {
  const safeVariant = Math.abs(Math.trunc(variant)) % 3
  const dur = Math.max(2.0, Math.min(4.0, durationSec))
  const variantShift = [1.0, 0.94, 1.08][safeVariant]
  const scale = Math.max(0.75, Math.min(1.35, pitchScale)) * variantShift
  const amp = Math.max(0.25, Math.min(1.25, intensity))
  const handle = createAmbientCueHandle(ctx, dest, dur)
  if (!handle.cueDest) return handle.finish()

  if (safeVariant === 2) {
    // Non-musical cavity pressure thump (broadband low burst + ultra-brief damped sub-impulse)
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.24,
          attack: 0.008,
          gain: 0.3 * amp,
          filterType: 'lowpass',
          filterFreq: 320 * scale,
          filterFreqEnd: 95,
          offset: 0.18,
        })
      )
      // Blooming modulated cavern noise & structural vibration
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: dur * 0.88,
          delay: 0.12,
          filterType: 'lowpass',
          filterFreq: 250 * scale,
          filterSteps: [
            { at: 0.25, freq: 185 * scale },
            { at: 0.55, freq: 240 * scale },
            { at: 1.0, freq: 120 },
          ],
          gainSteps: [
            { at: 0.16, gain: 0.27 * amp },
            { at: 0.45, gain: 0.19 * amp },
            { at: 0.72, gain: 0.25 * amp },
            { at: 0.92, gain: 0.09 * amp },
          ],
          offset: 0.42,
        })
      )
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: dur * 0.82,
          delay: 0.16,
          filterType: 'bandpass',
          filterFreq: 440 * scale,
          filterSteps: [
            { at: 0.3, freq: 310 * scale },
            { at: 0.62, freq: 390 * scale },
            { at: 1.0, freq: 190 },
          ],
          filterQ: 1.4,
          gainSteps: [
            { at: 0.18, gain: 0.24 * amp },
            { at: 0.5, gain: 0.14 * amp },
            { at: 0.76, gain: 0.2 * amp },
            { at: 0.94, gain: 0.06 * amp },
          ],
          offset: 0.85,
        })
      )
      // Subtle settling ceiling grit/debris after cavity thump
      const debrisDelays = [0.58, 1.04, 1.66]
      const debrisFreqs = [1320, 1840, 1490]
      for (let i = 0; i < debrisDelays.length; i += 1) {
        handle.track(
          playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
            duration: 0.045 + i * 0.012,
            attack: 0.004,
            gain: (0.1 - i * 0.014) * amp,
            filterType: 'bandpass',
            filterFreq: debrisFreqs[i],
            filterFreqEnd: 740,
            filterQ: 2.1,
            delay: debrisDelays[i],
            offset: (0.25 + i * 0.37) % 1.3,
          })
        )
      }
    }
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sine',
        freqStart: 84 * scale,
        freqEnd: 34,
        duration: 0.14,
        attack: 0.005,
        gain: 0.22 * amp,
        filterType: 'lowpass',
        filterFreq: 155,
      })
    )
    return handle.finish()
  }

  if (safeVariant === 1) {
    // Shifting seismic vibration + subtle settling dust/gravel debris (zero oscillators)
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: dur * 0.94,
          filterType: 'lowpass',
          filterFreq: 185 * scale,
          filterSteps: [
            { at: 0.26, freq: 245 * scale },
            { at: 0.54, freq: 155 * scale },
            { at: 0.78, freq: 215 * scale },
            { at: 1.0, freq: 120 },
          ],
          gainSteps: [
            { at: 0.22, gain: 0.17 * amp },
            { at: 0.48, gain: 0.29 * amp },
            { at: 0.7, gain: 0.2 * amp },
            { at: 0.88, gain: 0.11 * amp },
          ],
          offset: 0.35,
        })
      )
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: dur * 0.88,
          delay: 0.08,
          filterType: 'bandpass',
          filterFreq: 340 * scale,
          filterSteps: [
            { at: 0.3, freq: 440 * scale },
            { at: 0.65, freq: 260 * scale },
            { at: 1.0, freq: 185 },
          ],
          filterQ: 1.5,
          gainSteps: [
            { at: 0.25, gain: 0.16 * amp },
            { at: 0.52, gain: 0.27 * amp },
            { at: 0.82, gain: 0.11 * amp },
          ],
          offset: 0.92,
        })
      )
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: dur * 0.56,
          delay: dur * 0.18,
          filterType: 'bandpass',
          filterFreq: 135 * scale,
          filterFreqEnd: 92,
          filterQ: 3.4,
          gainSteps: [
            { at: 0.24, gain: 0.16 * amp },
            { at: 0.55, gain: 0.08 * amp },
            { at: 0.8, gain: 0.15 * amp },
          ],
          offset: 0.14,
        })
      )
      // Subtle settling debris patters in the tremor tail
      const debris = [
        { delay: dur * 0.44, freq: 1480, dur: 0.042, gain: 0.085 },
        { delay: dur * 0.56, freq: 1920, dur: 0.036, gain: 0.095 },
        { delay: dur * 0.69, freq: 1240, dur: 0.055, gain: 0.075 },
        { delay: dur * 0.8, freq: 1680, dur: 0.048, gain: 0.065 },
      ]
      for (let i = 0; i < debris.length; i += 1) {
        const d = debris[i]
        handle.track(
          playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
            duration: d.dur,
            attack: 0.004,
            gain: d.gain * amp,
            filterType: 'bandpass',
            filterFreq: d.freq,
            filterFreqEnd: 720,
            filterQ: 2.0,
            delay: d.delay,
            offset: (0.4 + i * 0.31) % 1.4,
          })
        )
      }
    }
    return handle.finish()
  }

  // Variant 0: Layered, irregularly modulated low-frequency tectonic noise & structural vibration
  if (noiseBuffer) {
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: dur * 0.98,
        filterType: 'lowpass',
        filterFreq: 170 * scale,
        filterSteps: [
          { at: 0.24, freq: 235 * scale },
          { at: 0.48, freq: 145 * scale },
          { at: 0.74, freq: 210 * scale },
          { at: 1.0, freq: 120 },
        ],
        gainSteps: [
          { at: 0.2, gain: 0.15 * amp },
          { at: 0.42, gain: 0.28 * amp },
          { at: 0.62, gain: 0.18 * amp },
          { at: 0.8, gain: 0.29 * amp },
          { at: 0.94, gain: 0.1 * amp },
        ],
        offset: 0.15,
      })
    )
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: dur * 0.96,
        filterType: 'bandpass',
        filterFreq: 305 * scale,
        filterSteps: [
          { at: 0.28, freq: 430 * scale },
          { at: 0.56, freq: 255 * scale },
          { at: 0.8, freq: 380 * scale },
          { at: 1.0, freq: 195 },
        ],
        filterQ: 1.45,
        gainSteps: [
          { at: 0.22, gain: 0.11 * amp },
          { at: 0.46, gain: 0.25 * amp },
          { at: 0.68, gain: 0.15 * amp },
          { at: 0.84, gain: 0.27 * amp },
          { at: 0.95, gain: 0.08 * amp },
        ],
        offset: 0.65,
      })
    )
    // Structural slab/floor shudder modulation band
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: dur * 0.95,
        filterType: 'bandpass',
        filterFreq: 118 * scale,
        filterSteps: [
          { at: 0.3, freq: 162 * scale },
          { at: 0.6, freq: 108 * scale },
          { at: 0.85, freq: 152 * scale },
          { at: 1.0, freq: 96 },
        ],
        filterQ: 3.2,
        gainSteps: [
          { at: 0.18, gain: 0.05 * amp },
          { at: 0.36, gain: 0.16 * amp },
          { at: 0.52, gain: 0.06 * amp },
          { at: 0.7, gain: 0.18 * amp },
          { at: 0.86, gain: 0.13 * amp },
        ],
        offset: 1.05,
      })
    )
  }

  return handle.finish()
}

/**
 * Ambient Category 3: Filtered turbulent vent airflow, irregular modulation & subtle vent rattles.
 * Eliminates flute-like sine whistle oscillators completely.
 */
export function triggerAmbientVentWindCue(
  ctx,
  dest,
  noiseBuffer,
  { variant = 0, durationSec = 3.2, intensity = 0.94 } = {}
) {
  const safeVariant = Math.abs(Math.trunc(variant)) % 3
  const dur = Math.max(2.2, Math.min(4.2, durationSec))
  const amp = Math.max(0.25, Math.min(1.25, intensity))
  const handle = createAmbientCueHandle(ctx, dest, dur)
  if (!handle.cueDest || !noiseBuffer) return handle.finish()

  if (safeVariant === 2) {
    // Startling sudden shaft gust + swirling back-draft + loose damper rattle
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: dur * 0.82,
        filterType: 'bandpass',
        filterFreq: 410,
        filterSteps: [
          { at: 0.14, freq: 1380 },
          { at: 0.36, freq: 820 },
          { at: 0.58, freq: 1120 },
          { at: 0.8, freq: 450 },
          { at: 1.0, freq: 330 },
        ],
        filterQ: 2.0,
        gainSteps: [
          { at: 0.08, gain: 0.31 * amp },
          { at: 0.28, gain: 0.18 * amp },
          { at: 0.52, gain: 0.26 * amp },
          { at: 0.78, gain: 0.11 * amp },
        ],
        offset: 0.7,
      })
    )
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: dur * 0.72,
        delay: dur * 0.18,
        filterType: 'bandpass',
        filterFreq: 940,
        filterSteps: [
          { at: 0.35, freq: 560 },
          { at: 0.68, freq: 790 },
          { at: 1.0, freq: 380 },
        ],
        filterQ: 2.6,
        gainSteps: [
          { at: 0.22, gain: 0.21 * amp },
          { at: 0.58, gain: 0.16 * amp },
          { at: 0.88, gain: 0.07 * amp },
        ],
        offset: 1.15,
      })
    )
    // Damper flap thud & metallic grille rattles caught by sudden gust
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: 0.09,
        attack: 0.004,
        gain: 0.14 * amp,
        filterType: 'lowpass',
        filterFreq: 340,
        filterFreqEnd: 155,
        delay: 0.06,
        offset: 0.15,
      })
    )
    const gustRattles = [0.08, 0.23, 0.5]
    for (let i = 0; i < gustRattles.length; i += 1) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.05 + i * 0.012,
          attack: 0.003,
          gain: (0.14 - i * 0.02) * amp,
          filterType: 'bandpass',
          filterFreq: 1480 - i * 240,
          filterFreqEnd: 720,
          filterQ: 3.8,
          delay: gustRattles[i],
          offset: (0.3 + i * 0.29) % 1.3,
        })
      )
    }
    return handle.finish()
  }

  if (safeVariant === 1) {
    // Irregular cross-draft turbulence + subtle loose louver rattles
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: dur * 0.82,
        filterType: 'bandpass',
        filterFreq: 560,
        filterSteps: [
          { at: 0.22, freq: 1180 },
          { at: 0.48, freq: 720 },
          { at: 0.72, freq: 1020 },
          { at: 1.0, freq: 410 },
        ],
        filterQ: 2.3,
        gainSteps: [
          { at: 0.2, gain: 0.26 * amp },
          { at: 0.44, gain: 0.15 * amp },
          { at: 0.68, gain: 0.27 * amp },
          { at: 0.9, gain: 0.08 * amp },
        ],
        offset: 0.35,
      })
    )
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: dur * 0.74,
        delay: dur * 0.16,
        filterType: 'bandpass',
        filterFreq: 980,
        filterSteps: [
          { at: 0.32, freq: 610 },
          { at: 0.65, freq: 860 },
          { at: 1.0, freq: 440 },
        ],
        filterQ: 3.1,
        gainSteps: [
          { at: 0.26, gain: 0.21 * amp },
          { at: 0.56, gain: 0.12 * amp },
          { at: 0.8, gain: 0.19 * amp },
        ],
        offset: 0.9,
      })
    )
    // Subtle metallic vent-vane rattles when cross-draft peaks
    const rattles = [
      { delay: dur * 0.27, freq: 1620, dur: 0.042, gain: 0.095 },
      { delay: dur * 0.43, freq: 1340, dur: 0.056, gain: 0.11 },
      { delay: dur * 0.67, freq: 1780, dur: 0.045, gain: 0.085 },
    ]
    for (let i = 0; i < rattles.length; i += 1) {
      const r = rattles[i]
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: r.dur,
          attack: 0.003,
          gain: r.gain * amp,
          filterType: 'bandpass',
          filterFreq: r.freq,
          filterFreqEnd: 880,
          filterQ: 4.6,
          delay: r.delay,
          offset: (0.22 + i * 0.33) % 1.3,
        })
      )
    }
    return handle.finish()
  }

  // Variant 0: Layered, irregularly modulated turbulent airflow (zero sine whistle)
  handle.track(
    playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
      duration: dur * 0.88,
      filterType: 'bandpass',
      filterFreq: 320,
      filterSteps: [
        { at: 0.2, freq: 690 },
        { at: 0.44, freq: 430 },
        { at: 0.68, freq: 890 },
        { at: 0.86, freq: 510 },
        { at: 1.0, freq: 350 },
      ],
      filterQ: 2.1,
      gainSteps: [
        { at: 0.18, gain: 0.24 * amp },
        { at: 0.4, gain: 0.14 * amp },
        { at: 0.65, gain: 0.28 * amp },
        { at: 0.86, gain: 0.15 * amp },
      ],
      offset: 0.1,
    })
  )
  handle.track(
    playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
      duration: dur * 0.8,
      delay: dur * 0.12,
      filterType: 'bandpass',
      filterFreq: 760,
      filterSteps: [
        { at: 0.26, freq: 480 },
        { at: 0.54, freq: 1060 },
        { at: 0.82, freq: 620 },
        { at: 1.0, freq: 400 },
      ],
      filterQ: 2.8,
      gainSteps: [
        { at: 0.24, gain: 0.21 * amp },
        { at: 0.52, gain: 0.12 * amp },
        { at: 0.76, gain: 0.24 * amp },
      ],
      offset: 0.65,
    })
  )
  // Narrow turbulent duct-edge air resonance (filtered noise eddy, not a sine whistle)
  handle.track(
    playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
      duration: dur * 0.76,
      delay: dur * 0.08,
      filterType: 'bandpass',
      filterFreq: 450,
      filterSteps: [
        { at: 0.25, freq: 610 },
        { at: 0.55, freq: 480 },
        { at: 0.78, freq: 570 },
        { at: 1.0, freq: 410 },
      ],
      filterQ: 6.0,
      gainSteps: [
        { at: 0.22, gain: 0.11 * amp },
        { at: 0.5, gain: 0.05 * amp },
        { at: 0.76, gain: 0.13 * amp },
      ],
      offset: 1.1,
    })
  )

  return handle.finish()
}

/**
 * Ambient Category 4: Distant retreating footsteps with muffled corridor noise reflections.
 * Eliminates pitched echo tones; consecutive steps soften and darken with convincing distance.
 */
export function triggerAmbientDistantEchoStepsCue(
  ctx,
  dest,
  noiseBuffer,
  { variant = 0, stepCount = 3, pitchScale = 1.0, intensity = 0.86 } = {}
) {
  const safeVariant = Math.abs(Math.trunc(variant)) % 3
  const steps = safeVariant === 1 ? 4 : Math.max(2, Math.min(4, Math.trunc(stepCount)))
  const scale = Math.max(0.75, Math.min(1.35, pitchScale))
  const amp = Math.max(0.25, Math.min(1.25, intensity))

  const stepTimes = []
  if (safeVariant === 1) {
    // Uneven hesitating/limping retreat cadence (long pause, quick drag-step, pause)
    stepTimes.push(0, 0.86, 1.2, 2.04)
  } else if (safeVariant === 2) {
    // Brief distant scurrying retreat into silence
    for (let i = 0; i < steps; i += 1) {
      stepTimes.push(i * 0.36)
    }
  } else {
    for (let i = 0; i < steps; i += 1) {
      stepTimes.push(i * 0.72 + (i % 2 === 1 ? 0.05 : 0))
    }
  }

  const cueDur = (stepTimes[stepTimes.length - 1] || 1.2) + 0.65
  const handle = createAmbientCueHandle(ctx, dest, cueDur)
  if (!handle.cueDest || !noiseBuffer) return handle.finish()

  const baseCutoff = (safeVariant === 2 ? 960 : 760) * scale

  for (let i = 0; i < stepTimes.length; i += 1) {
    const stepDelay = stepTimes[i]
    // Convincing retreating distance: progressive amplitude decay AND high-frequency darkening
    const retreatDecay =
      safeVariant === 2
        ? Math.pow(0.64, i)
        : safeVariant === 1
          ? [1.0, 0.76, 0.58, 0.42][i] ?? 0.4
          : Math.pow(0.7, i)
    const stepCutoff = Math.max(300, baseCutoff * Math.pow(0.78, i))

    // Muffled sole/heel contact thud (noise-only, zero pitched sine/triangle tones)
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: 0.09,
        attack: 0.012,
        gain: 0.24 * amp * retreatDecay,
        filterType: 'lowpass',
        filterFreq: Math.max(240, stepCutoff * 0.65),
        filterFreqEnd: Math.max(150, stepCutoff * 0.32),
        delay: stepDelay,
        offset: (0.08 + i * 0.23) % 1.2,
      })
    )

    // Soft concrete grit / drag scuff (longer on hesitant drag step)
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: safeVariant === 1 && i === 2 ? 0.17 : 0.075,
        attack: 0.012,
        gain: 0.17 * amp * retreatDecay,
        filterType: 'bandpass',
        filterFreq: stepCutoff,
        filterFreqEnd: Math.max(220, stepCutoff * 0.52),
        filterQ: 1.5,
        delay: stepDelay + 0.006,
        offset: (0.28 + i * 0.27) % 1.2,
      })
    )

    // Quieter, progressively muffled corridor reflections (strictly noise-only, zero pitched echo)
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: 0.13,
        attack: 0.02,
        gain: 0.095 * amp * retreatDecay,
        filterType: 'lowpass',
        filterFreq: Math.max(230, stepCutoff * 0.56),
        filterFreqEnd: 170,
        delay: stepDelay + 0.15,
        offset: (0.55 + i * 0.21) % 1.2,
      })
    )
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: 0.15,
        attack: 0.028,
        gain: 0.052 * amp * retreatDecay,
        filterType: 'lowpass',
        filterFreq: Math.max(185, stepCutoff * 0.4),
        filterFreqEnd: 140,
        delay: stepDelay + 0.3,
        offset: (0.85 + i * 0.19) % 1.2,
      })
    )
  }

  return handle.finish()
}

/**
 * Ambient Category 5: Rare frightening horror anomalies.
 * Variant 0: Gritty distant steel door impact + natural rusted stick-slip hinge screech (startling).
 * Variant 1: Irregular muffled condensation drips + wet corridor reflections (zero pleasant chimes).
 * Variant 2: Distant hollow subterranean tunnel moan (turbulent air + deeply damped resonance).
 */
export function triggerAmbientRareAnomalyCue(
  ctx,
  dest,
  noiseBuffer,
  { variant = 0, pitchScale = 1.0, intensity = 0.94 } = {}
) {
  const safeVariant = Math.abs(Math.trunc(variant)) % 3
  const scale = Math.max(0.75, Math.min(1.35, pitchScale))
  const amp = Math.max(0.25, Math.min(1.25, intensity))
  const cueDur = safeVariant === 0 ? 2.35 : safeVariant === 1 ? 2.15 : 3.2
  const handle = createAmbientCueHandle(ctx, dest, cueDur)
  if (!handle.cueDest) return handle.finish()

  if (safeVariant === 0) {
    // Gritty heavy steel door slam + rusted stick-slip hinge screech (no raw synth alarm tones)
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.14,
          attack: 0.003,
          gain: 0.29 * amp,
          filterType: 'bandpass',
          filterFreq: 1650 * scale,
          filterFreqEnd: 520,
          filterQ: 1.4,
          offset: 0.15,
        })
      )
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.28,
          attack: 0.004,
          gain: 0.31 * amp,
          filterType: 'lowpass',
          filterFreq: 410 * scale,
          filterFreqEnd: 115,
          offset: 0.42,
        })
      )
      // Primary gritty rusted hinge screech via modulated high-Q resonant noise
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 1.38,
          delay: 0.06,
          filterType: 'bandpass',
          filterFreq: 640 * scale,
          filterSteps: [
            { at: 0.2, freq: 890 * scale },
            { at: 0.46, freq: 550 * scale },
            { at: 0.72, freq: 730 * scale },
            { at: 1.0, freq: 470 * scale },
          ],
          filterQ: 6.5,
          gainSteps: [
            { at: 0.06, gain: 0.09 * amp },
            { at: 0.22, gain: 0.23 * amp },
            { at: 0.46, gain: 0.13 * amp },
            { at: 0.7, gain: 0.21 * amp },
            { at: 0.9, gain: 0.07 * amp },
          ],
          offset: 0.65,
        })
      )
      // Secondary metallic scrape grit harmonics
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 1.05,
          delay: 0.09,
          filterType: 'bandpass',
          filterFreq: 1160 * scale,
          filterSteps: [
            { at: 0.25, freq: 1440 * scale },
            { at: 0.55, freq: 960 * scale },
            { at: 0.8, freq: 1220 * scale },
            { at: 1.0, freq: 820 * scale },
          ],
          filterQ: 7.5,
          gainSteps: [
            { at: 0.08, gain: 0.06 * amp },
            { at: 0.26, gain: 0.16 * amp },
            { at: 0.54, gain: 0.09 * amp },
            { at: 0.78, gain: 0.14 * amp },
          ],
          offset: 1.02,
        })
      )
      // Stick-slip hinge chatter micro-impulses
      const hingeTicks = [0.11, 0.27, 0.48, 0.72]
      for (let i = 0; i < hingeTicks.length; i += 1) {
        handle.track(
          playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
            duration: 0.045,
            attack: 0.003,
            gain: (0.15 - i * 0.015) * amp,
            filterType: 'bandpass',
            filterFreq: (1020 + (i % 2) * 340) * scale,
            filterFreqEnd: 620,
            filterQ: 5.0,
            delay: hingeTicks[i],
            offset: (0.2 + i * 0.31) % 1.3,
          })
        )
      }
      // Muffled heavy corridor slam reflection
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.38,
          attack: 0.025,
          gain: 0.12 * amp,
          filterType: 'lowpass',
          filterFreq: 450,
          filterFreqEnd: 185,
          delay: 0.24,
          offset: 0.88,
        })
      )
    }
    // Brief damped structural door-panel thud (non-tonal transient)
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'triangle',
        freqStart: 136 * scale,
        freqEnd: 46 * scale,
        duration: 0.15,
        attack: 0.004,
        gain: 0.23 * amp,
        filterType: 'lowpass',
        filterFreq: 250,
      })
    )
  } else if (safeVariant === 1) {
    // Irregular muffled condensation drips & wet reflections (zero pleasant tonal chimes)
    if (noiseBuffer) {
      const drips = [
        { delay: 0.0, gainScale: 1.0, freq: 680, bodyFreq: 540 },
        { delay: 0.43, gainScale: 0.74, freq: 590, bodyFreq: 470 },
        { delay: 0.78, gainScale: 0.88, freq: 740, bodyFreq: 600 },
        { delay: 1.47, gainScale: 0.58, freq: 520, bodyFreq: 420 },
      ]
      for (let i = 0; i < drips.length; i += 1) {
        const d = drips[i]
        // Muffled water-surface / concrete drip splash
        handle.track(
          playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
            duration: 0.036,
            attack: 0.003,
            gain: 0.22 * amp * d.gainScale,
            filterType: 'bandpass',
            filterFreq: d.freq * scale,
            filterFreqEnd: 340,
            filterQ: 2.8,
            delay: d.delay,
            offset: (0.14 + i * 0.29) % 1.3,
          })
        )
        // Soft damped droplet body
        handle.track(
          playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
            duration: 0.042,
            attack: 0.004,
            gain: 0.14 * amp * d.gainScale,
            filterType: 'bandpass',
            filterFreq: d.bodyFreq * scale,
            filterFreqEnd: 390,
            filterQ: 5.5,
            delay: d.delay + 0.004,
            offset: (0.48 + i * 0.23) % 1.3,
          })
        )
        // Irregular muffled wet corridor reflections
        handle.track(
          playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
            duration: 0.095,
            attack: 0.014,
            gain: 0.095 * amp * d.gainScale,
            filterType: 'lowpass',
            filterFreq: 500 - i * 25,
            filterFreqEnd: 245,
            delay: d.delay + 0.11 + i * 0.025,
            offset: (0.72 + i * 0.19) % 1.3,
          })
        )
        handle.track(
          playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
            duration: 0.13,
            attack: 0.022,
            gain: 0.055 * amp * d.gainScale,
            filterType: 'lowpass',
            filterFreq: 350 - i * 18,
            filterFreqEnd: 185,
            delay: d.delay + 0.24 + i * 0.035,
            offset: (1.02 + i * 0.17) % 1.3,
          })
        )
      }
    }
  } else {
    // Distant hollow subterranean tunnel moan (layered modulated airflow + deeply damped resonance)
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 2.85,
          delay: 0.1,
          filterType: 'bandpass',
          filterFreq: 360 * scale,
          filterSteps: [
            { at: 0.24, freq: 740 * scale },
            { at: 0.5, freq: 420 * scale },
            { at: 0.76, freq: 660 * scale },
            { at: 1.0, freq: 310 * scale },
          ],
          filterQ: 3.4,
          gainSteps: [
            { at: 0.2, gain: 0.25 * amp },
            { at: 0.48, gain: 0.15 * amp },
            { at: 0.74, gain: 0.23 * amp },
            { at: 0.92, gain: 0.08 * amp },
          ],
          offset: 0.4,
        })
      )
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 2.78,
          delay: 0.18,
          filterType: 'bandpass',
          filterFreq: 520 * scale,
          filterSteps: [
            { at: 0.28, freq: 390 * scale },
            { at: 0.56, freq: 820 * scale },
            { at: 0.82, freq: 460 * scale },
            { at: 1.0, freq: 340 * scale },
          ],
          filterQ: 4.8,
          gainSteps: [
            { at: 0.24, gain: 0.18 * amp },
            { at: 0.54, gain: 0.11 * amp },
            { at: 0.78, gain: 0.19 * amp },
            { at: 0.94, gain: 0.06 * amp },
          ],
          offset: 0.95,
        })
      )
    }
    // Restrained deeply lowpassed hollow shaft resonance (replaces bright D4/D#4 organ dyad)
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'triangle',
        freqStart: 148 * scale,
        freqSteps: [
          { at: 0.3, freq: 134 * scale },
          { at: 0.65, freq: 152 * scale },
          { at: 1.0, freq: 128 * scale },
        ],
        duration: 2.7,
        gainSteps: [
          { at: 0.25, gain: 0.12 * amp },
          { at: 0.58, gain: 0.07 * amp },
          { at: 0.8, gain: 0.13 * amp },
        ],
        filterType: 'lowpass',
        filterFreq: 340 * scale,
        delay: 0.14,
      })
    )
  }

  return handle.finish()
}

export const THUNDER_AUDIO_CONSTANTS = Object.freeze({
  distantMinDurationSec: 3.5,
  distantMaxDurationSec: 6.0,
  distantMaxCombinedGain: 0.26,
  distantReducedMotionScale: 0.72,
  crackTransientMinSec: 0.05,
  crackTransientMaxSec: 0.09,
  crackTailMinSec: 2.8,
  crackTailMaxSec: 4.5,
  crackMaxTransientGain: 0.3,
  crackMaxTailAndReflectionGain: 0.22,
})

function clampRange(val, min, max, fallback) {
  const num = Number(val)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, num))
}

function capBurstLayerGains(layers, maxCombinedGain) {
  let maxPeakSum = 0
  for (let i = 0; i < layers.length; i += 1) {
    const steps = layers[i].gainSteps
    let layerMax = layers[i].gain || 0
    if (Array.isArray(steps)) {
      for (let j = 0; j < steps.length; j += 1) {
        const g = Number(steps[j]?.gain) || 0
        if (g > layerMax) layerMax = g
      }
    }
    maxPeakSum += layerMax
  }
  if (maxPeakSum <= maxCombinedGain || maxPeakSum <= 0) {
    return maxPeakSum
  }
  const scale = maxCombinedGain / maxPeakSum
  for (let i = 0; i < layers.length; i += 1) {
    if (typeof layers[i].gain === 'number') {
      layers[i].gain *= scale
    }
    const steps = layers[i].gainSteps
    if (Array.isArray(steps)) {
      for (let j = 0; j < steps.length; j += 1) {
        steps[j].gain = (Number(steps[j].gain) || 0) * scale
      }
    }
  }
  return maxCombinedGain
}

/**
 * Synthesizes distant rolling thunder using layered filtered noise, deep rolling
 * textures, irregular swells, and natural decay (3.5–6.0s). Zero oscillators or
 * repetitive synthetic bass; preserves mid-low warmth for laptop speakers while
 * capping maximum combined source gain <= 0.26 before ambienceGain.
 */
export function triggerDistantThunderCue(
  ctx,
  dest,
  noiseBuffer,
  {
    variant = 0,
    durationSec = null,
    pitchScale = null,
    intensity = 1.0,
    reducedMotion = false,
    random = Math.random,
  } = {}
) {
  const rng = typeof random === 'function' ? random : Math.random
  const safeVariant = Math.abs(Math.trunc(Number(variant) || 0)) % 4
  const dur = clampRange(
    durationSec,
    THUNDER_AUDIO_CONSTANTS.distantMinDurationSec,
    THUNDER_AUDIO_CONSTANTS.distantMaxDurationSec,
    3.6 + rng() * 2.1
  )
  const scale = clampRange(pitchScale, 0.82, 1.22, 0.88 + rng() * 0.26)
  const motionScale = reducedMotion ? THUNDER_AUDIO_CONSTANTS.distantReducedMotionScale : 1.0
  const amp = clampRange(intensity, 0.2, 1.0, 1.0) * motionScale
  const airTrim = reducedMotion ? 0.8 : 1.0
  const freqTrim = reducedMotion ? 0.9 : 1.0

  const handle = createAmbientCueHandle(ctx, dest, dur + 0.14, { fadeTauSec: 0.035 })
  if (!handle.cueDest || !noiseBuffer) return handle.finish()

  const bufDur =
    Number.isFinite(noiseBuffer.duration) && noiseBuffer.duration > 0 ? noiseBuffer.duration : 4.8
  const baseOff = rng() * bufDur
  const jA = 0.92 + rng() * 0.14
  const jB = 0.92 + rng() * 0.14
  const jC = 0.92 + rng() * 0.14

  let layers
  if (safeVariant === 0) {
    // Rolling Horizon Swell: slow subterranean bloom with two irregular crests
    layers = [
      {
        duration: dur * 0.98,
        delay: 0,
        filterType: 'lowpass',
        filterFreq: 185 * scale * freqTrim,
        filterSteps: [
          { at: 0.18, freq: 265 * scale * freqTrim },
          { at: 0.44, freq: 180 * scale * freqTrim },
          { at: 0.68, freq: 235 * scale * freqTrim },
          { at: 1.0, freq: 95 * scale * freqTrim },
        ],
        gainSteps: [
          { at: 0.16, gain: 0.135 * amp * jA },
          { at: 0.36, gain: 0.082 * amp * jA },
          { at: 0.56, gain: 0.142 * amp * jA },
          { at: 0.8, gain: 0.064 * amp * jA },
          { at: 0.95, gain: 0.015 * amp * jA },
        ],
        offset: baseOff % bufDur,
      },
      {
        duration: dur * 0.9,
        delay: 0.12,
        filterType: 'bandpass',
        filterFreq: 330 * scale * freqTrim,
        filterSteps: [
          { at: 0.22, freq: 450 * scale * freqTrim },
          { at: 0.52, freq: 290 * scale * freqTrim },
          { at: 0.76, freq: 375 * scale * freqTrim },
          { at: 1.0, freq: 175 * scale * freqTrim },
        ],
        filterQ: 0.72,
        gainSteps: [
          { at: 0.18, gain: 0.082 * amp * jB },
          { at: 0.42, gain: 0.052 * amp * jB },
          { at: 0.62, gain: 0.086 * amp * jB },
          { at: 0.86, gain: 0.028 * amp * jB },
        ],
        offset: (baseOff + 1.37) % bufDur,
      },
      {
        duration: dur * 0.78,
        delay: 0.24,
        filterType: 'bandpass',
        filterFreq: 560 * scale * freqTrim,
        filterSteps: [
          { at: 0.3, freq: 420 * scale * freqTrim },
          { at: 0.65, freq: 325 * scale * freqTrim },
          { at: 1.0, freq: 215 * scale * freqTrim },
        ],
        filterQ: 0.75,
        gainSteps: [
          { at: 0.22, gain: 0.032 * amp * airTrim * jC },
          { at: 0.54, gain: 0.025 * amp * airTrim * jC },
          { at: 0.85, gain: 0.008 * amp * airTrim * jC },
        ],
        offset: (baseOff + 2.83) % bufDur,
      },
    ]
  } else if (safeVariant === 1) {
    // Multi-Peak Distant Peal: staggered initial rumble + deep secondary corridor echo
    layers = [
      {
        duration: dur * 0.98,
        delay: 0,
        filterType: 'lowpass',
        filterFreq: 215 * scale * freqTrim,
        filterSteps: [
          { at: 0.14, freq: 255 * scale * freqTrim },
          { at: 0.38, freq: 155 * scale * freqTrim },
          { at: 0.6, freq: 225 * scale * freqTrim },
          { at: 1.0, freq: 98 * scale * freqTrim },
        ],
        gainSteps: [
          { at: 0.11, gain: 0.142 * amp * jA },
          { at: 0.33, gain: 0.074 * amp * jA },
          { at: 0.52, gain: 0.122 * amp * jA },
          { at: 0.76, gain: 0.08 * amp * jA },
          { at: 0.94, gain: 0.016 * amp * jA },
        ],
        offset: baseOff % bufDur,
      },
      {
        duration: dur * 0.88,
        delay: 0.09,
        filterType: 'bandpass',
        filterFreq: 375 * scale * freqTrim,
        filterSteps: [
          { at: 0.16, freq: 485 * scale * freqTrim },
          { at: 0.45, freq: 295 * scale * freqTrim },
          { at: 0.68, freq: 410 * scale * freqTrim },
          { at: 1.0, freq: 185 * scale * freqTrim },
        ],
        filterQ: 0.74,
        gainSteps: [
          { at: 0.14, gain: 0.086 * amp * jB },
          { at: 0.39, gain: 0.044 * amp * jB },
          { at: 0.58, gain: 0.074 * amp * jB },
          { at: 0.86, gain: 0.025 * amp * jB },
        ],
        offset: (baseOff + 1.61) % bufDur,
      },
      {
        duration: dur * 0.72,
        delay: 0.52,
        filterType: 'bandpass',
        filterFreq: 510 * scale * freqTrim,
        filterSteps: [
          { at: 0.35, freq: 365 * scale * freqTrim },
          { at: 0.7, freq: 265 * scale * freqTrim },
          { at: 1.0, freq: 195 * scale * freqTrim },
        ],
        filterQ: 0.78,
        gainSteps: [
          { at: 0.2, gain: 0.034 * amp * airTrim * jC },
          { at: 0.55, gain: 0.03 * amp * airTrim * jC },
          { at: 0.88, gain: 0.009 * amp * airTrim * jC },
        ],
        offset: (baseOff + 3.09) % bufDur,
      },
    ]
  } else if (safeVariant === 2) {
    // Heavy Muffled Cloudfront: broad, enveloping warm concrete pressure roll
    layers = [
      {
        duration: dur * 0.98,
        delay: 0,
        filterType: 'lowpass',
        filterFreq: 175 * scale * freqTrim,
        filterSteps: [
          { at: 0.24, freq: 245 * scale * freqTrim },
          { at: 0.54, freq: 190 * scale * freqTrim },
          { at: 0.8, freq: 135 * scale * freqTrim },
          { at: 1.0, freq: 92 * scale * freqTrim },
        ],
        gainSteps: [
          { at: 0.22, gain: 0.145 * amp * jA },
          { at: 0.48, gain: 0.102 * amp * jA },
          { at: 0.68, gain: 0.132 * amp * jA },
          { at: 0.92, gain: 0.026 * amp * jA },
        ],
        offset: baseOff % bufDur,
      },
      {
        duration: dur * 0.9,
        delay: 0.14,
        filterType: 'bandpass',
        filterFreq: 300 * scale * freqTrim,
        filterSteps: [
          { at: 0.26, freq: 405 * scale * freqTrim },
          { at: 0.58, freq: 275 * scale * freqTrim },
          { at: 1.0, freq: 175 * scale * freqTrim },
        ],
        filterQ: 0.7,
        gainSteps: [
          { at: 0.2, gain: 0.082 * amp * jB },
          { at: 0.5, gain: 0.062 * amp * jB },
          { at: 0.72, gain: 0.076 * amp * jB },
          { at: 0.9, gain: 0.02 * amp * jB },
        ],
        offset: (baseOff + 1.89) % bufDur,
      },
      {
        duration: dur * 0.76,
        delay: 0.2,
        filterType: 'bandpass',
        filterFreq: 540 * scale * freqTrim,
        filterSteps: [
          { at: 0.28, freq: 620 * scale * freqTrim },
          { at: 0.64, freq: 390 * scale * freqTrim },
          { at: 1.0, freq: 235 * scale * freqTrim },
        ],
        filterQ: 0.75,
        gainSteps: [
          { at: 0.18, gain: 0.03 * amp * airTrim * jC },
          { at: 0.52, gain: 0.022 * amp * airTrim * jC },
          { at: 0.86, gain: 0.007 * amp * airTrim * jC },
        ],
        offset: (baseOff + 3.41) % bufDur,
      },
    ]
  } else {
    // Long Echoing Valley Roll: faster initiation followed by undulating cavernous decay
    layers = [
      {
        duration: dur * 0.98,
        delay: 0,
        filterType: 'lowpass',
        filterFreq: 225 * scale * freqTrim,
        filterSteps: [
          { at: 0.16, freq: 175 * scale * freqTrim },
          { at: 0.44, freq: 220 * scale * freqTrim },
          { at: 0.72, freq: 138 * scale * freqTrim },
          { at: 1.0, freq: 94 * scale * freqTrim },
        ],
        gainSteps: [
          { at: 0.09, gain: 0.138 * amp * jA },
          { at: 0.3, gain: 0.088 * amp * jA },
          { at: 0.5, gain: 0.124 * amp * jA },
          { at: 0.74, gain: 0.072 * amp * jA },
          { at: 0.93, gain: 0.018 * amp * jA },
        ],
        offset: baseOff % bufDur,
      },
      {
        duration: dur * 0.92,
        delay: 0.08,
        filterType: 'bandpass',
        filterFreq: 365 * scale * freqTrim,
        filterSteps: [
          { at: 0.18, freq: 500 * scale * freqTrim },
          { at: 0.48, freq: 325 * scale * freqTrim },
          { at: 0.74, freq: 395 * scale * freqTrim },
          { at: 1.0, freq: 190 * scale * freqTrim },
        ],
        filterQ: 0.74,
        gainSteps: [
          { at: 0.12, gain: 0.084 * amp * jB },
          { at: 0.38, gain: 0.054 * amp * jB },
          { at: 0.6, gain: 0.078 * amp * jB },
          { at: 0.88, gain: 0.022 * amp * jB },
        ],
        offset: (baseOff + 1.19) % bufDur,
      },
      {
        duration: dur * 0.82,
        delay: 0.18,
        filterType: 'bandpass',
        filterFreq: 610 * scale * freqTrim,
        filterSteps: [
          { at: 0.28, freq: 430 * scale * freqTrim },
          { at: 0.62, freq: 315 * scale * freqTrim },
          { at: 1.0, freq: 210 * scale * freqTrim },
        ],
        filterQ: 0.76,
        gainSteps: [
          { at: 0.16, gain: 0.034 * amp * airTrim * jC },
          { at: 0.48, gain: 0.024 * amp * airTrim * jC },
          { at: 0.84, gain: 0.008 * amp * airTrim * jC },
        ],
        offset: (baseOff + 2.57) % bufDur,
      },
    ]
  }

  const maxAllowed =
    THUNDER_AUDIO_CONSTANTS.distantMaxCombinedGain * (reducedMotion ? motionScale : 1.0)
  const peakGain = capBurstLayerGains(layers, maxAllowed)

  for (let i = 0; i < layers.length; i += 1) {
    handle.track(playNoiseBurst(ctx, handle.cueDest, noiseBuffer, layers[i]))
  }

  const baseHandle = handle.finish()
  return {
    ...baseHandle,
    kind: 'distant',
    variant: safeVariant,
    peakGain,
  }
}

/**
 * Synthesizes a sudden, frightening lightning thunder crack:
 * - Sharp 50–90ms initial transient (combined gain <= 0.30) with structured impact shoulder so earbuds hear the snap clearly
 * - Staggered crackle reflections + deep 2.8–4.5s rolling underground tail (combined gain <= 0.22)
 * Uses pure layered filtered noise (zero oscillators or clipping).
 */
export function triggerLightningCrackCue(
  ctx,
  dest,
  noiseBuffer,
  {
    variant = 0,
    transientDurationSec = null,
    tailDurationSec = null,
    pitchScale = null,
    intensity = 1.0,
    random = Math.random,
  } = {}
) {
  const rng = typeof random === 'function' ? random : Math.random
  const safeVariant = Math.abs(Math.trunc(Number(variant) || 0)) % 3
  const transientDur = clampRange(
    transientDurationSec,
    THUNDER_AUDIO_CONSTANTS.crackTransientMinSec,
    THUNDER_AUDIO_CONSTANTS.crackTransientMaxSec,
    0.064 + rng() * 0.024
  )
  const tailDur = clampRange(
    tailDurationSec,
    THUNDER_AUDIO_CONSTANTS.crackTailMinSec,
    THUNDER_AUDIO_CONSTANTS.crackTailMaxSec,
    3.0 + rng() * 1.4
  )
  const scale = clampRange(pitchScale, 0.82, 1.2, 0.88 + rng() * 0.24)
  const amp = clampRange(intensity, 0.45, 1.0, 1.0)

  const tailDelay = transientDur + 0.012
  const totalDur = tailDelay + tailDur
  const handle = createAmbientCueHandle(ctx, dest, totalDur + 0.12, { fadeTauSec: 0.035 })
  if (!handle.cueDest || !noiseBuffer) return handle.finish()

  const bufDur =
    Number.isFinite(noiseBuffer.duration) && noiseBuffer.duration > 0 ? noiseBuffer.duration : 4.8
  const baseOff = rng() * bufDur

  const snapCenter =
    safeVariant === 0 ? 2150 : safeVariant === 1 ? 2380 : 1920
  const bodyCenter =
    safeVariant === 0 ? 1150 : safeVariant === 1 ? 1280 : 1020

  // 1. Sharp initial crack transient (50–90ms, combined gain strictly <= 0.30)
  // Uses sustained gainSteps shoulder rather than a 2ms needle so Web Audio render quanta preserve full impact
  const transientLayers = [
    {
      duration: transientDur,
      filterType: 'bandpass',
      filterFreq: snapCenter * scale,
      filterFreqEnd: 820 * scale,
      filterQ: 0.58,
      gainSteps: [
        { at: 0.08, gain: 0.178 * amp },
        { at: 0.36, gain: 0.156 * amp },
        { at: 0.68, gain: 0.082 * amp },
      ],
      delay: 0,
      offset: baseOff % bufDur,
    },
    {
      duration: Math.max(THUNDER_AUDIO_CONSTANTS.crackTransientMinSec, transientDur * 0.94),
      filterType: 'lowpass',
      filterFreq: bodyCenter * scale,
      filterFreqEnd: 360 * scale,
      filterQ: 0.68,
      gainSteps: [
        { at: 0.08, gain: 0.118 * amp },
        { at: 0.36, gain: 0.098 * amp },
        { at: 0.68, gain: 0.052 * amp },
      ],
      delay: 0,
      offset: (baseOff + 0.87) % bufDur,
    },
  ]
  const transientPeak = capBurstLayerGains(
    transientLayers,
    THUNDER_AUDIO_CONSTANTS.crackMaxTransientGain
  )

  // 2. Staggered crackle reflections (start strictly after initial transient finishes)
  const reflectionOffsets =
    safeVariant === 0
      ? [0.125, 0.27, 0.46]
      : safeVariant === 1
        ? [0.115, 0.245, 0.41, 0.63]
        : [0.14, 0.31, 0.51, 0.72]

  const reflectionLayers = []
  for (let i = 0; i < reflectionOffsets.length; i += 1) {
    const rDelay = Math.max(transientDur + 0.025, reflectionOffsets[i] + (rng() - 0.5) * 0.025)
    const rDur = 0.085 + i * 0.014 + rng() * 0.02
    const rGain = (i === 0 ? 0.118 : i === 1 ? 0.092 : i === 2 ? 0.064 : 0.042) * amp
    const rFreq = (1480 - i * 245) * scale
    reflectionLayers.push({
      duration: rDur,
      filterType: 'bandpass',
      filterFreq: Math.max(280, rFreq),
      filterFreqEnd: Math.max(180, rFreq * 0.44),
      filterQ: 0.85,
      gainSteps: [
        { at: 0.12, gain: rGain },
        { at: 0.42, gain: rGain * 0.74 },
        { at: 0.74, gain: rGain * 0.28 },
      ],
      delay: rDelay,
      offset: (baseOff + 1.45 + i * 0.67) % bufDur,
    })
  }

  // 3. Deep rolling underground tail (2.8–4.5s, stays gentle during early reflections and peaks <= 0.22)
  const tailLayers = [
    {
      duration: tailDur,
      delay: tailDelay,
      filterType: 'lowpass',
      filterFreq: 245 * scale,
      filterSteps: [
        { at: 0.16, freq: 195 * scale },
        { at: 0.42, freq: 225 * scale },
        { at: 0.72, freq: 140 * scale },
        { at: 1.0, freq: 92 * scale },
      ],
      gainSteps: [
        { at: 0.04, gain: 0.046 * amp },
        { at: 0.16, gain: 0.098 * amp },
        { at: 0.34, gain: 0.115 * amp },
        { at: 0.64, gain: 0.074 * amp },
        { at: 0.9, gain: 0.018 * amp },
      ],
      offset: (baseOff + 2.13) % bufDur,
    },
    {
      duration: tailDur * 0.92,
      delay: tailDelay + 0.015,
      filterType: 'bandpass',
      filterFreq: 430 * scale,
      filterSteps: [
        { at: 0.2, freq: 335 * scale },
        { at: 0.48, freq: 375 * scale },
        { at: 0.78, freq: 235 * scale },
        { at: 1.0, freq: 170 * scale },
      ],
      filterQ: 0.72,
      gainSteps: [
        { at: 0.05, gain: 0.028 * amp },
        { at: 0.18, gain: 0.058 * amp },
        { at: 0.36, gain: 0.072 * amp },
        { at: 0.68, gain: 0.038 * amp },
        { at: 0.91, gain: 0.01 * amp },
      ],
      offset: (baseOff + 3.07) % bufDur,
    },
    {
      duration: tailDur * 0.78,
      delay: tailDelay + 0.02,
      filterType: 'bandpass',
      filterFreq: 730 * scale,
      filterSteps: [
        { at: 0.24, freq: 450 * scale },
        { at: 0.6, freq: 315 * scale },
        { at: 1.0, freq: 215 * scale },
      ],
      filterQ: 0.78,
      gainSteps: [
        { at: 0.05, gain: 0.014 * amp },
        { at: 0.22, gain: 0.028 * amp },
        { at: 0.54, gain: 0.022 * amp },
        { at: 0.86, gain: 0.006 * amp },
      ],
      offset: (baseOff + 3.91) % bufDur,
    },
  ]

  // Verify peak instantaneous sum across all overlapping reflections and tail never exceeds 0.22
  const laterMaxAllowed = THUNDER_AUDIO_CONSTANTS.crackMaxTailAndReflectionGain
  const tailPeak = capBurstLayerGains(tailLayers, laterMaxAllowed)

  const evalBurstLayerGainAt = (layer, t) => {
    const start = Math.max(0, Number(layer.delay) || 0)
    const dur = Math.max(0.03, Number(layer.duration) || 0.16)
    if (t < start || t > start + dur) return 0
    const local = t - start
    if (Array.isArray(layer.gainSteps) && layer.gainSteps.length > 0) {
      let prevT = 0
      let prevG = 0.0001
      for (let i = 0; i < layer.gainSteps.length; i += 1) {
        const step = layer.gainSteps[i]
        const stepT = Math.max(
          prevT + 0.002,
          Math.max(0.002, Math.min(0.96, Number(step?.at) || 0) * dur)
        )
        if (stepT >= dur - 0.002) break
        const stepG = Math.max(0.0001, Number(step?.gain) || 0.0001)
        if (local <= stepT) {
          const frac = (local - prevT) / Math.max(1e-6, stepT - prevT)
          return prevG + (stepG - prevG) * frac
        }
        prevT = stepT
        prevG = stepG
      }
      const frac = Math.max(0, (local - prevT) / Math.max(1e-6, dur - prevT))
      return prevG * Math.pow(0.0001 / Math.max(0.0001, prevG), frac)
    }
    const attack = Math.min(Number(layer.attack) || 0.005, dur * 0.35)
    const peakG = Math.max(0.001, Number(layer.gain) || 0)
    if (local <= attack) {
      return 0.0001 + (peakG - 0.0001) * (local / Math.max(1e-6, attack))
    }
    const frac = Math.max(0, (local - attack) / Math.max(1e-6, dur - attack))
    return peakG * Math.pow(0.0001 / peakG, frac)
  }

  const laterLayers = [...reflectionLayers, ...tailLayers]
  const sampleTimes = []
  for (let i = 0; i < reflectionLayers.length; i += 1) {
    const r = reflectionLayers[i]
    if (Array.isArray(r.gainSteps) && r.gainSteps.length > 0) {
      for (let j = 0; j < r.gainSteps.length; j += 1) {
        sampleTimes.push(r.delay + r.gainSteps[j].at * r.duration)
      }
    } else {
      const rAttack = Math.min(Number(r.attack) || 0.003, r.duration * 0.35)
      sampleTimes.push(r.delay + rAttack)
    }
  }
  for (let i = 0; i < tailLayers.length; i += 1) {
    const tl = tailLayers[i]
    for (let j = 0; j < tl.gainSteps.length; j += 1) {
      sampleTimes.push(tl.delay + tl.gainSteps[j].at * tl.duration)
    }
  }

  let worstLaterSum = 0
  for (let i = 0; i < sampleTimes.length; i += 1) {
    const t = sampleTimes[i]
    let sum = 0
    for (let k = 0; k < laterLayers.length; k += 1) {
      sum += evalBurstLayerGainAt(laterLayers[k], t)
    }
    if (sum > worstLaterSum) worstLaterSum = sum
  }
  let effectiveTailPeak = tailPeak
  if (worstLaterSum > laterMaxAllowed && worstLaterSum > 0) {
    const scaleDown = laterMaxAllowed / worstLaterSum
    for (let i = 0; i < reflectionLayers.length; i += 1) {
      const r = reflectionLayers[i]
      if (typeof r.gain === 'number') {
        r.gain *= scaleDown
      }
      if (Array.isArray(r.gainSteps)) {
        for (let j = 0; j < r.gainSteps.length; j += 1) {
          r.gainSteps[j].gain *= scaleDown
        }
      }
    }
    for (let i = 0; i < tailLayers.length; i += 1) {
      for (let j = 0; j < tailLayers[i].gainSteps.length; j += 1) {
        tailLayers[i].gainSteps[j].gain *= scaleDown
      }
    }
    effectiveTailPeak *= scaleDown
  }

  for (let i = 0; i < transientLayers.length; i += 1) {
    handle.track(playNoiseBurst(ctx, handle.cueDest, noiseBuffer, transientLayers[i]))
  }
  for (let i = 0; i < reflectionLayers.length; i += 1) {
    handle.track(playNoiseBurst(ctx, handle.cueDest, noiseBuffer, reflectionLayers[i]))
  }
  for (let i = 0; i < tailLayers.length; i += 1) {
    handle.track(playNoiseBurst(ctx, handle.cueDest, noiseBuffer, tailLayers[i]))
  }

  const baseHandle = handle.finish()
  return {
    ...baseHandle,
    kind: 'crack',
    variant: safeVariant,
    transientDurationSec: transientDur,
    tailDurationSec: tailDur,
    peakTransientGain: transientPeak,
    peakTailGain: effectiveTailPeak,
  }
}

function createWarmSaturationCurve(drive = 1.65, samples = 1024) {
  const curve = new Float32Array(samples)
  const norm = Math.tanh(drive) || 1
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1
    curve[i] = Math.tanh(drive * x) / norm
  }
  return curve
}

function createUndergroundShaftImpulseResponse(ctx, durationSec = 1.85) {
  if (!ctx || typeof ctx.createBuffer !== 'function') return null
  const sampleRate = ctx.sampleRate || 44100
  const length = Math.max(256, Math.floor(sampleRate * durationSec))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  // Deterministic PRNG so shaft reverb texture stays consistent across runs
  let seed = 0x51a7f00d
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return (seed / 0xffffffff) * 2 - 1
  }

  // Dense early metallic wall taps followed by air-damped concrete diffusion
  const earlyTapTimes = [0.014, 0.029, 0.047, 0.068, 0.094, 0.128, 0.168]
  let lpState = 0
  let peak = 0

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate
    const tNorm = i / length
    const envelope = Math.exp(-4.1 * tNorm) * (1 - tNorm * 0.25)
    const damp = Math.min(0.88, 0.34 + tNorm * 0.54)
    const raw = nextRand() * envelope
    lpState = lpState * damp + raw * (1 - damp)
    let sample = lpState * 0.72
    if (t < 0.08) {
      sample += raw * 0.35 * (1 - t / 0.08)
    }
    data[i] = sample
    const abs = Math.abs(sample)
    if (abs > peak) peak = abs
  }

  for (let j = 0; j < earlyTapTimes.length; j += 1) {
    const idx = Math.floor(earlyTapTimes[j] * sampleRate)
    if (idx > 0 && idx < length - 8) {
      const amp = 0.78 * Math.pow(0.8, j)
      data[idx] += amp
      data[idx + 1] += amp * 0.55
      data[idx + 2] -= amp * 0.35
      if (Math.abs(data[idx]) > peak) peak = Math.abs(data[idx])
    }
  }

  const invPeak = peak > 0.001 ? 0.9 / peak : 1
  for (let i = 0; i < length; i += 1) {
    data[i] *= invPeak
  }
  return buffer
}

function createElevatorCueHandle(ctx, dest, options = {}) {
  return createCueBusHandle(ctx, dest, options)
}

export function triggerStartElevatorDescentCue(
  ctx,
  dest,
  noiseBuffer,
  duration = 1.45,
  options = {}
) {
  if (!ctx || !dest) return null
  const safeDur = Math.max(0.3, Number.isFinite(duration) ? duration : 1.45)
  const handle = createElevatorCueHandle(ctx, dest, {
    durationSec: safeDur,
    onComplete: options?.onComplete,
  })
  handle.track(
    playToneBurst(ctx, handle.target, {
      type: 'triangle',
      freqStart: 78,
      freqEnd: 52,
      duration: safeDur,
      attack: 0.08,
      gain: 0.11,
      gainSteps: [
        { at: 0.08, gain: 0.1 },
        { at: 0.82, gain: 0.11 },
        { at: 0.96, gain: 0.04 },
      ],
      filterType: 'lowpass',
      filterFreq: 280,
      filterFreqEnd: 200,
    })
  )
  handle.track(
    playNoiseBurst(ctx, handle.target, noiseBuffer, {
      duration: safeDur,
      attack: 0.09,
      gain: 0.075,
      gainSteps: [
        { at: 0.1, gain: 0.072 },
        { at: 0.85, gain: 0.068 },
        { at: 0.96, gain: 0.025 },
      ],
      filterType: 'bandpass',
      filterFreq: 350,
      filterFreqEnd: 220,
      filterQ: 1.5,
    })
  )
  handle.track(
    playNoiseBurst(ctx, handle.target, noiseBuffer, {
      duration: safeDur * 0.92,
      attack: 0.12,
      gain: 0.055,
      filterType: 'lowpass',
      filterFreq: 420,
      filterFreqEnd: 260,
    })
  )
  return handle
}

export function triggerStartElevatorImpactCue(ctx, dest, noiseBuffer, options = {}) {
  if (!ctx || !dest) return null
  const now = ctx.currentTime || 0
  const totalDurSec = 2.52
  const zeroableGains = []
  let shaftConvolver = null

  // Full-authority cue bus: preserve sub-30Hz body weight (24Hz HP) and crisp cast-iron bite (8.4kHz LP)
  const handle = createElevatorCueHandle(ctx, dest, {
    cueGainValue: 1.0,
    highpassHz: 24,
    lowpassHz: 8400,
    durationSec: totalDurSec,
    onComplete: options?.onComplete,
    onStop: () => {
      const t = ctx.currentTime || now
      for (let i = 0; i < zeroableGains.length; i += 1) {
        const g = zeroableGains[i]
        try {
          g?.gain?.cancelScheduledValues?.(t)
          g?.gain?.setValueAtTime?.(0.0001, t)
        } catch {
          // Ignore mock AudioParam errors
        }
      }
      if (shaftConvolver) {
        try {
          shaftConvolver.buffer = null
        } catch {
          // Ignore buffer clear errors
        }
        shaftConvolver = null
      }
    },
  })

  // Direct vs. underground concrete shaft send/return routing inside cueGain
  let impactDest = handle.target
  let shaftEchoReturnDest = handle.target

  if (typeof ctx.createGain === 'function') {
    const directBus = handle.trackBusNode(ctx.createGain())
    if (directBus.gain) {
      directBus.gain.setValueAtTime?.(1.0, now)
    }
    impactDest = directBus

    // Subtle analog-style tanh soft-clipper thickens cast-iron transient weight without harsh digital clipping
    if (typeof ctx.createWaveShaper === 'function') {
      const shaper = handle.trackBusNode(ctx.createWaveShaper())
      shaper.curve = createWarmSaturationCurve(1.65)
      shaper.oversample = '2x'
      const directTrim = handle.trackBusNode(ctx.createGain())
      if (directTrim.gain) {
        directTrim.gain.setValueAtTime?.(0.94, now)
      }
      directBus.connect(shaper)
      shaper.connect(directTrim)
      directTrim.connect(handle.target)
    } else {
      directBus.connect(handle.target)
    }

    // Underground concrete shaft echo/reverb network
    const echoReturnBus = handle.trackBusNode(ctx.createGain())
    if (echoReturnBus.gain) {
      echoReturnBus.gain.setValueAtTime?.(0.92, now)
      echoReturnBus.gain.setValueAtTime?.(0.92, now + 2.1)
      echoReturnBus.gain.exponentialRampToValueAtTime?.(0.0001, now + 2.5)
    }
    echoReturnBus.connect(handle.target)
    zeroableGains.push(echoReturnBus)
    shaftEchoReturnDest = echoReturnBus

    const shaftSendBus = handle.trackBusNode(ctx.createGain())
    if (shaftSendBus.gain) {
      shaftSendBus.gain.setValueAtTime?.(0.88, now)
    }

    // Pre-shape shaft send: trim extreme <80Hz rumble & >2.6kHz fizz so concrete reflections sound deep and realistic
    let shaftInputTail = shaftSendBus
    if (typeof ctx.createBiquadFilter === 'function') {
      const shaftSendHp = handle.trackBusNode(ctx.createBiquadFilter())
      shaftSendHp.type = 'highpass'
      shaftSendHp.frequency?.setValueAtTime?.(82, now)
      if (shaftSendHp.Q) shaftSendHp.Q.value = 0.65
      shaftInputTail.connect(shaftSendHp)
      shaftInputTail = shaftSendHp

      const shaftSendLp = handle.trackBusNode(ctx.createBiquadFilter())
      shaftSendLp.type = 'lowpass'
      shaftSendLp.frequency?.setValueAtTime?.(2650, now)
      if (shaftSendLp.Q) shaftSendLp.Q.value = 0.7
      shaftInputTail.connect(shaftSendLp)
      shaftInputTail = shaftSendLp
    }
    directBus.connect(shaftSendBus)

    if (typeof ctx.createDelay === 'function') {
      // 1) Early metallic shaft reflections (asymmetric steel beams & pit wall bounces)
      const earlySpecs = [
        { delaySec: 0.048, filterType: 'bandpass', freq: 1240, q: 0.9, gain: 0.45 },
        { delaySec: 0.114, filterType: 'bandpass', freq: 840, q: 0.85, gain: 0.34 },
        { delaySec: 0.196, filterType: 'lowpass', freq: 1420, q: 0.7, gain: 0.25 },
      ]
      for (let i = 0; i < earlySpecs.length; i += 1) {
        const spec = earlySpecs[i]
        const tapDelay = handle.trackBusNode(ctx.createDelay(0.5))
        if (tapDelay.delayTime) {
          tapDelay.delayTime.setValueAtTime?.(spec.delaySec, now)
        }
        const tapGain = handle.trackBusNode(ctx.createGain())
        if (tapGain.gain) {
          tapGain.gain.setValueAtTime?.(spec.gain, now)
        }
        shaftInputTail.connect(tapDelay)
        if (typeof ctx.createBiquadFilter === 'function') {
          const tapFilter = handle.trackBusNode(ctx.createBiquadFilter())
          tapFilter.type = spec.filterType
          tapFilter.frequency?.setValueAtTime?.(spec.freq, now)
          if (tapFilter.Q) tapFilter.Q.value = spec.q
          tapDelay.connect(tapFilter)
          tapFilter.connect(tapGain)
        } else {
          tapDelay.connect(tapGain)
        }
        tapGain.connect(echoReturnBus)
      }

      // 2) Cross-coupled damped shaft echo loop (distinct echoes at ~0.285s, 0.445s, 0.73s, 1.015s, 1.46s... decaying smoothly)
      const echoDelayA = handle.trackBusNode(ctx.createDelay(1.0))
      const echoDelayB = handle.trackBusNode(ctx.createDelay(1.0))
      if (echoDelayA.delayTime) echoDelayA.delayTime.setValueAtTime?.(0.285, now)
      if (echoDelayB.delayTime) echoDelayB.delayTime.setValueAtTime?.(0.445, now)

      const echoFeedA = handle.trackBusNode(ctx.createGain())
      const echoFeedB = handle.trackBusNode(ctx.createGain())
      if (echoFeedA.gain) echoFeedA.gain.setValueAtTime?.(0.74, now)
      if (echoFeedB.gain) echoFeedB.gain.setValueAtTime?.(0.58, now)
      shaftInputTail.connect(echoFeedA)
      shaftInputTail.connect(echoFeedB)
      echoFeedA.connect(echoDelayA)
      echoFeedB.connect(echoDelayB)

      let loopOutA = echoDelayA
      let loopOutB = echoDelayB
      if (typeof ctx.createBiquadFilter === 'function') {
        const echoDampA = handle.trackBusNode(ctx.createBiquadFilter())
        echoDampA.type = 'lowpass'
        echoDampA.frequency?.setValueAtTime?.(1520, now)
        if (echoDampA.Q) echoDampA.Q.value = 0.7
        echoDelayA.connect(echoDampA)
        loopOutA = echoDampA

        const echoDampB = handle.trackBusNode(ctx.createBiquadFilter())
        echoDampB.type = 'lowpass'
        echoDampB.frequency?.setValueAtTime?.(1040, now)
        if (echoDampB.Q) echoDampB.Q.value = 0.7
        echoDelayB.connect(echoDampB)
        loopOutB = echoDampB
      }

      const echoReturnA = handle.trackBusNode(ctx.createGain())
      const echoReturnB = handle.trackBusNode(ctx.createGain())
      if (echoReturnA.gain) {
        echoReturnA.gain.setValueAtTime?.(0.42, now)
        echoReturnA.gain.setValueAtTime?.(0.42, now + 1.25)
        echoReturnA.gain.exponentialRampToValueAtTime?.(0.0001, now + 2.48)
      }
      if (echoReturnB.gain) {
        echoReturnB.gain.setValueAtTime?.(0.35, now)
        echoReturnB.gain.setValueAtTime?.(0.35, now + 1.25)
        echoReturnB.gain.exponentialRampToValueAtTime?.(0.0001, now + 2.48)
      }
      loopOutA.connect(echoReturnA)
      loopOutB.connect(echoReturnB)
      echoReturnA.connect(echoReturnBus)
      echoReturnB.connect(echoReturnBus)

      // Bounded cross-feedback (< 0.21 round-trip) with forced fade-out so zero feedback runaway can occur
      const fbGainAB = handle.trackBusNode(ctx.createGain())
      const fbGainBA = handle.trackBusNode(ctx.createGain())
      if (fbGainAB.gain) {
        fbGainAB.gain.setValueAtTime?.(0.47, now)
        fbGainAB.gain.setValueAtTime?.(0.47, now + 1.15)
        fbGainAB.gain.exponentialRampToValueAtTime?.(0.0001, now + 2.38)
      }
      if (fbGainBA.gain) {
        fbGainBA.gain.setValueAtTime?.(0.43, now)
        fbGainBA.gain.setValueAtTime?.(0.43, now + 1.15)
        fbGainBA.gain.exponentialRampToValueAtTime?.(0.0001, now + 2.38)
      }
      loopOutA.connect(fbGainAB)
      fbGainAB.connect(echoDelayB)
      loopOutB.connect(fbGainBA)
      fbGainBA.connect(echoDelayA)
      zeroableGains.push(echoReturnA, echoReturnB, fbGainAB, fbGainBA)
    }

    // 3) Procedural concrete-shaft ConvolverNode reverberation (capability-guarded for headless mocks)
    if (typeof ctx.createConvolver === 'function') {
      const irBuffer = createUndergroundShaftImpulseResponse(ctx, 1.85)
      if (irBuffer) {
        shaftConvolver = handle.trackBusNode(ctx.createConvolver())
        shaftConvolver.buffer = irBuffer
        const convGain = handle.trackBusNode(ctx.createGain())
        if (convGain.gain) {
          convGain.gain.setValueAtTime?.(0.44, now)
          convGain.gain.setValueAtTime?.(0.44, now + 1.35)
          convGain.gain.exponentialRampToValueAtTime?.(0.0001, now + 2.48)
        }
        shaftInputTail.connect(shaftConvolver)
        shaftConvolver.connect(convGain)
        convGain.connect(echoReturnBus)
        zeroableGains.push(convGain)
      }
    }
  }

  // Layer 1: Dominant Deep Sub-Bass & Pit Body Slam (multi-stage gainSteps hold full chest weight instead of collapsing)
  handle.track(
    playToneBurst(ctx, impactDest, {
      type: 'sine',
      freqStart: 108,
      freqSteps: [
        { at: 0.14, freq: 58 },
        { at: 0.46, freq: 39 },
        { at: 1.0, freq: 29 },
      ],
      duration: 0.56,
      gainSteps: [
        { at: 0.006, gain: 0.78 },
        { at: 0.16, gain: 0.64 },
        { at: 0.42, gain: 0.35 },
        { at: 0.72, gain: 0.12 },
        { at: 0.94, gain: 0.018 },
      ],
      filterType: 'lowpass',
      filterFreq: 310,
      filterFreqEnd: 105,
      filterQ: 0.85,
    })
  )
  // Low-mid harmonic punch ensures unmistakable weight on smaller/laptop speakers as well as subwoofers
  handle.track(
    playToneBurst(ctx, impactDest, {
      type: 'triangle',
      freqStart: 164,
      freqSteps: [
        { at: 0.18, freq: 76 },
        { at: 0.72, freq: 44 },
      ],
      duration: 0.38,
      gainSteps: [
        { at: 0.008, gain: 0.54 },
        { at: 0.18, gain: 0.38 },
        { at: 0.48, gain: 0.16 },
        { at: 0.88, gain: 0.025 },
      ],
      filterType: 'lowpass',
      filterFreq: 680,
      filterFreqEnd: 165,
      filterQ: 0.8,
    })
  )

  // Layer 2: Short Aggressive Low-Frequency Pit Air-Pressure Burst
  handle.track(
    playNoiseBurst(ctx, impactDest, noiseBuffer, {
      duration: 0.3,
      gainSteps: [
        { at: 0.006, gain: 0.6 },
        { at: 0.14, gain: 0.42 },
        { at: 0.42, gain: 0.15 },
        { at: 0.86, gain: 0.022 },
      ],
      filterType: 'lowpass',
      filterFreq: 1120,
      filterFreqEnd: 175,
      filterQ: 1.05,
      offset: 0.02,
    })
  )

  // Layer 3: Dense Heavy Metal-on-Metal Collision — hardened bolster & cast-iron stops
  handle.track(
    playToneBurst(ctx, impactDest, {
      type: 'sawtooth',
      freqStart: 248,
      freqSteps: [
        { at: 0.22, freq: 146 },
        { at: 1.0, freq: 102 },
      ],
      duration: 0.28,
      gainSteps: [
        { at: 0.006, gain: 0.36 },
        { at: 0.18, gain: 0.25 },
        { at: 0.52, gain: 0.095 },
        { at: 0.9, gain: 0.015 },
      ],
      filterType: 'bandpass',
      filterFreq: 980,
      filterFreqEnd: 340,
      filterQ: 1.1,
    })
  )
  handle.track(
    playToneBurst(ctx, impactDest, {
      type: 'square',
      freqStart: 396,
      freqSteps: [
        { at: 0.22, freq: 236 },
        { at: 1.0, freq: 166 },
      ],
      duration: 0.2,
      gainSteps: [
        { at: 0.006, gain: 0.24 },
        { at: 0.22, gain: 0.14 },
        { at: 0.64, gain: 0.036 },
        { at: 0.92, gain: 0.006 },
      ],
      filterType: 'bandpass',
      filterFreq: 1480,
      filterFreqEnd: 510,
      filterQ: 1.2,
    })
  )
  handle.track(
    playNoiseBurst(ctx, impactDest, noiseBuffer, {
      duration: 0.21,
      gainSteps: [
        { at: 0.005, gain: 0.52 },
        { at: 0.15, gain: 0.31 },
        { at: 0.46, gain: 0.11 },
        { at: 0.88, gain: 0.016 },
      ],
      filterType: 'bandpass',
      filterFreq: 2050,
      filterFreqEnd: 490,
      filterQ: 0.85,
      offset: 0.34,
    })
  )

  // Layer 4: Strong Industrial Chassis & Guide-Rail Resonance
  handle.track(
    playToneBurst(ctx, impactDest, {
      type: 'sawtooth',
      freqStart: 184,
      freqEnd: 114,
      duration: 0.86,
      delay: 0.008,
      gainSteps: [
        { at: 0.025, gain: 0.25 },
        { at: 0.22, gain: 0.18 },
        { at: 0.52, gain: 0.088 },
        { at: 0.8, gain: 0.028 },
        { at: 0.95, gain: 0.006 },
      ],
      filterType: 'bandpass',
      filterFreq: 430,
      filterFreqEnd: 210,
      filterQ: 1.9,
    })
  )
  handle.track(
    playToneBurst(ctx, impactDest, {
      type: 'triangle',
      freqStart: 74,
      freqEnd: 46,
      duration: 0.9,
      delay: 0.012,
      gainSteps: [
        { at: 0.035, gain: 0.34 },
        { at: 0.24, gain: 0.24 },
        { at: 0.54, gain: 0.115 },
        { at: 0.82, gain: 0.035 },
        { at: 0.96, gain: 0.007 },
      ],
      filterType: 'lowpass',
      filterFreq: 230,
      filterFreqEnd: 115,
    })
  )
  handle.track(
    playToneBurst(ctx, impactDest, {
      type: 'sine',
      freqStart: 334,
      freqEnd: 266,
      duration: 0.68,
      delay: 0.01,
      gainSteps: [
        { at: 0.03, gain: 0.16 },
        { at: 0.26, gain: 0.095 },
        { at: 0.62, gain: 0.036 },
        { at: 0.94, gain: 0.007 },
      ],
      filterType: 'bandpass',
      filterFreq: 650,
      filterFreqEnd: 360,
      filterQ: 2.1,
    })
  )

  // Layer 5: Brief Secondary Mechanical Clank, Subordinate Rattle & Settling
  handle.track(
    playToneBurst(ctx, impactDest, {
      type: 'sawtooth',
      freqStart: 268,
      freqEnd: 136,
      duration: 0.16,
      delay: 0.095,
      gainSteps: [
        { at: 0.02, gain: 0.22 },
        { at: 0.26, gain: 0.12 },
        { at: 0.72, gain: 0.028 },
      ],
      filterType: 'bandpass',
      filterFreq: 920,
      filterFreqEnd: 420,
      filterQ: 1.25,
    })
  )
  handle.track(
    playNoiseBurst(ctx, impactDest, noiseBuffer, {
      duration: 0.14,
      delay: 0.095,
      gainSteps: [
        { at: 0.015, gain: 0.28 },
        { at: 0.28, gain: 0.13 },
        { at: 0.75, gain: 0.025 },
      ],
      filterType: 'bandpass',
      filterFreq: 1650,
      filterFreqEnd: 580,
      filterQ: 1.1,
      offset: 0.18,
    })
  )
  handle.track(
    playNoiseBurst(ctx, impactDest, noiseBuffer, {
      duration: 0.11,
      delay: 0.22,
      gainSteps: [
        { at: 0.03, gain: 0.14 },
        { at: 0.35, gain: 0.065 },
        { at: 0.85, gain: 0.012 },
      ],
      filterType: 'bandpass',
      filterFreq: 1180,
      filterFreqEnd: 490,
      filterQ: 1.9,
      offset: 0.62,
    })
  )
  handle.track(
    playToneBurst(ctx, impactDest, {
      type: 'sine',
      freqStart: 88,
      freqEnd: 54,
      duration: 0.2,
      delay: 0.56,
      gainSteps: [
        { at: 0.04, gain: 0.12 },
        { at: 0.42, gain: 0.05 },
        { at: 0.9, gain: 0.008 },
      ],
      filterType: 'lowpass',
      filterFreq: 220,
      filterFreqEnd: 110,
    })
  )
  handle.track(
    playToneBurst(ctx, impactDest, {
      type: 'triangle',
      freqStart: 238,
      freqEnd: 168,
      duration: 0.13,
      delay: 0.72,
      gainSteps: [
        { at: 0.04, gain: 0.085 },
        { at: 0.45, gain: 0.032 },
        { at: 0.92, gain: 0.005 },
      ],
      filterType: 'bandpass',
      filterFreq: 610,
      filterFreqEnd: 350,
      filterQ: 2.2,
    })
  )

  // Layer 6: Diffuse Underground Concrete Shaft Reverberation Wash (~2.5s natural fade into silence)
  handle.track(
    playNoiseBurst(ctx, shaftEchoReturnDest, noiseBuffer, {
      duration: 2.45,
      delay: 0.05,
      gainSteps: [
        { at: 0.04, gain: 0.24 },
        { at: 0.22, gain: 0.145 },
        { at: 0.48, gain: 0.068 },
        { at: 0.76, gain: 0.024 },
        { at: 0.94, gain: 0.004 },
      ],
      filterType: 'lowpass',
      filterFreq: 1550,
      filterSteps: [
        { at: 0.25, freq: 920 },
        { at: 0.65, freq: 420 },
        { at: 1.0, freq: 190 },
      ],
      filterQ: 0.75,
      offset: 0.85,
    })
  )
  handle.track(
    playToneBurst(ctx, shaftEchoReturnDest, {
      type: 'sine',
      freqStart: 56,
      freqEnd: 36,
      duration: 1.85,
      delay: 0.05,
      gainSteps: [
        { at: 0.06, gain: 0.14 },
        { at: 0.35, gain: 0.065 },
        { at: 0.72, gain: 0.018 },
        { at: 0.95, gain: 0.003 },
      ],
      filterType: 'lowpass',
      filterFreq: 165,
      filterFreqEnd: 82,
    })
  )

  return handle
}

export function triggerExtractionDoorCloseCue(ctx, dest, noiseBuffer) {
  if (!ctx || !dest) return null
  const handle = createElevatorCueHandle(ctx, dest)
  // Heavy pneumatic door seal slide + steel latch thud + magnetic crossbar lock click
  handle.track(
    playNoiseBurst(ctx, handle.target, noiseBuffer, {
      duration: 0.48,
      attack: 0.03,
      gain: 0.14,
      filterType: 'bandpass',
      filterFreq: 420,
      filterFreqEnd: 180,
      filterQ: 1.4,
    })
  )
  handle.track(
    playToneBurst(ctx, handle.target, {
      type: 'triangle',
      freqStart: 128,
      freqEnd: 46,
      duration: 0.28,
      attack: 0.012,
      gain: 0.22,
      delay: 0.42,
      filterType: 'lowpass',
      filterFreq: 380,
    })
  )
  handle.track(
    playToneBurst(ctx, handle.target, {
      type: 'square',
      freqStart: 540,
      freqEnd: 290,
      duration: 0.09,
      attack: 0.004,
      gain: 0.08,
      delay: 0.56,
      filterType: 'lowpass',
      filterFreq: 1400,
    })
  )
  return handle
}

export function triggerExtractionLockPauseCue(ctx, dest, noiseBuffer) {
  if (!ctx || !dest) return null
  const handle = createElevatorCueHandle(ctx, dest)
  handle.track(
    playToneBurst(ctx, handle.target, {
      type: 'square',
      freqStart: 360,
      freqEnd: 145,
      duration: 0.11,
      attack: 0.003,
      gain: 0.1,
      filterType: 'lowpass',
      filterFreq: 1050,
    })
  )
  handle.track(
    playToneBurst(ctx, handle.target, {
      type: 'sine',
      freqStart: 96,
      freqEnd: 164,
      duration: 0.36,
      attack: 0.04,
      gain: 0.085,
      delay: 0.07,
    })
  )
  handle.track(
    playNoiseBurst(ctx, handle.target, noiseBuffer, {
      duration: 0.22,
      attack: 0.02,
      gain: 0.045,
      delay: 0.05,
      filterType: 'bandpass',
      filterFreq: 280,
      filterFreqEnd: 410,
      filterQ: 1.6,
    })
  )
  return handle
}

export function triggerExtractionDepartCue(ctx, dest, noiseBuffer, duration = 2.25) {
  if (!ctx || !dest) return null
  const safeDur = Math.max(0.8, Number.isFinite(duration) ? duration : 2.25)
  const handle = createElevatorCueHandle(ctx, dest)
  // Industrial traction winch motor rising steadily into upper shaft darkness
  handle.track(
    playToneBurst(ctx, handle.target, {
      type: 'sawtooth',
      freqStart: 56,
      freqEnd: 118,
      duration: safeDur * 0.94,
      attack: 0.1,
      gain: 0.125,
      gainSteps: [
        { at: 0.08, gain: 0.11 },
        { at: 0.45, gain: 0.125 },
        { at: 0.78, gain: 0.075 },
        { at: 0.95, gain: 0.02 },
      ],
      filterType: 'lowpass',
      filterFreq: 320,
      filterFreqEnd: 460,
    })
  )
  handle.track(
    playNoiseBurst(ctx, handle.target, noiseBuffer, {
      duration: safeDur * 0.9,
      attack: 0.08,
      gain: 0.08,
      gainSteps: [
        { at: 0.1, gain: 0.075 },
        { at: 0.52, gain: 0.08 },
        { at: 0.85, gain: 0.03 },
      ],
      delay: 0.06,
      filterType: 'bandpass',
      filterFreq: 250,
      filterFreqEnd: 520,
      filterQ: 1.7,
    })
  )
  handle.track(
    playToneBurst(ctx, handle.target, {
      type: 'sine',
      freqStart: 587.33,
      freqEnd: 783.99,
      duration: 0.34,
      attack: 0.01,
      gain: 0.13,
      delay: 0.24,
    })
  )
  return handle
}
