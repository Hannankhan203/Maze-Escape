import { useState, useMemo } from 'react'
import Button from '../common/Button.jsx'
import {
  SANDBOX_CATEGORIES,
  SANDBOX_CATEGORY_IDS,
  addManualPlacement,
  clearManualPlacements,
  validateSandboxConfig,
} from '../../game/sandbox/sandboxConfig.js'
import { generateMaze } from '../../game/generation/mazeGenerator.js'
import { CELL_TYPES } from '../../game/generation/mazeConfig.js'

export default function ManualGridEditorModal({
  sandboxConfig = null,
  onChangeConfig = null,
  onStartTestLevel = null,
  onBack = null,
}) {
  const [config, setConfig] = useState(() => sandboxConfig)
  const [history, setHistory] = useState([sandboxConfig])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [activeCategoryId, setActiveCategoryId] = useState(SANDBOX_CATEGORY_IDS.HAZARDS)
  const [selectedItemId, setSelectedItemId] = useState(null)
  const [previewSeed, setPreviewSeed] = useState(() => config.seed || 12345)
  const [zoomLevel, setZoomLevel] = useState(1)

  const activeCategoryMeta =
    SANDBOX_CATEGORIES.find((cat) => cat.id === activeCategoryId) || SANDBOX_CATEGORIES[0]

  // Generate preview maze with current config & seed
  const previewMaze = useMemo(() => {
    try {
      return generateMaze({
        seed: previewSeed,
        level: 1,
        sandboxConfig: config,
      })
    } catch {
      return null
    }
  }, [config, previewSeed])

  const validation = useMemo(() => validateSandboxConfig(config), [config])

  const commitConfig = (nextConfig) => {
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push(nextConfig)
    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
    setConfig(nextConfig)
    onChangeConfig?.(nextConfig, [])
  }

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1]
      setHistoryIndex(historyIndex - 1)
      setConfig(prev)
      onChangeConfig?.(prev, [])
    }
  }

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1]
      setHistoryIndex(historyIndex + 1)
      setConfig(next)
      onChangeConfig?.(next, [])
    }
  }

  const handleCellClick = (row, col) => {
    if (!selectedItemId) return
    const grid = previewMaze?.grid
    if (!grid || grid[row]?.[col] !== CELL_TYPES.PATH) return

    // Don't allow placing on start or exit
    if (
      (previewMaze.start.row === row && previewMaze.start.col === col) ||
      (previewMaze.exit.row === row && previewMaze.exit.col === col)
    ) {
      return
    }

    const result = addManualPlacement(config, activeCategoryId, selectedItemId, row, col)
    commitConfig(result.config)
  }

  const handleClearSelected = () => {
    if (!selectedItemId) return
    const result = clearManualPlacements(config, activeCategoryId, selectedItemId)
    commitConfig(result.config)
  }

  const handleClearAll = () => {
    let draft = JSON.parse(JSON.stringify(config))
    for (const cat of SANDBOX_CATEGORIES) {
      for (const item of cat.items) {
        if (draft.categories[cat.id]?.items[item.id]) {
          draft.categories[cat.id].items[item.id].manualPlacements = []
        }
      }
    }
    commitConfig(draft)
  }

  // Gather all manual placements for rendering
  const manualPlacementMap = useMemo(() => {
    const map = new Map() // "row,col" -> [{ categoryId, itemId }]
    for (const cat of SANDBOX_CATEGORIES) {
      const itemsMap = config.categories?.[cat.id]?.items || {}
      for (const [itemId, entry] of Object.entries(itemsMap)) {
        if (Array.isArray(entry.manualPlacements)) {
          for (const p of entry.manualPlacements) {
            const key = `${p.row},${p.col}`
            if (!map.has(key)) map.set(key, [])
            map.get(key).push({ categoryId: cat.id, itemId })
          }
        }
      }
    }
    return map
  }, [config])

  return (
    <div className="lv-sandbox-view lv-manual-editor" data-testid="manual-grid-editor-view">
      {/* Editor Header & Controls Bar */}
      <div className="lv-sandbox-section-bar">
        <div className="lv-sandbox-section-bar__copy">
          <h2 className="lv-sandbox-section-bar__title">Manual Grid Placement Editor</h2>
          <p className="lv-sandbox-section-bar__desc">
            Inspect maze topology and assign exact cell coordinates for entities. Seed: {previewSeed} ·{' '}
            Dimensions: {previewMaze ? `${previewMaze.rows}x${previewMaze.cols}` : '...'}
          </p>
        </div>
        <div className="lv-sandbox-section-bar__actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={historyIndex <= 0}
            onClick={handleUndo}
            data-testid="manual-editor-undo-btn"
          >
            Undo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={historyIndex >= history.length - 1}
            onClick={handleRedo}
            data-testid="manual-editor-redo-btn"
          >
            Redo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPreviewSeed(Math.floor(Math.random() * 900000) + 100000)}
            data-testid="manual-editor-regen-btn"
          >
            Regenerate Seed
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClearAll}
            data-testid="manual-editor-clear-all-btn"
          >
            Clear All Placements
          </Button>
        </div>
      </div>

      <div className="lv-manual-layout" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1rem' }}>
        {/* Left Sidebar: Category & Entity Palette */}
        <div
          className="lv-manual-sidebar"
          style={{
            background: 'rgba(12, 17, 26, 0.9)',
            border: '1px solid var(--color-border-stone)',
            borderRadius: '8px',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <h3 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-player-hover)' }}>
            Entity Palette
          </h3>

          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {SANDBOX_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveCategoryId(cat.id)
                  setSelectedItemId(null)
                }}
                style={{
                  padding: '4px 8px',
                  background: activeCategoryId === cat.id ? 'var(--color-bg-elevated)' : 'transparent',
                  border: '1px solid var(--color-border-stone)',
                  color: activeCategoryId === cat.id ? 'var(--color-player)' : 'var(--color-text-secondary)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {cat.shortLabel}
              </button>
            ))}
          </div>

          <div
            className="lv-manual-palette-list"
            style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '360px', overflowY: 'auto' }}
          >
            {activeCategoryMeta.items.map((item) => {
              const entry = config.categories?.[activeCategoryId]?.items?.[item.id] || {}
              const manualCount = Array.isArray(entry.manualPlacements)
                ? entry.manualPlacements.length
                : 0
              const isSelected = selectedItemId === item.id

              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItemId(item.id)}
                  style={{
                    padding: '8px',
                    background: isSelected ? 'rgba(245, 158, 11, 0.15)' : 'var(--color-bg-chamber)',
                    border: `1px solid ${isSelected ? 'var(--color-player)' : 'var(--color-border-stone)'}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  data-testid={`palette-item-${activeCategoryId}-${item.id}`}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {item.label}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                      Config Qty: {entry.quantity !== null ? entry.quantity : 'Auto'} · Placed: {manualCount}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {selectedItemId ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleClearSelected}
                data-testid="manual-clear-selected-btn"
                style={{ width: '100%' }}
              >
                Clear Placements for Selected
              </Button>
            </div>
          ) : null}

          {/* Validation Panel */}
          <div
            className="lv-manual-validation-panel"
            style={{
              marginTop: 'auto',
              padding: '8px',
              background: validation.valid ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)',
              border: `1px solid ${validation.valid ? 'rgba(16, 185, 129, 0.4)' : 'var(--color-danger)'}`,
              borderRadius: '6px',
              fontSize: '11px',
            }}
          >
            <div style={{ fontWeight: 700, color: validation.valid ? '#34d399' : '#f87171', marginBottom: '4px' }}>
              {validation.valid ? 'STATUS: VALID' : 'STATUS: BLOCKED'}
            </div>
            {validation.errors.map((err, i) => (
              <div key={i} style={{ color: '#fca5a5' }}>• {err}</div>
            ))}
            {validation.warnings.map((warn, i) => (
              <div key={i} style={{ color: '#fde047' }}>• {warn}</div>
            ))}
          </div>
        </div>

        {/* Right Main: Maze Grid Viewport */}
        <div
          className="lv-manual-viewport"
          style={{
            background: 'rgba(12, 17, 26, 0.95)',
            border: '1px solid var(--color-border-stone)',
            borderRadius: '8px',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
              {selectedItemId
                ? `Click walkable cells to place/remove: ${selectedItemId}`
                : 'Select an entity from the palette to begin manual placement'}
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>Zoom:</span>
              <Button size="sm" variant="secondary" onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.2))}>
                -
              </Button>
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>{Math.round(zoomLevel * 100)}%</span>
              <Button size="sm" variant="secondary" onClick={() => setZoomLevel((z) => Math.min(2.0, z + 0.2))}>
                +
              </Button>
            </div>
          </div>

          <div
            className="lv-manual-grid-scroll"
            style={{
              flex: 1,
              overflow: 'auto',
              maxHeight: '520px',
              background: '#070a0f',
              border: '1px solid var(--color-border-stone)',
              borderRadius: '6px',
              padding: '1rem',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {previewMaze ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${previewMaze.cols}, ${Math.round(22 * zoomLevel)}px)`,
                  gap: '1px',
                  backgroundColor: '#1e293b',
                  padding: '4px',
                  borderRadius: '4px',
                }}
                data-testid="manual-maze-grid-canvas"
              >
                {previewMaze.grid.map((rowArr, r) =>
                  rowArr.map((cell, c) => {
                    const isStart = previewMaze.start.row === r && previewMaze.start.col === c
                    const isExit = previewMaze.exit.row === r && previewMaze.exit.col === c
                    const cellKey = `${r},${c}`
                    const placedList = manualPlacementMap.get(cellKey) || []
                    const isWall = cell === CELL_TYPES.WALL

                    let bg = isWall ? '#0f172a' : '#334155'
                    if (isStart) bg = '#3b82f6'
                    else if (isExit) bg = '#10b981'
                    else if (placedList.length > 0) bg = '#f59e0b'

                    return (
                      <div
                        key={cellKey}
                        onClick={() => handleCellClick(r, c)}
                        title={`Row ${r}, Col ${c} ${isStart ? '[START]' : isExit ? '[EXIT]' : ''} ${placedList.map((p) => p.itemId).join(', ')}`}
                        style={{
                          width: `${Math.round(22 * zoomLevel)}px`,
                          height: `${Math.round(22 * zoomLevel)}px`,
                          backgroundColor: bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center.ipynb',
                          fontSize: '9px',
                          color: '#fff',
                          fontWeight: 700,
                          cursor: isWall || isStart || isExit ? 'default' : 'pointer',
                          border: placedList.length > 0 ? '1px solid #fff' : 'none',
                        }}
                        data-cell-row={r}
                        data-cell-col={c}
                      >
                        {isStart ? 'S' : isExit ? 'E' : placedList.length > 0 ? placedList.length : ''}
                      </div>
                    )
                  })
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--color-text-muted)' }}>Generating preview...</div>
            )}
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px' }}>
            {typeof onBack === 'function' ? (
              <Button variant="secondary" size="md" onClick={onBack} data-testid="manual-editor-back-btn">
                Back to Sandbox Settings
              </Button>
            ) : (
              <div />
            )}
            <Button
              variant="primary"
              size="lg"
              disabled={!validation.valid}
              onClick={() => onStartTestLevel?.(config)}
              data-testid="manual-editor-start-test-btn"
            >
              Start Test Level with Manual Placements
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
