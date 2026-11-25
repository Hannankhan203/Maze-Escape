import Modal from '../common/Modal'
import Button from '../common/Button'
import HowToPlayContent from './HowToPlayContent.jsx'

export { HowToPlayContent }

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
      <HowToPlayContent />
    </Modal>
  )
}
