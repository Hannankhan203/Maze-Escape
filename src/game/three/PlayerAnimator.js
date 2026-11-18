export const PLAYER_ANIM_STATES = {
  IDLE: 'idle',
  WALK: 'walk',
  SPRINT: 'sprint',
}

export const DEFAULT_PLAYER_ANIM_CONFIG = {
  idleFrequency: 2.1,
  idleBobAmplitude: 0.008,
  idleArmSway: 0.016,
  idleTorsoPitch: 0.012,

  walkFrequency: 8.6,
  walkLegSwing: 0.48,
  walkArmSwing: 0.36,
  walkBobAmplitude: 0.03,
  walkTorsoLean: -0.045,
  walkTorsoTwist: 0.04,
  walkTorsoRoll: 0.016,

  sprintFrequency: 13.6,
  sprintLegSwing: 0.82,
  sprintArmSwing: 0.78,
  sprintArmBendPitch: 0.16,
  sprintBobAmplitude: 0.058,
  sprintTorsoLean: -0.14,
  sprintTorsoTwist: 0.08,
  sprintTorsoRoll: 0.028,

  headCounterPitchFactor: 0.55,
  stateBlendRate: 11.0,
  stopDampRate: 26.0,
}

const TWO_PI = Math.PI * 2

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * Frame-rate-independent, zero-allocation procedural humanoid animator.
 * Drives idle breathing, walking, and sprinting gaits directly on the
 * `buildPlayer()` articulated pivot rig, synced to actual movement and collisions.
 */
export class PlayerAnimator {
  constructor(playerGroup = null, config = {}) {
    this.isDisposed = false
    this.config = {
      ...DEFAULT_PLAYER_ANIM_CONFIG,
      ...(config || {}),
    }

    this.playerGroup = null
    this.rig = null
    this.state = PLAYER_ANIM_STATES.IDLE
    this.walkWeight = 0
    this.sprintWeight = 0
    this.stridePhase = 0
    this.idlePhase = 0

    if (playerGroup) {
      this.setPlayerGroup(playerGroup)
    }
  }

  setPlayerGroup(playerGroup) {
    if (this.isDisposed) return
    this.playerGroup = playerGroup || null
    this.rig = playerGroup?.userData?.rig || null
    this.reset()
  }

  updateConfig(partialConfig = {}) {
    if (this.isDisposed || !partialConfig || typeof partialConfig !== 'object') {
      return { ...this.config }
    }
    this.config = {
      ...this.config,
      ...partialConfig,
    }
    return { ...this.config }
  }

  getState() {
    const locomotionWeight = clamp(this.walkWeight + this.sprintWeight, 0, 1)
    return {
      state: this.state,
      walkWeight: this.walkWeight,
      sprintWeight: this.sprintWeight,
      locomotionWeight,
      stridePhase: this.stridePhase,
      idlePhase: this.idlePhase,
    }
  }

  _applyNeutralPose() {
    const rig = this.rig
    if (!rig) return

    const restY = Number.isFinite(rig.restPose?.upperBodyY)
      ? rig.restPose.upperBodyY
      : 0.86

    if (rig.leftLegPivot) rig.leftLegPivot.rotation.x = 0
    if (rig.rightLegPivot) rig.rightLegPivot.rotation.x = 0
    if (rig.leftArmPivot) {
      rig.leftArmPivot.rotation.x = 0
      rig.leftArmPivot.rotation.z = 0
    }
    if (rig.rightArmPivot) {
      rig.rightArmPivot.rotation.x = 0
      rig.rightArmPivot.rotation.z = 0
    }
    if (rig.upperBodyPivot) {
      rig.upperBodyPivot.position.y = restY
      rig.upperBodyPivot.rotation.set(0, 0, 0)
    }
    if (rig.headPivot) {
      rig.headPivot.rotation.set(0, 0, 0)
    }
  }

  reset() {
    this.state = PLAYER_ANIM_STATES.IDLE
    this.walkWeight = 0
    this.sprintWeight = 0
    this.stridePhase = 0
    this.idlePhase = 0
    this._applyNeutralPose()
  }

