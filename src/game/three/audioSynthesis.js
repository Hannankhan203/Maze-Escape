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

export function triggerEnemyFootstep(
  ctx,
  dest,
  noiseBuffer,
  isChasing = false,
  enemyType = 'stalker'
) {
  if (enemyType === 'brute') {
    // Lumbering heavy sub-bass stomp + concrete grit
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: isChasing ? 66 : 54,
      freqEnd: 24,
      duration: isChasing ? 0.22 : 0.28,
      attack: 0.008,
      gain: isChasing ? 0.56 : 0.42,
    })
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: isChasing ? 0.16 : 0.2,
      gain: isChasing ? 0.34 : 0.22,
      filterType: 'lowpass',
      filterFreq: isChasing ? 320 : 240,
      offset: Math.random() * 1.2,
    })
    return
  }

  if (enemyType === 'hunter') {
    // Quick sharp chitin/clawed metallic taps
    playToneBurst(ctx, dest, {
      type: 'triangle',
      freqStart: isChasing ? 185 : 145,
      freqEnd: 68,
      duration: isChasing ? 0.09 : 0.12,
      attack: 0.003,
      gain: isChasing ? 0.3 : 0.2,
    })
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.08,
      gain: isChasing ? 0.24 : 0.14,
      filterType: 'highpass',
      filterFreq: isChasing ? 1150 : 860,
      offset: Math.random() * 1.2,
    })
    return
  }

  // Heavy metallic/concrete stalker step
  playToneBurst(ctx, dest, {
    type: 'triangle',
    freqStart: isChasing ? 96 : 74,
    freqEnd: 34,
    duration: isChasing ? 0.14 : 0.19,
    attack: 0.006,
    gain: isChasing ? 0.42 : 0.28,
  })
  playNoiseBurst(ctx, dest, noiseBuffer, {
    duration: isChasing ? 0.11 : 0.15,
    gain: isChasing ? 0.28 : 0.16,
    filterType: 'bandpass',
    filterFreq: isChasing ? 520 : 340,
    filterQ: 1.5,
    offset: Math.random() * 1.2,
  })
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

export function triggerEnemyAlertCue(ctx, dest, isChase = true, enemyType = 'stalker') {
  if (enemyType === 'brute') {
    if (isChase) {
      // Deep foghorn/industrial bellow
      playToneBurst(ctx, dest, {
        type: 'sawtooth',
        freqStart: 92,
        freqEnd: 58,
        duration: 0.62,
        attack: 0.04,
        gain: 0.42,
        filterType: 'lowpass',
        filterFreq: 480,
      })
      playToneBurst(ctx, dest, {
        type: 'sine',
        freqStart: 62,
        freqEnd: 36,
        duration: 0.65,
        attack: 0.02,
        gain: 0.44,
      })
    } else {
      playToneBurst(ctx, dest, {
        type: 'triangle',
        freqStart: 88,
        freqEnd: 56,
        duration: 0.36,
        attack: 0.03,
        gain: 0.26,
        filterType: 'lowpass',
        filterFreq: 360,
      })
    }
    return
  }

  if (enemyType === 'hunter') {
    if (isChase) {
      // Dual sharp predatory sonar shriek
      playToneBurst(ctx, dest, {
        type: 'square',
        freqStart: 420,
        freqEnd: 920,
        duration: 0.16,
        attack: 0.01,
        gain: 0.22,
        filterType: 'bandpass',
        filterFreq: 1850,
        filterQ: 3.0,
      })
      playToneBurst(ctx, dest, {
        type: 'sawtooth',
        freqStart: 540,
        freqEnd: 310,
        duration: 0.24,
        attack: 0.01,
        gain: 0.24,
        filterType: 'bandpass',
        filterFreq: 1600,
        delay: 0.1,
      })
    } else {
      // Curious double acoustic chirp
      playToneBurst(ctx, dest, {
        type: 'sine',
        freqStart: 640,
        freqEnd: 880,
        duration: 0.11,
        attack: 0.01,
        gain: 0.18,
      })
      playToneBurst(ctx, dest, {
        type: 'sine',
        freqStart: 720,
        freqEnd: 560,
        duration: 0.12,
        attack: 0.01,
        gain: 0.15,
        delay: 0.11,
      })
    }
    return
  }

  if (isChase) {
    // Dissonant screech + low brassy dread drop
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: 220,
      freqEnd: 610,
      duration: 0.38,
      attack: 0.02,
      gain: 0.24,
      filterType: 'bandpass',
      filterFreq: 1200,
      filterQ: 2.5,
    })
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: 233,
      freqEnd: 585,
      duration: 0.42,
      attack: 0.025,
      gain: 0.2,
      filterType: 'lowpass',
      filterFreq: 1500,
    })
    playToneBurst(ctx, dest, {
      type: 'triangle',
      freqStart: 95,
      freqEnd: 44,
      duration: 0.5,
      attack: 0.01,
      gain: 0.36,
    })
  } else {
    // Subtle suspicious radar-like harmonic ping / growl
    playToneBurst(ctx, dest, {
      type: 'triangle',
      freqStart: 135,
      freqEnd: 92,
      duration: 0.32,
      attack: 0.03,
      gain: 0.22,
      filterType: 'lowpass',
      filterFreq: 680,
    })
  }
}

