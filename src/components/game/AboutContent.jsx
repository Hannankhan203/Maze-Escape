export default function AboutContent() {
  return (
    <div className="lv-about-content lv-start-info-content">
      <section className="lv-start-info-section">
        <h3 className="lv-start-info-section__title">The Facility</h3>
        <p className="lv-start-info-section__body">
          Trapped deep within an abandoned underground labyrinth, you must navigate shifting corridors, evade relentless hostile entities, and escape before you are claimed by the dark.
        </p>
      </section>

      <section className="lv-start-info-section">
        <h3 className="lv-start-info-section__title">Technology &amp; Audio</h3>
        <p className="lv-start-info-section__body">
          Built using React, Vite, and Three.js for real-time 3D rendering. Features procedural Web Audio synthesis, dynamic horror pacing, and responsive spatial soundscapes.
        </p>
      </section>
    </div>
  )
}