  /**
   * Advances procedural idle/walk/sprint blend weights and updates limb pivots.
   * Performs zero heap or Three.js object allocations per call.
   *
   * @param {number} delta - Elapsed frame delta time in seconds.
   * @param {{
   *   moved?: boolean,
   *   isSprinting?: boolean,
   *   actualSpeed?: number,
   *   walkSpeed?: number,
   *   sprintSpeed?: number,
   * }|null} [motion=null] - Actual post-collision movement sample for this frame.
   */
  update(delta = 0, motion = null) {
    if (this.isDisposed) return

    const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0
    const cfg = this.config

    const actualSpeed =
      motion && Number.isFinite(motion.actualSpeed) ? motion.actualSpeed : 0
    const isMoving = Boolean(motion?.moved && actualSpeed > 0.05)
    const isSprinting = isMoving && Boolean(motion?.isSprinting)

    const nextState = !isMoving
      ? PLAYER_ANIM_STATES.IDLE
      : isSprinting
        ? PLAYER_ANIM_STATES.SPRINT
        : PLAYER_ANIM_STATES.WALK

    this.state = nextState

    if (dt > 0) {
      if (nextState === PLAYER_ANIM_STATES.IDLE) {
        // Stop stride advancement immediately when movement stops, and damp
        // active limb swing swiftly back to grounded neutral/idle.
        const stopDecay = Math.exp(-cfg.stopDampRate * dt)
        this.walkWeight *= stopDecay
        this.sprintWeight *= stopDecay

        if (this.walkWeight + this.sprintWeight < 0.004) {
          this.walkWeight = 0
          this.sprintWeight = 0
          this.stridePhase = 0
        }

        this.idlePhase = (this.idlePhase + cfg.idleFrequency * dt) % TWO_PI
      } else {
        const blendAlpha = 1 - Math.exp(-cfg.stateBlendRate * dt)
        const targetWalk = nextState === PLAYER_ANIM_STATES.WALK ? 1 : 0
        const targetSprint = nextState === PLAYER_ANIM_STATES.SPRINT ? 1 : 0

        this.walkWeight += (targetWalk - this.walkWeight) * blendAlpha
        this.sprintWeight += (targetSprint - this.sprintWeight) * blendAlpha

        const locoSum = clamp(this.walkWeight + this.sprintWeight, 0, 1)
        const sprintRatio = locoSum > 1e-5 ? this.sprintWeight / locoSum : 0

        const walkSpeedRef =
          motion && Number.isFinite(motion.walkSpeed) && motion.walkSpeed > 0
            ? motion.walkSpeed
            : 5.5
        const sprintSpeedRef =
          motion && Number.isFinite(motion.sprintSpeed) && motion.sprintSpeed > 0
            ? motion.sprintSpeed
            : 9.0
        const refSpeed = lerp(walkSpeedRef, sprintSpeedRef, sprintRatio)
        const speedScale = clamp(actualSpeed / Math.max(0.1, refSpeed), 0.4, 1.15)

        const freq =
          lerp(cfg.walkFrequency, cfg.sprintFrequency, sprintRatio) * speedScale
        this.stridePhase = (this.stridePhase + freq * dt) % TWO_PI
      }
    }

    const rig = this.rig
    if (!rig) return

    const loco = clamp(this.walkWeight + this.sprintWeight, 0, 1)
    const sprintRatio = loco > 1e-5 ? this.sprintWeight / loco : 0
    const idleWeight = 1 - loco

    const strideSin = Math.sin(this.stridePhase)
    const strideCos = Math.cos(this.stridePhase)
    const doubleBounce = 0.5 * (1 - Math.cos(2 * this.stridePhase))
    const idleBreath = Math.sin(this.idlePhase)

    const legAmp = lerp(cfg.walkLegSwing, cfg.sprintLegSwing, sprintRatio) * loco
    const armAmp = lerp(cfg.walkArmSwing, cfg.sprintArmSwing, sprintRatio) * loco
    const armForwardBias = cfg.sprintArmBendPitch * this.sprintWeight

    if (rig.leftLegPivot) {
      rig.leftLegPivot.rotation.x = strideSin * legAmp || 0
    }
    if (rig.rightLegPivot) {
      rig.rightLegPivot.rotation.x = -strideSin * legAmp || 0
    }

    if (rig.leftArmPivot) {
      rig.leftArmPivot.rotation.x =
        -strideSin * armAmp +
        armForwardBias +
        idleBreath * cfg.idleArmSway * idleWeight || 0
      rig.leftArmPivot.rotation.z = -0.05 * this.sprintWeight || 0
    }
    if (rig.rightArmPivot) {
      rig.rightArmPivot.rotation.x =
        strideSin * armAmp +
        armForwardBias -
        idleBreath * cfg.idleArmSway * idleWeight || 0
      rig.rightArmPivot.rotation.z = 0.05 * this.sprintWeight || 0
    }

    const restUpperY = Number.isFinite(rig.restPose?.upperBodyY)
      ? rig.restPose.upperBodyY
      : 0.86
    const bobAmp =
      lerp(cfg.walkBobAmplitude, cfg.sprintBobAmplitude, sprintRatio) * loco
    const torsoLean =
      lerp(cfg.walkTorsoLean, cfg.sprintTorsoLean, sprintRatio) * loco +
      idleBreath * cfg.idleTorsoPitch * idleWeight
    const torsoTwist =
      strideSin *
      lerp(cfg.walkTorsoTwist, cfg.sprintTorsoTwist, sprintRatio) *
      loco
    const torsoRoll =
      strideCos *
      lerp(cfg.walkTorsoRoll, cfg.sprintTorsoRoll, sprintRatio) *
      loco

    if (rig.upperBodyPivot) {
      rig.upperBodyPivot.position.y =
        restUpperY +
        doubleBounce * bobAmp +
        idleBreath * cfg.idleBobAmplitude * idleWeight
      rig.upperBodyPivot.rotation.x = torsoLean || 0
      rig.upperBodyPivot.rotation.y = torsoTwist || 0
      rig.upperBodyPivot.rotation.z = torsoRoll || 0
    }

    if (rig.headPivot) {
      rig.headPivot.rotation.x = -torsoLean * cfg.headCounterPitchFactor || 0
      rig.headPivot.rotation.y = -torsoTwist * 0.45 || 0
    }
  }

  dispose() {
    if (this.isDisposed) return false
    this.isDisposed = true
    this.reset()
    this.rig = null
    this.playerGroup = null
    return true
  }
}
