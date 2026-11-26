export default function HowToPlayContent() {
  return (
    <div className="lv-instructions-content lv-start-info-content">
      <section className="lv-start-info-section">
        <h3 className="lv-start-info-section__title">Movement &amp; Camera</h3>
        <p className="lv-start-info-section__body">
          Use <strong>W A S D</strong> or arrow keys to navigate corridors. Move your mouse or use touch look to scan your surroundings. Click the viewport to lock cursor control.
        </p>
      </section>

      <section className="lv-start-info-section">
        <h3 className="lv-start-info-section__title">Sprinting &amp; Stamina</h3>
        <p className="lv-start-info-section__body">
          Hold <strong>Shift</strong> to sprint through dangerous areas. Keep an eye on your stamina bar; exhaustion temporarily slows your movement.
        </p>
      </section>

      <section className="lv-start-info-section">
        <h3 className="lv-start-info-section__title">Enemy Evasion</h3>
        <p className="lv-start-info-section__body">
          Relentless hostile entities (Stalker, Hunter, Brute) roam the maze. Break line-of-sight around corners and sprint through corridors when pursued to evade detection.
        </p>
      </section>

      <section className="lv-start-info-section">
        <h3 className="lv-start-info-section__title">Environment &amp; Hazards</h3>
        <p className="lv-start-info-section__body">
          Beware of environmental hazards including steam pipes, electrical wires, ceiling collapses, and floor grates. Press <strong>F</strong> to interact with safe valves or disable hazards.
        </p>
      </section>

      <section className="lv-start-info-section">
        <h3 className="lv-start-info-section__title">Keycards &amp; Soul Shards</h3>
        <p className="lv-start-info-section__body">
          Collect all required resonance keycards to unlock the exit gate. Gather Soul Shards and power-up abilities (Health Capsules, Energy Cells, Warding Charms, etc.) to boost your score and survive.
        </p>
      </section>
    </div>
  )
}