export function triggerEnemyAttackCue(
  ctx,
  dest,
  noiseBuffer,
  isImpact = false,
  enemyType = 'stalker'
) {
  if (enemyType === 'brute') {
    if (isImpact) {
      playToneBurst(ctx, dest, {
        type: 'sine',
        freqStart: 110,
        freqEnd: 26,
        duration: 0.36,
        attack: 0.004,
        gain: 0.58,
      })
      playNoiseBurst(ctx, dest, noiseBuffer, {
        duration: 0.28,
        gain: 0.46,
        filterType: 'lowpass',
        filterFreq: 760,
        filterFreqEnd: 160,
      })
    } else {
      playToneBurst(ctx, dest, {
        type: 'sawtooth',
        freqStart: 85,
        freqEnd: 125,
        duration: 0.36,
        attack: 0.04,
        gain: 0.28,
        filterType: 'lowpass',
        filterFreq: 520,
      })
    }
    return
  }

  if (enemyType === 'hunter') {
    if (isImpact) {
      playNoiseBurst(ctx, dest, noiseBuffer, {
        duration: 0.14,
        gain: 0.38,
        filterType: 'bandpass',
        filterFreq: 2200,
        filterFreqEnd: 700,
        filterQ: 1.4,
      })
      playNoiseBurst(ctx, dest, noiseBuffer, {
        duration: 0.12,
        gain: 0.3,
        filterType: 'highpass',
        filterFreq: 1800,
        delay: 0.07,
      })
    } else {
      playNoiseBurst(ctx, dest, noiseBuffer, {
        duration: 0.18,
        gain: 0.26,
        filterType: 'highpass',
        filterFreq: 1800,
        filterFreqEnd: 3200,
        filterQ: 2.6,
      })
    }
    return
  }

  if (isImpact) {
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.22,
      gain: 0.42,
      filterType: 'bandpass',
      filterFreq: 1650,
      filterFreqEnd: 420,
      filterQ: 1.1,
    })
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: 190,
      freqEnd: 52,
      duration: 0.2,
      attack: 0.004,
      gain: 0.38,
      filterType: 'lowpass',
      filterFreq: 950,
    })
  } else {
    // Claw windup rasp
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.24,
      gain: 0.26,
      filterType: 'highpass',
      filterFreq: 1400,
      filterFreqEnd: 2600,
      filterQ: 2.2,
    })
    playToneBurst(ctx, dest, {
      type: 'sawtooth',
      freqStart: 140,
      freqEnd: 260,
      duration: 0.22,
      attack: 0.02,
      gain: 0.22,
      filterType: 'bandpass',
      filterFreq: 900,
    })
  }
}

