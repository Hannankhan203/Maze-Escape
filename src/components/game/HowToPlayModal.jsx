import Modal from '../common/Modal'
import Button from '../common/Button'

export default function HowToPlayModal({ isOpen, onClose }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="How to Play"
      subtitle="Surviving the Abandoned Underground Facility"
      size="lg"
      className="lv-modal--how-to-play"
      footer={
        <Button variant="primary" onClick={onClose} data-testid="how-to-play-back-btn">
          Back
        </Button>
      }
    >
      <div className="lv-instructions-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--color-text-primary)' }}>
        <section>
          <h3 style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--color-accent)' }}>Movement & Camera</h3>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.4', color: 'var(--color-text-secondary)' }}>
            Use <strong style={{ color: 'var(--color-text-primary)' }}>W A S D</strong> or arrow keys to navigate corridors. Move your mouse or use touch look to scan your surroundings. Click the viewport to lock cursor control.
          </p>
        </section>

        <section>
          <h3 style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--color-accent)' }}>Sprinting & Stamina</h3>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.4', color: 'var(--color-text-secondary)' }}>
            Hold <strong style={{ color: 'var(--color-text-primary)' }}>Shift</strong> to sprint through dangerous areas. Keep an eye on your stamina bar; exhaustion temporarily slows your movement.
          </p>
        </section>

        <section>
          <h3 style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--color-accent)' }}>Hiding & Enemy Evasion</h3>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.4', color: 'var(--color-text-secondary)' }}>
            Relentless hostile entities (Stalker, Hunter, Brute) roam the maze. Hide in lockers, alcoves, or shadowed zones when pursued to break line-of-sight and avoid detection.
          </p>
        </section>

        <section>
          <h3 style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--color-accent)' }}>Environment & Hazards</h3>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.4', color: 'var(--color-text-secondary)' }}>
            Beware of environmental hazards including steam pipes, electrical wires, ceiling collapses, and floor grates. Press <strong style={{ color: 'var(--color-text-primary)' }}>F</strong> to interact with safe valves or disable hazards.
          </p>
        </section>

        <section>
          <h3 style={{ fontWeight: 600, marginBottom: '0.35rem', color: 'var(--color-accent)' }}>Keycards & Soul Shards</h3>
          <p style={{ fontSize: '0.875rem', lineHeight: '1.4', color: 'var(--color-text-secondary)' }}>
            Collect all required resonance keycards to unlock the exit gate. Gather Soul Shards and power-up abilities (Health Capsules, Energy Cells, Warding Charms, etc.) to boost your score and survive.
          </p>
        </section>
      </div>
    </Modal>
  )
}
