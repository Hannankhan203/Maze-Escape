import Modal from '../common/Modal'
import Button from '../common/Button'

export default function AboutModal({ isOpen, onClose }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="About / Credits"
      subtitle="Maze Escape — Abandoned Underground Facility"
      size="md"
      className="lv-modal--about"
      footer={
        <Button variant="primary" onClick={onClose} data-testid="about-back-btn">
          Back
        </Button>
      }
    >
      <div className="lv-about-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--color-text-primary)' }}>
        <section>
          <h3 style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--color-accent)' }}>The Facility</h3>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.4', color: 'var(--color-text-secondary)' }}>
            Trapped deep within an abandoned underground labyrinth, you must navigate shifting corridors, evade relentless hostile entities, and escape before you are claimed by the dark.
          </p>
        </section>

        <section>
          <h3 style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--color-accent)' }}>Technology & Audio</h3>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.4', color: 'var(--color-text-secondary)' }}>
            Built using React, Vite, and Three.js for real-time 3D rendering. Features procedural Web Audio synthesis, dynamic horror pacing, and responsive spatial soundscapes.
          </p>
        </section>
      </div>
    </Modal>
  )
}
