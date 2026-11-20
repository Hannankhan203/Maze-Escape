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

  const now = (ctx.currentTime || 0) + Math.max(0, Number.isFinite(delay) ? delay : 0)
  const safeDur = Math.max(0.03, Number.isFinite(duration) ? duration : 0.16)
  const playDuration = safeDur + 0.02
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
  playToneBurst(ctx, dest, {
    type: 'sine',
    freqStart: 520,
    freqEnd: 390,
    duration: 0.58,
    attack: 0.06,
    gain: 0.24,
    filterType: 'bandpass',
    filterFreq: 760,
  })
  playNoiseBurst(ctx, dest, noiseBuffer, {
    duration: 0.52,
    attack: 0.1,
    gain: 0.26,
    filterType: 'bandpass',
    filterFreq: 660,
    filterFreqEnd: 300,
  })
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

function createAmbientCueHandle(ctx, dest, durationSec = 1.0) {
  if (!ctx || !dest) {
    return {
      cueDest: null,
      track: () => null,
      finish: () => ({ durationSec: 0, stop: () => {} }),
    }
  }

  const cueGain = typeof ctx.createGain === 'function' ? ctx.createGain() : null
  if (cueGain) {
    if (cueGain.gain) {
      setParamSmooth(cueGain.gain, 1, ctx.currentTime || 0, 0.005)
    }
    cueGain.connect?.(dest)
  }

  const cueDest = cueGain || dest
  const nodes = []
  let remaining = 0
  let stopped = false

  const disconnectCueGain = () => {
    if (!cueGain) return
    try {
      cueGain.disconnect?.()
    } catch {
      // Ignore already-disconnected errors on cleanup
    }
  }

  const track = (node) => {
    if (!node) return null
    nodes.push(node)
    remaining += 1
    const prevOnEnded = node.onended
    node.onended = () => {
      try {
        prevOnEnded?.()
      } finally {
        remaining -= 1
        if (remaining <= 0 || stopped) {
          disconnectCueGain()
        }
      }
    }
    return node
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    const now = ctx.currentTime || 0
    if (cueGain?.gain) {
      setParamSmooth(cueGain.gain, 0, now, 0.025)
    }
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      try {
        node.stop?.(now + 0.025)
      } catch {
        // Ignore already-stopped node errors
      }
      try {
        node.disconnect?.()
      } catch {
        // Ignore already-disconnected errors
      }
    }
    nodes.length = 0
    disconnectCueGain()
  }

  return {
    cueDest,
    track,
    finish: () => {
      if (nodes.length === 0) {
        disconnectCueGain()
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
 * Ambient Category 1: Creepy metallic groans, unsettling pipe knocks & sudden metal snaps.
 * Strong 380-1850 Hz speaker presence with dissonant metallic harmonics.
 * Variant 2 provides a rare sudden metallic tension snap.
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
    // Tortured minor-second steel beam groan (dissonant metallic beating)
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sawtooth',
        freqStart: 235 * scale,
        freqEnd: 158 * scale,
        duration: 2.2,
        attack: 0.34,
        gain: 0.27 * amp,
        filterType: 'bandpass',
        filterFreq: 560 * scale,
        filterQ: 2.8,
      })
    )
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sawtooth',
        freqStart: 249 * scale,
        freqEnd: 169 * scale,
        duration: 2.08,
        attack: 0.38,
        gain: 0.22 * amp,
        filterType: 'bandpass',
        filterFreq: 720 * scale,
        filterQ: 2.6,
        delay: 0.08,
      })
    )
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 1.65,
          attack: 0.24,
          gain: 0.22 * amp,
          filterType: 'bandpass',
          filterFreq: 940,
          filterFreqEnd: 410,
          filterQ: 2.1,
          delay: 0.1,
          offset: 0.2,
        })
      )
    }
  } else if (safeVariant === 1) {
    // Unnerving irregular triple pipe-knock (hesitating third knock + hollow ring)
    const knocks = [
      { delay: 0, gainScale: 1.0, pitchShift: 1.0 },
      { delay: 0.34, gainScale: 0.72, pitchShift: 0.95 },
      { delay: 0.98, gainScale: 0.86, pitchShift: 1.07 },
    ]
    for (let i = 0; i < knocks.length; i += 1) {
      const k = knocks[i]
      handle.track(
        playToneBurst(ctx, handle.cueDest, {
          type: 'triangle',
          freqStart: 390 * scale * k.pitchShift,
          freqEnd: 312 * scale * k.pitchShift,
          duration: 0.48,
          attack: 0.01,
          gain: 0.32 * amp * k.gainScale,
          filterType: 'bandpass',
          filterFreq: 620 * scale,
          filterQ: 2.5,
          delay: k.delay,
        })
      )
      handle.track(
        playToneBurst(ctx, handle.cueDest, {
          type: 'sine',
          freqStart: 785 * scale * k.pitchShift,
          freqEnd: 660 * scale * k.pitchShift,
          duration: 0.42,
          attack: 0.008,
          gain: 0.2 * amp * k.gainScale,
          filterType: 'bandpass',
          filterFreq: 860 * scale,
          filterQ: 2.4,
          delay: k.delay + 0.006,
        })
      )
      if (noiseBuffer) {
        handle.track(
          playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
            duration: 0.11,
            attack: 0.008,
            gain: 0.2 * amp * k.gainScale,
            filterType: 'bandpass',
            filterFreq: 820,
            filterQ: 1.3,
            delay: k.delay,
            offset: 0.3 + i * 0.25,
          })
        )
      }
    }
  } else {
    // Sudden startling steel cable / vent-seam SNAP + trembling groan tail
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sawtooth',
        freqStart: 940 * scale,
        freqEnd: 295 * scale,
        duration: 0.34,
        attack: 0.005,
        gain: 0.33 * amp,
        filterType: 'bandpass',
        filterFreq: 1120 * scale,
        filterQ: 2.2,
      })
    )
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.22,
          attack: 0.004,
          gain: 0.29 * amp,
          filterType: 'bandpass',
          filterFreq: 1850,
          filterFreqEnd: 620,
          filterQ: 1.9,
          offset: 0.45,
        })
      )
    }
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'triangle',
        freqStart: 224 * scale,
        freqEnd: 142 * scale,
        duration: 1.45,
        attack: 0.08,
        gain: 0.26 * amp,
        filterType: 'bandpass',
        filterFreq: 420 * scale,
        filterQ: 2.1,
        delay: 0.06,
      })
    )
  }

  return handle.finish()
}

