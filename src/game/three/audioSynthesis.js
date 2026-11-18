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
  const length = Math.max(1, Math.floor(sampleRate * durationSec))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  // Mildly pink-tinted procedural noise for organic footsteps, wind, and metal textures
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1
    b0 = 0.997 * b0 + white * 0.029
    b1 = 0.985 * b1 + white * 0.032
    b2 = 0.950 * b2 + white * 0.048
    data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.18) * 0.7))
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
    duration = 0.25,
    attack = 0.01,
    gain = 0.3,
    filterType = null,
    filterFreq = 1800,
    filterQ = 1.0,
    delay = 0,
  } = {}
) {
  if (!ctx || !dest || typeof ctx.createOscillator !== 'function') return null
  const now = (ctx.currentTime || 0) + Math.max(0, delay)
  const safeDur = Math.max(0.03, duration)
  const osc = ctx.createOscillator()
  const gainNode = ctx.createGain()

  osc.type = type
  if (osc.frequency) {
    osc.frequency.setValueAtTime?.(Math.max(20, freqStart), now)
    if (freqEnd !== freqStart && typeof osc.frequency.exponentialRampToValueAtTime === 'function') {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + safeDur)
    }
  }

  if (gainNode.gain) {
    gainNode.gain.setValueAtTime?.(0.0001, now)
    gainNode.gain.linearRampToValueAtTime?.(Math.max(0.001, gain), now + Math.min(attack, safeDur * 0.4))
    gainNode.gain.exponentialRampToValueAtTime?.(0.0001, now + safeDur)
  }

  let outputNode = osc
  let filter = null
  if (filterType && typeof ctx.createBiquadFilter === 'function') {
    filter = ctx.createBiquadFilter()
    filter.type = filterType
    filter.frequency?.setValueAtTime?.(filterFreq, now)
    if (filter.Q) filter.Q.value = filterQ
    outputNode.connect(filter)
    outputNode = filter
  }

  outputNode.connect(dest === undefined ? ctx.destination : gainNode)
  if (outputNode !== gainNode) {
    // Wire filter -> gain -> destination
    osc.disconnect?.()
    if (filter) {
      osc.connect(filter)
      filter.connect(gainNode)
    } else {
      osc.connect(gainNode)
    }
    gainNode.connect(dest)
  }

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
    filterType = 'bandpass',
    filterFreq = 600,
    filterFreqEnd = null,
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

  const now = (ctx.currentTime || 0) + Math.max(0, delay)
  const safeDur = Math.max(0.03, duration)
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer

  const gainNode = ctx.createGain()
  if (gainNode.gain) {
    gainNode.gain.setValueAtTime?.(0.0001, now)
    gainNode.gain.linearRampToValueAtTime?.(Math.max(0.001, gain), now + Math.min(attack, safeDur * 0.35))
    gainNode.gain.exponentialRampToValueAtTime?.(0.0001, now + safeDur)
  }

  let filter = null
  if (typeof ctx.createBiquadFilter === 'function') {
    filter = ctx.createBiquadFilter()
    filter.type = filterType
    filter.frequency?.setValueAtTime?.(Math.max(40, filterFreq), now)
    if (
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

  const startOffset = Math.max(0, Math.min(Math.max(0, (noiseBuffer.duration || 1) - safeDur), offset))
  src.start?.(now, startOffset, safeDur + 0.02)
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

/**
 * Starts continuous ambient vault drone + filtered wind bed routed to ambienceGain.
 */
export function startAmbientBed(ctx, dest, noiseBuffer) {
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
    setParamSmooth(bedGain.gain, 0.35, now, 0.45)
  }

  if (filter) {
    filter.type = 'lowpass'
    filter.frequency?.setValueAtTime?.(460, now)
    filter.connect(bedGain)
    bedGain.connect(dest)
  } else {
    bedGain.connect(dest)
  }

  const subDest = filter || bedGain

  // Dual detuned sub drones (dark minor-2nd tension at low sub-bass)
  const oscA = ctx.createOscillator()
  oscA.type = 'sine'
  oscA.frequency?.setValueAtTime?.(44, now)
  const oscAGain = ctx.createGain()
  if (oscAGain.gain) oscAGain.gain.value = 0.48
  oscA.connect(oscAGain)
  oscAGain.connect(subDest)

  const oscB = ctx.createOscillator()
  oscB.type = 'triangle'
  oscB.frequency?.setValueAtTime?.(46.5, now)
  const oscBGain = ctx.createGain()
  if (oscBGain.gain) oscBGain.gain.value = 0.18
  oscB.connect(oscBGain)
  oscBGain.connect(subDest)

  // Continuous looping cold corridor draft
  let noiseSrc = null
  let noiseGain = null
  if (noiseBuffer && typeof ctx.createBufferSource === 'function') {
    noiseSrc = ctx.createBufferSource()
    noiseSrc.buffer = noiseBuffer
    noiseSrc.loop = true
    noiseGain = ctx.createGain()
    if (noiseGain.gain) noiseGain.gain.value = 0.24
    noiseSrc.connect(noiseGain)
    noiseGain.connect(subDest)
    noiseSrc.start?.(now)
  }

  oscA.start?.(now)
  oscB.start?.(now)

  let stopped = false

  return {
    setStealthDucking(isHidden) {
      if (stopped) return
      const t = ctx.currentTime || 0
      if (filter?.frequency) {
        setParamSmooth(filter.frequency, isHidden ? 210 : 460, t, 0.18)
      }
      if (bedGain.gain) {
        setParamSmooth(bedGain.gain, isHidden ? 0.24 : 0.35, t, 0.18)
      }
    },
    stop() {
      if (stopped) return
      stopped = true
      const t = ctx.currentTime || 0
      try {
        oscA.stop?.(t + 0.05)
        oscB.stop?.(t + 0.05)
        noiseSrc?.stop?.(t + 0.05)
      } catch {
        // Ignore stop calls on unstarted nodes
      }
      try {
        oscA.disconnect()
        oscB.disconnect()
        oscAGain.disconnect()
        oscBGain.disconnect()
        noiseSrc?.disconnect()
        noiseGain?.disconnect()
        filter?.disconnect()
        bedGain.disconnect()
      } catch {
        // Ignore cleanup errors
      }
    },
  }
}

/**
 * Adaptive horror music bed supporting exploration, tension, and chase moods.
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
    filter.frequency?.setValueAtTime?.(380, now)
    filter.connect(musicOut)
    musicOut.connect(dest)
  } else {
    musicOut.connect(dest)
  }

  const innerDest = filter || musicOut

  // Pad voice (continuous slow ominous chord cluster)
  const padOsc = ctx.createOscillator()
  padOsc.type = 'sawtooth'
  padOsc.frequency?.setValueAtTime?.(65.41, now) // C2
  const padGain = ctx.createGain()
  if (padGain.gain) padGain.gain.value = 0.22
  padOsc.connect(padGain)
  padGain.connect(innerDest)
  padOsc.start?.(now)

  // Dissonant minor-second pulse voice modulated on chase/tension beats
  const tensionOsc = ctx.createOscillator()
  tensionOsc.type = 'sawtooth'
  tensionOsc.frequency?.setValueAtTime?.(69.3, now) // C#2 dissonance
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
      if (mood === 'silent') {
        setParamSmooth(musicOut.gain, 0.0001, t, 0.25)
      } else if (mood === 'ambient') {
        setParamSmooth(musicOut.gain, 0.16, t, 0.45)
        if (filter?.frequency) setParamSmooth(filter.frequency, 280, t, 0.4)
        if (tensionGain.gain) setParamSmooth(tensionGain.gain, 0.04, t, 0.4)
      } else if (mood === 'tension') {
        setParamSmooth(musicOut.gain, 0.34, t, 0.25)
        if (filter?.frequency) setParamSmooth(filter.frequency, 580, t, 0.25)
        if (tensionGain.gain) setParamSmooth(tensionGain.gain, 0.18, t, 0.25)
      } else if (mood === 'chase') {
        setParamSmooth(musicOut.gain, 0.56, t, 0.12)
        if (filter?.frequency) setParamSmooth(filter.frequency, 1250, t, 0.12)
        if (tensionGain.gain) setParamSmooth(tensionGain.gain, 0.36, t, 0.12)
      }
    },
    tick(delta = 0.016) {
      if (stopped || mood === 'silent') return
      const rate = mood === 'chase' ? 6.2 : mood === 'tension' ? 2.8 : 0.8
      pulsePhase = (pulsePhase + delta * rate) % (Math.PI * 2)
      const pulse = 0.5 + 0.5 * Math.sin(pulsePhase)
      if (mood === 'chase') {
        const t = ctx.currentTime || 0
        if (filter?.frequency) {
          setParamSmooth(filter.frequency, 680 + pulse * 920, t, 0.04)
        }
        if (padGain.gain) {
          setParamSmooth(padGain.gain, 0.22 + pulse * 0.24, t, 0.04)
        }
      } else if (mood === 'tension' && filter?.frequency) {
        setParamSmooth(filter.frequency, 420 + pulse * 260, ctx.currentTime || 0, 0.08)
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
