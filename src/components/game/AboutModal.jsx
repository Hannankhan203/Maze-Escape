import Modal from '../common/Modal'
import Button from '../common/Button'
import AboutContent from './AboutContent.jsx'

export { AboutContent }

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
      <AboutContent />
    </Modal>
  )
}