/**
 * Ambient Category 2: Unsettling underground groans, seismic ceiling tremors & cavity slams.
 * Emphasizes 130-560 Hz speaker-audible grit and dissonant stone harmonics.
 * Variant 2 delivers a sudden distant pressure thump before blooming into cavern resonance.
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
    // Sudden distant cavity pressure thump + eerie cavern groan tail
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'triangle',
        freqStart: 162 * scale,
        freqEnd: 68 * scale,
        duration: 0.56,
        attack: 0.012,
        gain: 0.31 * amp,
        filterType: 'lowpass',
        filterFreq: 340,
      })
    )
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.42,
          attack: 0.01,
          gain: 0.28 * amp,
          filterType: 'bandpass',
          filterFreq: 580,
          filterFreqEnd: 210,
          filterQ: 1.2,
          offset: 0.2,
        })
      )
    }
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sawtooth',
        freqStart: 192 * scale,
        freqEnd: 126 * scale,
        duration: dur * 0.82,
        attack: 0.28,
        gain: 0.24 * amp,
        filterType: 'lowpass',
        filterFreq: 310,
        delay: 0.16,
      })
    )
    return handle.finish()
  }

  const swellAttack = Math.max(0.5, dur * 0.34)
  handle.track(
    playToneBurst(ctx, handle.cueDest, {
      type: 'triangle',
      freqStart: 138 * scale,
      freqEnd: 94 * scale,
      duration: dur,
      attack: swellAttack,
      gain: 0.28 * amp,
      filterType: 'lowpass',
      filterFreq: 280,
    })
  )
  handle.track(
    playToneBurst(ctx, handle.cueDest, {
      type: 'sawtooth',
      freqStart: (safeVariant === 1 ? 152 : 196) * scale,
      freqEnd: (safeVariant === 1 ? 106 : 132) * scale,
      duration: dur * 0.9,
      attack: swellAttack * 1.05,
      gain: 0.21 * amp,
      filterType: 'lowpass',
      filterFreq: 340,
      delay: 0.12,
    })
  )
  if (noiseBuffer) {
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: dur * 0.95,
        attack: swellAttack * 0.88,
        gain: 0.3 * amp,
        filterType: 'bandpass',
        filterFreq: safeVariant === 1 ? 520 : 440,
        filterFreqEnd: 190,
        filterQ: 1.2,
        offset: (safeVariant * 0.45) % 1.0,
      })
    )
  }

  return handle.finish()
}

/**
 * Ambient Category 3: Disturbing wind, ghostly vent whistles & sudden shaft gusts.
 * Tuned to 340-1550 Hz bandpass sweeps so eerie wind texture reads clearly on PC speakers.
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
  if (!handle.cueDest) return handle.finish()

  const isSuddenGust = safeVariant === 2
  const firstFreqA = safeVariant === 1 ? 640 : isSuddenGust ? 480 : 340
  const firstFreqB = safeVariant === 1 ? 1280 : isSuddenGust ? 1480 : 920
  const secondFreqA = safeVariant === 1 ? 1150 : isSuddenGust ? 1120 : 780
  const secondFreqB = safeVariant === 1 ? 460 : 390

  if (noiseBuffer) {
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: dur * 0.78,
        attack: isSuddenGust ? 0.08 : dur * 0.24,
        gain: (isSuddenGust ? 0.32 : 0.29) * amp,
        filterType: 'bandpass',
        filterFreq: firstFreqA,
        filterFreqEnd: firstFreqB,
        filterQ: safeVariant === 0 ? 2.6 : 2.1,
        offset: (safeVariant * 0.35) % 1.0,
      })
    )
    handle.track(
      playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
        duration: dur * 0.74,
        attack: dur * 0.24,
        gain: 0.27 * amp,
        filterType: 'bandpass',
        filterFreq: secondFreqA,
        filterFreqEnd: secondFreqB,
        filterQ: 2.2,
        delay: dur * 0.2,
        offset: (0.65 + safeVariant * 0.25) % 1.1,
      })
    )
  }

  // Ghostly minor-second vent whistle / damper resonance
  handle.track(
    playToneBurst(ctx, handle.cueDest, {
      type: 'sine',
      freqStart: isSuddenGust ? 587 : 466 - safeVariant * 24,
      freqEnd: isSuddenGust ? 370 : 415 - safeVariant * 20,
      duration: dur * 0.82,
      attack: isSuddenGust ? 0.12 : dur * 0.3,
      gain: 0.16 * amp,
      filterType: 'bandpass',
      filterFreq: 520,
      filterQ: 2.0,
      delay: dur * 0.08,
    })
  )

  return handle.finish()
}

/**
 * Ambient Category 4: Strange distant footsteps, unnatural limping/staggered steps & corridor echoes.
 * Distinctly eerier and slower/more irregular than active enemy footsteps, with 420-1180 Hz
 * slapback echo presence for PC speaker audibility.
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
    // Unnatural hesitating/limping cadence (long pause, quick drag-step, pause)
    stepTimes.push(0, 0.86, 1.2, 2.04)
  } else if (safeVariant === 2) {
    // Sudden brief scurrying away into silence
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
  if (!handle.cueDest) return handle.finish()

  for (let i = 0; i < stepTimes.length; i += 1) {
    const stepDelay = stepTimes[i]
    const decayFactor = safeVariant === 2 ? Math.max(0.45, 1 - i * 0.18) : Math.max(0.62, 1 - i * 0.12)

    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'triangle',
        freqStart: (146 - i * 6) * scale,
        freqEnd: (78 - i * 4) * scale,
        duration: 0.15,
        attack: 0.014,
        gain: 0.25 * amp * decayFactor,
        filterType: 'lowpass',
        filterFreq: 480,
        delay: stepDelay,
      })
    )
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: safeVariant === 1 && i === 2 ? 0.2 : 0.12,
          attack: 0.012,
          gain: 0.22 * amp * decayFactor,
          filterType: 'bandpass',
          filterFreq: safeVariant === 2 ? 1050 : 740,
          filterFreqEnd: 380,
          filterQ: 1.7,
          delay: stepDelay,
          offset: (0.18 + i * 0.27) % 1.2,
        })
      )
    }

    // Hollow unnatural slapback echo down empty corridor
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sine',
        freqStart: 225 * scale,
        freqEnd: 142 * scale,
        duration: 0.2,
        attack: 0.018,
        gain: 0.16 * amp * decayFactor,
        filterType: 'bandpass',
        filterFreq: 540,
        filterQ: 2.0,
        delay: stepDelay + 0.21,
      })
    )
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.18,
          attack: 0.016,
          gain: 0.15 * amp * decayFactor,
          filterType: 'bandpass',
          filterFreq: 620,
          filterFreqEnd: 310,
          filterQ: 1.8,
          delay: stepDelay + 0.22,
          offset: (0.55 + i * 0.21) % 1.2,
        })
      )
    }
  }

  return handle.finish()
}

/**
 * Ambient Category 5: Rare frightening horror anomalies.
 * Variant 0: Sudden distant steel door slam + eerie screeching corridor echo (startling).
 * Variant 1: Unnatural echoing drips + dissonant hollow shimmer.
 * Variant 2: Distant ghostly minor-second vent moan/siren resonance.
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
    // Sudden startling distant heavy steel door slam + eerie reverberant metallic screech
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'triangle',
        freqStart: 195 * scale,
        freqEnd: 58 * scale,
        duration: 0.44,
        attack: 0.006,
        gain: 0.33 * amp,
        filterType: 'lowpass',
        filterFreq: 420,
      })
    )
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 0.34,
          attack: 0.005,
          gain: 0.29 * amp,
          filterType: 'bandpass',
          filterFreq: 1420,
          filterFreqEnd: 460,
          filterQ: 1.6,
          offset: 0.15,
        })
      )
    }
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sawtooth',
        freqStart: 622 * scale,
        freqEnd: 554 * scale,
        duration: 1.95,
        attack: 0.09,
        gain: 0.2 * amp,
        filterType: 'bandpass',
        filterFreq: 780 * scale,
        filterQ: 2.8,
        delay: 0.08,
      })
    )
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sine',
        freqStart: 880 * scale,
        freqEnd: 740 * scale,
        duration: 1.75,
        attack: 0.12,
        gain: 0.15 * amp,
        filterType: 'bandpass',
        filterFreq: 860 * scale,
        filterQ: 2.4,
        delay: 0.14,
      })
    )
  } else if (safeVariant === 1) {
    // Unnatural echoing condensation drips + eerie hollow harmonic shimmer
    const drips = [
      { delay: 0, gainScale: 1.0, freq: 940 },
      { delay: 0.62, gainScale: 0.82, freq: 1120 },
      { delay: 1.38, gainScale: 0.68, freq: 860 },
    ]
    for (let i = 0; i < drips.length; i += 1) {
      const d = drips[i]
      handle.track(
        playToneBurst(ctx, handle.cueDest, {
          type: 'sine',
          freqStart: d.freq * scale,
          freqEnd: (d.freq + 380) * scale,
          duration: 0.11,
          attack: 0.006,
          gain: 0.3 * amp * d.gainScale,
          filterType: 'bandpass',
          filterFreq: 1220 * scale,
          filterQ: 2.2,
          delay: d.delay,
        })
      )
      handle.track(
        playToneBurst(ctx, handle.cueDest, {
          type: 'sine',
          freqStart: 523 * scale,
          freqEnd: 466 * scale,
          duration: 0.38,
          attack: 0.02,
          gain: 0.19 * amp * d.gainScale,
          filterType: 'bandpass',
          filterFreq: 560 * scale,
          filterQ: 2.2,
          delay: d.delay + 0.08,
        })
      )
    }
  } else {
    // Distant unearthly dissonant vent moan (minor-second D4/D#4 + eerie airflow)
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sine',
        freqStart: 293.66 * scale,
        freqEnd: 277.18 * scale,
        duration: 3.0,
        attack: 0.72,
        gain: 0.24 * amp,
        filterType: 'bandpass',
        filterFreq: 440 * scale,
        filterQ: 1.8,
      })
    )
    handle.track(
      playToneBurst(ctx, handle.cueDest, {
        type: 'sine',
        freqStart: 311.13 * scale,
        freqEnd: 293.66 * scale,
        duration: 2.85,
        attack: 0.78,
        gain: 0.2 * amp,
        filterType: 'bandpass',
        filterFreq: 520 * scale,
        filterQ: 1.8,
        delay: 0.16,
      })
    )
    if (noiseBuffer) {
      handle.track(
        playNoiseBurst(ctx, handle.cueDest, noiseBuffer, {
          duration: 2.75,
          attack: 0.62,
          gain: 0.26 * amp,
          filterType: 'bandpass',
          filterFreq: 380,
          filterFreqEnd: 840,
          filterQ: 2.0,
          delay: 0.14,
          offset: 0.4,
        })
      )
    }
  }

  return handle.finish()
}