export function triggerPlayerDamageCue(ctx, dest, noiseBuffer) {
  // Heavy impact thud + sharp shockwave transient + brief ringing
  playToneBurst(ctx, dest, {
    type: 'sine',
    freqStart: 135,
    freqEnd: 34,
    duration: 0.32,
    attack: 0.004,
    gain: 0.55,
  })
  playNoiseBurst(ctx, dest, noiseBuffer, {
    duration: 0.2,
    gain: 0.38,
    filterType: 'lowpass',
    filterFreq: 1300,
    filterFreqEnd: 260,
  })
  playToneBurst(ctx, dest, {
    type: 'sine',
    freqStart: 2200,
    freqEnd: 1850,
    duration: 0.45,
    attack: 0.02,
    gain: 0.08,
    delay: 0.03,
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

export function triggerPowerUpPickupCue(ctx, dest, powerUpType = 'wall_pass') {
  const notes =
    powerUpType === 'echo_reveal'
      ? [659.25, 830.61, 987.77, 1318.51] // E major crystalline sonar rise
      : powerUpType === 'coin_magnet'
        ? [523.25, 659.25, 783.99, 1046.5] // C major magnetic uplift
        : [587.33, 880.0, 1174.66] // D fifth phase prism rise

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
  maxSourceGain: 0.08,
  normalGain: 0.072,
  hiddenGain: 0.045,
  duckedGain: 0.042,
  hiddenDuckedGain: 0.032,
  layerAShare: 0.68,
  layerBShare: 0.32,
  highpassHz: 540,
})

/**
 * Generates a dedicated ~4.8-second pink/rain noise buffer with a 45ms equal-power
 * head/tail crossfade so continuous rainfall loops cleanly with zero wrap clicks.
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
  const nextSample = () => {
    const white = Math.random() * 2 - 1
    b0 = 0.996 * b0 + white * 0.026
    b1 = 0.982 * b1 + white * 0.034
    b2 = 0.942 * b2 + white * 0.052
    return Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.24) * 0.68))
  }

  for (let i = 0; i < length; i += 1) {
    data[i] = nextSample()
  }

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

/**
 * Starts a continuous two-layer staggered heavy rainfall bed routed exclusively to ambienceGain.
 * Uses highpass/bandpass frequency carving (>540 Hz body + ~4.3 kHz exterior sheen) to preserve
 * footsteps, ambient horror cues, and enemy alerts while capping combined gain <= 0.080.
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

  // Layer A: Continuous mid-high downpour wash (highpass 540 Hz keeps 60-500 Hz footsteps clear)
  const srcA = ctx.createBufferSource()
  srcA.buffer = noiseBuffer
  srcA.loop = true
  srcA.loopStart = 0
  srcA.loopEnd = bufferDuration

  const hpA = typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null
  if (hpA) {
    hpA.type = 'highpass'
    hpA.frequency?.setValueAtTime?.(THUNDERSTORM_RAIN_CONSTANTS.highpassHz, now)
    if (hpA.Q) hpA.Q.value = 0.7
  }
  const lpA = typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null
  if (lpA) {
    lpA.type = 'lowpass'
    lpA.frequency?.setValueAtTime?.(2750, now)
    if (lpA.Q) lpA.Q.value = 0.65
  }
  const gainA = ctx.createGain()
  if (gainA.gain) {
    gainA.gain.setValueAtTime?.(THUNDERSTORM_RAIN_CONSTANTS.layerAShare, now)
  }

  if (hpA && lpA) {
    srcA.connect(hpA)
    hpA.connect(lpA)
    lpA.connect(gainA)
  } else if (lpA) {
    srcA.connect(lpA)
    lpA.connect(gainA)
  } else {
    srcA.connect(gainA)
  }
  gainA.connect(bedGain)

  // Layer B: Staggered offset + subtle rate detune (~0.96x) for rain patter sheen without loop periodicity
  const srcB = ctx.createBufferSource()
  srcB.buffer = noiseBuffer
  srcB.loop = true
  srcB.loopStart = 0
  srcB.loopEnd = bufferDuration
  if (srcB.playbackRate) {
    if (typeof srcB.playbackRate.setValueAtTime === 'function') {
      srcB.playbackRate.setValueAtTime(0.96, now)
    } else {
      srcB.playbackRate.value = 0.96
    }
  }

  const bpB = typeof ctx.createBiquadFilter === 'function' ? ctx.createBiquadFilter() : null
  if (bpB) {
    bpB.type = 'bandpass'
    bpB.frequency?.setValueAtTime?.(4300, now)
    if (bpB.Q) bpB.Q.value = 0.72
  }
  const gainB = ctx.createGain()
  if (gainB.gain) {
    gainB.gain.setValueAtTime?.(THUNDERSTORM_RAIN_CONSTANTS.layerBShare, now)
  }

  if (bpB) {
    srcB.connect(bpB)
    bpB.connect(gainB)
  } else {
    srcB.connect(gainB)
  }
  gainB.connect(bedGain)

  const staggeredOffset = bufferDuration > 0 ? (bufferDuration * 0.43) % bufferDuration : 0
  srcA.start?.(now, 0)
  srcB.start?.(now, staggeredOffset)

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

    const baseLpA = currentHidden ? 1550 : currentDucked ? 2050 : 2750
    const driftA = currentHidden || currentDucked || currentReducedMotion ? 0 : (clampedBreath - 0.5) * 360
    const baseBpB = currentHidden ? 2900 : currentDucked ? 3500 : 4300
    const driftB = currentHidden || currentDucked || currentReducedMotion ? 0 : (clampedBreath - 0.5) * 420

    if (lpA?.frequency) {
      setParamSmooth(lpA.frequency, baseLpA + driftA, t, tau)
    }
    if (bpB?.frequency) {
      setParamSmooth(bpB.frequency, baseBpB + driftB, t, tau)
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
        srcA.stop?.(immediate ? t : t + 0.04)
        srcB.stop?.(immediate ? t : t + 0.04)
      } catch {
        // Ignore stop calls on unstarted or already-stopped nodes
      }
      try {
        srcA.disconnect()
        srcB.disconnect()
        hpA?.disconnect()
        lpA?.disconnect()
        bpB?.disconnect()
        gainA.disconnect()
        gainB.disconnect()
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

export function triggerStaminaWarningCue(ctx, dest, noiseBuffer, type = 'breathing') {
  if (type === 'breathing') {
    playNoiseBurst(ctx, dest, noiseBuffer, {
      duration: 0.45,
      attack: 0.12,
      gain: 0.14,
      filterType: 'bandpass',
      filterFreq: 340,
      filterFreqEnd: 220,
      filterQ: 2.0,
    })
  } else {
    playToneBurst(ctx, dest, {
      type: 'sine',
      freqStart: 62,
      freqEnd: 38,
      duration: 0.18,
      attack: 0.01,
      gain: 0.18,
    })
  }
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
          setParamSmooth(panner.positionX, x, t, 0.025)
          setParamSmooth(panner.positionY, y, t, 0.025)
          setParamSmooth(panner.positionZ, z, t, 0.025)
        } else {
          panner.setPosition?.(x, y, z)
        }
      }

      if (filter?.frequency) {
        setParamSmooth(filter.frequency, Math.max(180, cutoff), t, 0.035)
      }
      if (humOsc.frequency) {
        setParamSmooth(humOsc.frequency, Math.max(40, humHz), t, 0.04)
      }
      if (buzzOsc.frequency) {
        setParamSmooth(buzzOsc.frequency, Math.max(80, buzzHz), t, 0.04)
      }
      if (buzzGain.gain) {
        setParamSmooth(buzzGain.gain, Math.max(0.05, Math.min(0.6, buzzLevel)), t, 0.04)
      }
      if (voiceGain.gain) {
        setParamSmooth(voiceGain.gain, Math.max(0, gain), t, tau)
      }
    },
    silence(tau = 0.03) {
      if (stopped) return
      const t = ctx.currentTime || 0
      if (voiceGain.gain) {
        setParamSmooth(voiceGain.gain, 0, t, tau)
      }
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

function createAmbientCueHandle(ctx, dest, durationSec = 1.0, { setInitialGain = true } = {}) {
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
      setParamSmooth(cueGain.gain, 0, now, AMBIENT_CUE_FADE_TAU_SEC)
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


