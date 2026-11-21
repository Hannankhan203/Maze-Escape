import {
  DIFFICULTY_ORDER,
  MAZE_DIFFICULTIES,
} from '../../game/generation/mazeConfig.js'
import {
  DEFAULT_AUDIO_VOLUMES,
  DEFAULT_KEY_BINDINGS,
  THIRD_PERSON_CAMERA_MODES,
} from '../../game/three/threeConfig.js'

export const SETTINGS_CATEGORIES = [
  {
    id: 'audio',
    label: 'Audio',
    description: 'Acoustic levels, directional 3D positioning, and sensory soundscapes',
  },
  {
    id: 'controls',
    label: 'Mouse & Controls',
    description: 'Look sensitivity, axis inversion, touch controls, and keybinds',
  },
  {
    id: 'graphics',
    label: 'Graphics',
    description: 'Render quality, lighting, volumetric fog, and visual fidelity',
  },
  {
    id: 'gameplay',
    label: 'Gameplay',
    description: 'Camera perspective, horror director intensity, and accessibility',
  },
]

export const SETTINGS_SCHEMA = {
  audio: [
    {
      group: 'Volume Levels',
      items: [
        {
          id: 'masterVolume',
          type: 'slider',
          label: 'Master Volume',
          description: 'Overall sensory output across all audio channels',
          min: 0,
          max: 100,
          step: 5,
          defaultValue: Math.round(DEFAULT_AUDIO_VOLUMES.master * 100),
          unit: '%',
        },
        {
          id: 'ambienceVolume',
          type: 'slider',
          label: 'Ambience & Drones',
          description: 'Dark subterranean room tones, resonant hums, and ventilation',
          min: 0,
          max: 100,
          step: 5,
          defaultValue: Math.round(DEFAULT_AUDIO_VOLUMES.ambience * 100),
          unit: '%',
        },
        {
          id: 'effectsVolume',
          type: 'slider',
          label: 'Sound Effects (SFX)',
          description: 'Footsteps, flashlight clicks, keycard chimes, and locker metal',
          min: 0,
          max: 100,
          step: 5,
          defaultValue: Math.round(DEFAULT_AUDIO_VOLUMES.effects * 100),
          unit: '%',
        },
        {
          id: 'musicVolume',
          type: 'slider',
          label: 'Music & Tension Stems',
          description: 'Procedural horror drones and stalker pursuit crescendos',
          min: 0,
          max: 100,
          step: 5,
          defaultValue: Math.round(DEFAULT_AUDIO_VOLUMES.music * 100),
          unit: '%',
        },
      ],
    },
    {
      group: 'Sensory Configuration',
      items: [
        {
          id: 'muted',
          type: 'toggle',
          label: 'Mute All Audio',
          description: 'Silence all audio generators and synthesizers',
          defaultValue: false,
        },
        {
          id: 'spatialAudio',
          type: 'toggle',
          label: '3D Spatial Audio',
          description: 'Real-time binaural listener orientation and distance attenuation',
          defaultValue: true,
        },
        {
          id: 'footstepEchoes',
          type: 'toggle',
          label: 'Acoustic Corridor Reverb',
          description: 'Simulated vault reflections that hint at approaching threats',
          defaultValue: true,
        },
      ],
    },
  ],
  controls: [
    {
      group: 'Mouse & Pointer Look',
      items: [
        {
          id: 'mouseSensitivity',
          type: 'slider',
          label: 'Mouse Sensitivity',
          description: 'Horizontal and vertical turning speed for desktop pointer look',
          min: 40,
          max: 250,
          step: 10,
          defaultValue: 100,
          unit: '%',
        },
        {
          id: 'invertY',
          type: 'toggle',
          label: 'Invert Y-Axis',
          description: 'Invert vertical pitch look for mouse, drag-look, and touch',
          defaultValue: false,
        },
        {
          id: 'touchLookSensitivity',
          type: 'slider',
          label: 'Touch Look Sensitivity',
          description: 'Swipe responsiveness on mobile touchscreens',
          min: 50,
          max: 300,
          step: 10,
          defaultValue: 180,
          unit: '%',
        },
      ],
    },
    {
      group: 'Touch Pad & Mobile Controls',
      items: [
        {
          id: 'touchControlsMode',
          type: 'segmented',
          label: 'Touch D-Pad Display',
          description: 'Display on-screen movement joystick and sprint button on mobile',
          options: [
            { value: 'auto', label: 'Auto (Touch Only)' },
            { value: 'always', label: 'Always Visible' },
            { value: 'off', label: 'Disabled' },
          ],
          defaultValue: 'auto',
        },
        {
          id: 'touchHaptics',
          type: 'toggle',
          label: 'Haptic Feedback',
          description: 'Tactile device vibration on damage, collision, and ability triggers',
          defaultValue: true,
        },
      ],
    },
    {
      group: 'Keyboard & Input Reference',
      items: [
        {
          id: 'keybinds',
          type: 'keybindTable',
          label: 'Default Key Bindings',
          description: 'Direct keyboard actions for 2D and 3D labyrinth exploration',
          bindings: [
            { action: 'Move / Navigate', keys: ['W', 'A', 'S', 'D', 'Arrows'] },
            { action: 'Sprint / Dash', keys: ['Shift'] },
            { action: 'Toggle Flashlight', keys: ['L'] },
            { action: 'Enter / Exit Locker', keys: ['F'] },
            { action: 'Wall-Pass Phase', keys: ['Space'] },
            { action: 'Echo Reveal Scan', keys: ['E'] },
            { action: 'Coin Magnet Pulse', keys: ['Q'] },
            { action: 'Tactical Minimap', keys: ['M'] },
            { action: 'Wayfinder Beacon', keys: ['H'] },
            {
              id: 'cycleCameraDistance',
              action: 'Cycle Camera Distance',
              keys: ['C'],
              defaultKey: DEFAULT_KEY_BINDINGS.cycleCameraDistance,
              customizable: true,
            },
          ],
        },
      ],
    },
  ],
  graphics: [
    {
      group: 'Display & Rendering Quality',
      items: [
        {
          id: 'qualityPreset',
          type: 'segmented',
          label: 'Render Resolution Scale',
          description: 'Internal WebGL resolution scale and pixel density multiplier',
          options: [
            { value: 'performance', label: 'Performance (1.0x)' },
            { value: 'balanced', label: 'Balanced (1.5x)' },
            { value: 'high', label: 'High (2.0x)' },
          ],
          defaultValue: 'high',
        },
        {
          id: 'antialias',
          type: 'toggle',
          label: 'Edge Smoothing (Antialiasing)',
          description: 'Smooth jagged geometric lines on corridor walls and floors',
          defaultValue: true,
        },
      ],
    },
    {
      group: 'Atmosphere & Illumination',
      items: [
        {
          id: 'volumetricFog',
          type: 'toggle',
          label: 'Volumetric Vault Fog',
          description: 'Atmospheric depth fog with exponential distance falloff',
          defaultValue: true,
        },
        {
          id: 'particlesEnabled',
          type: 'toggle',
          label: 'Floating Dust Motes',
          description: 'Ambient airborne micro-debris illuminated by the flashlight beam',
          defaultValue: true,
        },
        {
          id: 'dynamicLights',
          type: 'toggle',
          label: 'Localized Chamber Lights',
          description: 'Glow beacons for start chamber, exit gate, and enemy eyes',
          defaultValue: true,
        },
        {
          id: 'highContrast',
          type: 'toggle',
          label: 'High-Contrast Wall Outlines',
          description: 'Enhanced edge contrast for visual accessibility and clarity',
          defaultValue: false,
        },
      ],
    },
  ],
  gameplay: [
    {
      group: 'Camera & Perspective',
      items: [
        {
          id: 'defaultCamera',
          type: 'segmented',
          label: 'Default 3D Camera',
          description: 'Preferred viewing perspective when entering 3D labyrinth chambers',
          options: [
            { value: 'first-person', label: 'First-Person' },
            { value: 'third-person', label: 'Third-Person' },
          ],
          defaultValue: 'first-person',
        },
        {
          id: 'thirdPersonCameraMode',
          type: 'segmented',
          label: 'Third-Person Camera Mode',
          description:
            'Character Follow turns player with mouse; Free Look orbits independently around player',
          options: [
            {
              value: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
              label: 'Character Follow',
            },
            {
              value: THIRD_PERSON_CAMERA_MODES.FREE_LOOK,
              label: 'Free Look',
            },
          ],
          defaultValue: THIRD_PERSON_CAMERA_MODES.CHARACTER_FOLLOW,
        },
        {
          id: 'fieldOfView',
          type: 'slider',
          label: 'Field of View (FOV)',
          description: 'Horizontal viewing angle in degrees for first-person mode',
          min: 55,
          max: 85,
          step: 5,
          defaultValue: 65,
          unit: '°',
        },
        {
          id: 'cameraShake',
          type: 'toggle',
          label: 'Camera Shake & Sway',
          description: 'Procedural head bob while sprinting and impact tremor on damage',
          defaultValue: true,
        },
      ],
    },
    {
      group: 'Horror Experience & Scares',
      items: [
        {
          id: 'scareIntensity',
          type: 'segmented',
          label: 'Horror Director Intensity',
          description: 'Pacing and frequency of psychological atmosphere disturbances',
          options: [
            { value: 'off', label: 'Off' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ],
          defaultValue: 'medium',
        },
        {
          id: 'visualScares',
          type: 'toggle',
          label: 'Visual Scares & Anomalies',
          description: 'Corridor flickers, chromatic aberration, and stalker hallucinations',
          defaultValue: true,
        },
      ],
    },
    {
      group: 'Accessibility',
      items: [
        {
          id: 'reducedMotion',
          type: 'toggle',
          label: 'Reduced Motion',
          description: 'Suppress rapid camera transitions, screen shakes, and violent jolts',
          defaultValue: false,
        },
        {
          id: 'wayfinderGuide',
          type: 'toggle',
          label: 'Wayfinder Objective Compass',
          description: 'Provide on-demand breadcrumb direction towards nearest keycard',
          defaultValue: true,
        },
      ],
    },
    {
      group: 'Labyrinth Chamber',
      items: [
        {
          id: 'difficulty',
          type: 'segmented',
          label: 'Difficulty',
          description: 'Chamber dimensions, corridor density, and stalker threat tier',
          options: DIFFICULTY_ORDER.map((key) => ({
            value: key,
            label: MAZE_DIFFICULTIES[key].label,
          })),
          defaultValue: 'medium',
        },
      ],
    },
  ],
}

/**
 * Builds initial settings state from all registered items.
 */
export function getDefaultSettingsState() {
  const defaults = {}
  for (const categoryKey of Object.keys(SETTINGS_SCHEMA)) {
    const groups = SETTINGS_SCHEMA[categoryKey] || []
    for (const group of groups) {
      for (const item of group.items || []) {
        if ('defaultValue' in item) {
          defaults[item.id] = item.defaultValue
        }
      }
    }
  }
  defaults.keyBindings = { ...DEFAULT_KEY_BINDINGS }
  return defaults
}
