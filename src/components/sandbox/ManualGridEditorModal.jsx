import { useMemo, useState } from 'react'
import Button from '../common/Button.jsx'
import {
  SANDBOX_CATEGORIES,
  SANDBOX_CATEGORY_IDS,
  addManualPlacement,
  clearManualPlacements,
  createDefaultSandboxConfig,
  isItemQuantityEligible,
  removeManualPlacement,
  setSandboxSeed,
  validateSandboxConfig,
} from '../../game/sandbox/sandboxConfig.js'
import { generateMaze } from '../../game/generation/mazeGenerator.js'
import { CELL_TYPES } from '../../game/generation/mazeConfig.js'

const MAX_UNDO_HISTORY = 50
const DEFAULT_PREVIEW_SEED = 123456

function createRandomPreviewSeed() {
  return Math.floor(Math.random() * 900000) + 100000
}

export default function ManualGridEditorModal({
  sandboxConfig = null,
  onChangeConfig = null,
  onStartTestLevel = null,
  onBack = null,
  initialFocusCoord = null,
}) {
  const [config, setConfig] = useState(
    () => sandboxConfig || createDefaultSandboxConfig()
  )
  const [history, setHistory] = useState(() => [
    sandboxConfig || createDefaultSandboxConfig(),
  ])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [activeCategoryId, setActiveCategoryId] = useState(() => {
    if (
      initialFocusCoord?.categoryId &&
      SANDBOX_CATEGORIES.some((c) => c.id === initialFocusCoord.categoryId)
    ) {
      return initialFocusCoord.categoryId
    }
    return SANDBOX_CATEGORY_IDS.HAZARDS
  })
  const [selectedItemId, setSelectedItemId] = useState(
    () => initialFocusCoord?.itemId || null
  )
  const [focusedCell, setFocusedCell] = useState(() =>
    Number.isInteger(initialFocusCoord?.row) &&
    Number.isInteger(initialFocusCoord?.col)
      ? { row: initialFocusCoord.row, col: initialFocusCoord.col }
      : null
  )
  const [previewSeed, setPreviewSeed] = useState(
    () => sandboxConfig?.seed || DEFAULT_PREVIEW_SEED
  )
  const [zoomLevel, setZoomLevel] = useState(1)
  const [feedbackNotice, setFeedbackNotice] = useState(() =>
    Number.isInteger(initialFocusCoord?.row) &&
    Number.isInteger(initialFocusCoord?.col)
      ? {
          type: 'info',
          message: `Focused coordinate (${initialFocusCoord.row}, ${initialFocusCoord.col})${
            initialFocusCoord.itemId ? ` · ${initialFocusCoord.itemId}` : ''
          }`,
        }
      : null
  )

  const activeCategoryMeta =
    SANDBOX_CATEGORIES.find((cat) => cat.id === activeCategoryId) ||
    SANDBOX_CATEGORIES[0]

  const effectivePreviewSeed = config?.seed || previewSeed

  // Generate preview maze with current config & seed
  const previewMaze = useMemo(() => {
    try {
      return generateMaze({
        seed: effectivePreviewSeed,
        level: 1,
        sandboxConfig: config,
      })
    } catch {
      return null
    }
  }, [config, effectivePreviewSeed])

  const validation = useMemo(() => validateSandboxConfig(config), [config])

  const commitConfig = (nextConfig, notices = []) => {
    const nextSlice = history.slice(0, historyIndex + 1)
    nextSlice.push(nextConfig)
    const bounded =
      nextSlice.length > MAX_UNDO_HISTORY
        ? nextSlice.slice(nextSlice.length - MAX_UNDO_HISTORY)
        : nextSlice
    setHistory(bounded)
    setHistoryIndex(bounded.length - 1)
    setConfig(nextConfig)
    onChangeConfig?.(nextConfig, notices)
  }

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1]
      setHistoryIndex(historyIndex - 1)
      setConfig(prev)
      setFeedbackNotice({ type: 'info', message: 'Reverted last placement change.' })
      onChangeConfig?.(prev, [])
    }
  }

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1]
      setHistoryIndex(historyIndex + 1)
      setConfig(next)
      setFeedbackNotice({ type: 'info', message: 'Reapplied placement change.' })
      onChangeConfig?.(next, [])
    }
  }

  const handleSeedCommit = (nextSeedValue) => {
    const result = setSandboxSeed(config, nextSeedValue)
    if (result.config?.seed) {
      setPreviewSeed(result.config.seed)
    }
    commitConfig(result.config, result.notices)
    setFeedbackNotice({
      type: 'info',
      message: result.config.seed
        ? `Locked test seed to ${result.config.seed}`
        : 'Cleared locked seed (auto random seed per run)',
    })
  }

  const handleRegenerateSeed = () => {
    const nextSeed = createRandomPreviewSeed()
    setPreviewSeed(nextSeed)
    if (config.seed !== null && config.seed !== undefined) {
      handleSeedCommit(nextSeed)
    } else {
      setFeedbackNotice({
        type: 'info',
        message: `Preview maze regenerated with seed ${nextSeed}`,
      })
    }
  }

  const handleCellClick = (row, col) => {
    setFocusedCell({ row, col })
    const grid = previewMaze?.grid
    if (!grid || grid[row]?.[col] !== CELL_TYPES.PATH) {
      setFeedbackNotice({
        type: 'warning',
        message: `Cell (${row}, ${col}) is a wall — cannot place entities here.`,
      })
      return
    }

    if (
      (previewMaze.start.row === row && previewMaze.start.col === col) ||
      (previewMaze.exit.row === row && previewMaze.exit.col === col)
    ) {
      setFeedbackNotice({
        type: 'warning',
        message: `Cell (${row}, ${col}) is the ${
          previewMaze.start.row === row && previewMaze.start.col === col
            ? 'Start'
            : 'Exit'
        } cell — entities cannot spawn here.`,
      })
      return
    }

    if (!selectedItemId) {
      setFeedbackNotice({
        type: 'info',
        message: `Inspecting cell (${row}, ${col}). Select an entity from the palette to place one.`,
      })
      return
    }

    if (!isItemQuantityEligible(activeCategoryId, selectedItemId)) {
      setFeedbackNotice({
        type: 'warning',
        message: `${selectedItemId} is an architectural layer and does not support manual coordinate placement.`,
      })
      return
    }

    if (activeCategoryId === SANDBOX_CATEGORY_IDS.ENEMIES) {
      const distToStart =
        Math.abs(row - previewMaze.start.row) +
        Math.abs(col - previewMaze.start.col)
      if (distToStart < 3) {
        setFeedbackNotice({
          type: 'error',
          message: `Cannot place enemy at (${row}, ${col}): violates minimum start safety distance (${distToStart} < 3 tiles).`,
        })
        return
      }
    }

    const result = addManualPlacement(
      config,
      activeCategoryId,
      selectedItemId,
      row,
      col
    )
    commitConfig(result.config, result.notices)
    setFeedbackNotice({
      type: result.notices?.length ? 'warning' : 'success',
      message:
        result.notices?.[0] ||
        `Placed ${selectedItemId} at (${row}, ${col}).`,
    })
  }

  const handleRemoveSinglePlacement = (categoryId, itemId, index) => {
    const result = removeManualPlacement(config, categoryId, itemId, index)
    commitConfig(result.config, result.notices)
    setFeedbackNotice({
      type: 'info',
      message: `Removed manual ${itemId} placement.`,
    })
  }

  const handleClearSelected = () => {
    if (!selectedItemId) return
    const result = clearManualPlacements(config, activeCategoryId, selectedItemId)
    commitConfig(result.config, result.notices)
    setFeedbackNotice({
      type: 'info',
      message: `Cleared all manual placements for ${selectedItemId}.`,
    })
  }

  const handleClearAll = () => {
    const draft = JSON.parse(JSON.stringify(config))
    for (const cat of SANDBOX_CATEGORIES) {
      for (const item of cat.items) {
        if (draft.categories[cat.id]?.items[item.id]) {
          draft.categories[cat.id].items[item.id].manualPlacements = []
        }
      }
    }
    commitConfig(draft, ['Cleared all manual placements across categories.'])
    setFeedbackNotice({
      type: 'info',
      message: 'Cleared all manual placements across all categories.',
    })
  }

  // Gather all manual placements for rendering & cell inspector
  const manualPlacementMap = useMemo(() => {
    const map = new Map() // "row,col" -> [{ categoryId, itemId, index, id }]
    for (const cat of SANDBOX_CATEGORIES) {
      const itemsMap = config.categories?.[cat.id]?.items || {}
      for (const [itemId, entry] of Object.entries(itemsMap)) {
        if (Array.isArray(entry.manualPlacements)) {
          entry.manualPlacements.forEach((p, index) => {
            const key = `${p.row},${p.col}`
            if (!map.has(key)) map.set(key, [])
            map.get(key).push({
              categoryId: cat.id,
              itemId,
              index,
              id: p.id || null,
            })
          })
        }
      }
    }
    return map
  }, [config])

  const focusedCellPlacements = focusedCell
    ? manualPlacementMap.get(`${focusedCell.row},${focusedCell.col}`) || []
    : []

  const focusedCellTypeLabel = (() => {
    if (!focusedCell || !previewMaze?.grid) return null
    const { row, col } = focusedCell
    if (previewMaze.start.row === row && previewMaze.start.col === col) {
      return 'Start Elevator'
    }
    if (previewMaze.exit.row === row && previewMaze.exit.col === col) {
      return 'Exit Gate'
    }
    return previewMaze.grid[row]?.[col] === CELL_TYPES.PATH ? 'Walkable Corridor' : 'Solid Wall'
  })()

  return (
    <div className="lv-sandbox-view lv-manual-editor" data-testid="manual-grid-editor-view">
      {/* Editor Header & Controls Bar */}
      <div className="lv-sandbox-section-bar">
        <div className="lv-sandbox-section-bar__copy">
          <h2 className="lv-sandbox-section-bar__title">Manual Grid Placement Editor</h2>
          <p className="lv-sandbox-section-bar__desc">
            Inspect maze topology and assign exact cell coordinates for entities. Seed:{' '}
            {effectivePreviewSeed}
            {config?.seed ? ' (Locked)' : ' (Preview)'} · Dimensions:{' '}
            {previewMaze ? `${previewMaze.rows}x${previewMaze.cols}` : '...'}
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
            onClick={handleRegenerateSeed}
            data-testid="manual-editor-regen-btn"
          >
            Regenerate Seed
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              handleSeedCommit(
                config?.seed ? null : effectivePreviewSeed
              )
            }
            data-testid="manual-editor-lock-seed-btn"
          >
            {config?.seed ? 'Unlock Seed' : 'Lock Seed'}
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

      <div
        className="lv-manual-layout"
        style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1rem' }}
      >
        {/* Left Sidebar: Category & Entity Palette + Cell Inspector */}
        <div
          className="lv-manual-sidebar"
          style={{
            background: 'rgba(12, 17, 26, 0.9)',
            border: '1px solid var(--color-border-stone)',
            borderRadius: '8px',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
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
                  background:
                    activeCategoryId === cat.id
                      ? 'var(--color-bg-elevated)'
                      : 'transparent',
                  border: '1px solid var(--color-border-stone)',
                  color:
                    activeCategoryId === cat.id
                      ? 'var(--color-player)'
                      : 'var(--color-text-secondary)',
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
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              maxHeight: '280px',
              overflowY: 'auto',
            }}
          >
            {activeCategoryMeta.items.map((item) => {
              const entry = config.categories?.[activeCategoryId]?.items?.[item.id] || {}
              const manualCount = Array.isArray(entry.manualPlacements)
                ? entry.manualPlacements.length
                : 0
              const isSelected = selectedItemId === item.id
              const eligible = isItemQuantityEligible(activeCategoryId, item.id)

              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItemId(item.id)}
                  style={{
                    padding: '8px',
                    background: isSelected
                      ? 'rgba(245, 158, 11, 0.15)'
                      : 'var(--color-bg-chamber)',
                    border: `1px solid ${
                      isSelected ? 'var(--color-player)' : 'var(--color-border-stone)'
                    }`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    opacity: eligible ? 1 : 0.65,
                  }}
                  data-testid={`palette-item-${activeCategoryId}-${item.id}`}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {item.label}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                      {eligible
                        ? `Config Qty: ${entry.quantity !== null && entry.quantity !== undefined ? entry.quantity : 'Auto'} · Placed: ${manualCount}`
                        : 'Architectural layer'}
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

          {focusedCell ? (
            <div
              className="lv-manual-cell-inspector"
              data-testid="manual-cell-inspector"
              style={{
                padding: '8px',
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid var(--color-border-stone)',
                borderRadius: '6px',
                fontSize: '11px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ fontWeight: 700, color: '#93c5fd' }}>
                Cell ({focusedCell.row}, {focusedCell.col}) · {focusedCellTypeLabel}
              </div>
              {focusedCellPlacements.length === 0 ? (
                <div style={{ color: 'var(--color-text-muted)' }}>
                  No manual placements at this coordinate.
                </div>
              ) : (
                focusedCellPlacements.map((p) => (
                  <div
                    key={`${p.categoryId}-${p.itemId}-${p.index}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '6px',
                      background: 'rgba(30, 41, 59, 0.7)',
                      padding: '4px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    <span style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                      {p.itemId} ({p.categoryId})
                    </span>
                    <button
                      type="button"
                      data-testid={`manual-remove-${p.categoryId}-${p.itemId}-${p.index}`}
                      onClick={() =>
                        handleRemoveSinglePlacement(p.categoryId, p.itemId, p.index)
                      }
                      style={{
                        background: 'rgba(239, 68, 68, 0.16)',
                        border: '1px solid rgba(248, 113, 113, 0.45)',
                        color: '#fca5a5',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontSize: '10px',
                        cursor: 'pointer',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {/* Validation Panel */}
          <div
            className="lv-manual-validation-panel"
            style={{
              marginTop: 'auto',
              padding: '8px',
              background: validation.valid
                ? 'rgba(16, 185, 129, 0.1)'
                : 'rgba(244, 63, 94, 0.1)',
              border: `1px solid ${
                validation.valid ? 'rgba(16, 185, 129, 0.4)' : 'var(--color-danger)'
              }`,
              borderRadius: '6px',
              fontSize: '11px',
            }}
          >
            <div
              style={{
                fontWeight: 700,
                color: validation.valid ? '#34d399' : '#f87171',
                marginBottom: '4px',
              }}
            >
              {validation.valid ? 'STATUS: VALID' : 'STATUS: BLOCKED'}
            </div>
            {validation.errors.map((err, i) => (
              <div key={i} style={{ color: '#fca5a5' }}>
                • {err}
              </div>
            ))}
            {validation.warnings.map((warn, i) => (
              <div key={i} style={{ color: '#fde047' }}>
                • {warn}
              </div>
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
            gap: '0.75rem',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {selectedItemId
                ? `Click walkable cells to place: ${selectedItemId}`
                : 'Select an entity from the palette to begin manual placement'}
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>Zoom:</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setZoomLevel((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))}
              >
                -
              </Button>
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                {Math.round(zoomLevel * 100)}%
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setZoomLevel((z) => Math.min(2.0, +(z + 0.2).toFixed(1)))}
              >
                +
              </Button>
            </div>
          </div>

          {feedbackNotice ? (
            <div
              role="status"
              data-testid="manual-editor-feedback"
              style={{
                padding: '6px 10px',
                borderRadius: '5px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                background:
                  feedbackNotice.type === 'error'
                    ? 'rgba(239, 68, 68, 0.14)'
                    : feedbackNotice.type === 'warning'
                      ? 'rgba(245, 158, 11, 0.14)'
                      : feedbackNotice.type === 'success'
                        ? 'rgba(16, 185, 129, 0.14)'
                        : 'rgba(56, 189, 248, 0.12)',
                border:
                  feedbackNotice.type === 'error'
                    ? '1px solid rgba(248, 113, 113, 0.45)'
                    : feedbackNotice.type === 'warning'
                      ? '1px solid rgba(245, 158, 11, 0.45)'
                      : feedbackNotice.type === 'success'
                        ? '1px solid rgba(52, 211, 153, 0.45)'
                        : '1px solid rgba(56, 189, 248, 0.4)',
                color: '#f8fafc',
              }}
            >
              {feedbackNotice.message}
            </div>
          ) : null}

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
                  gridTemplateColumns: `repeat(${previewMaze.cols}, ${Math.round(
                    22 * zoomLevel
                  )}px)`,
                  gap: '1px',
                  backgroundColor: '#1e293b',
                  padding: '4px',
                  borderRadius: '4px',
                }}
                data-testid="manual-maze-grid-canvas"
              >
                {previewMaze.grid.map((rowArr, r) =>
                  rowArr.map((cell, c) => {
                    const isStart =
                      previewMaze.start.row === r && previewMaze.start.col === c
                    const isExit =
                      previewMaze.exit.row === r && previewMaze.exit.col === c
                    const cellKey = `${r},${c}`
                    const placedList = manualPlacementMap.get(cellKey) || []
                    const isWall = cell === CELL_TYPES.WALL
                    const isFocused =
                      focusedCell && focusedCell.row === r && focusedCell.col === c
                    const isEnemyBufferRestricted =
                      activeCategoryId === SANDBOX_CATEGORY_IDS.ENEMIES &&
                      !isWall &&
                      !isStart &&
                      Math.abs(r - previewMaze.start.row) +
                        Math.abs(c - previewMaze.start.col) <
                        3

                    let bg = isWall ? '#0f172a' : '#334155'
                    if (isStart) bg = '#3b82f6'
                    else if (isExit) bg = '#10b981'
                    else if (placedList.length > 0) bg = '#f59e0b'
                    else if (isEnemyBufferRestricted) bg = 'rgba(185, 28, 28, 0.45)'

                    return (
                      <div
                        key={cellKey}
                        onClick={() => handleCellClick(r, c)}
                        title={`Row ${r}, Col ${c}${isStart ? ' [START]' : isExit ? ' [EXIT]' : isEnemyBufferRestricted ? ' [ENEMY SAFETY BUFFER < 3]' : ''}${placedList.length ? ` · ${placedList.map((p) => p.itemId).join(', ')}` : ''}`}
                        style={{
                          width: `${Math.round(22 * zoomLevel)}px`,
                          height: `${Math.round(22 * zoomLevel)}px`,
                          backgroundColor: bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '9px',
                          color: '#fff',
                          fontWeight: 700,
                          cursor: isWall || isStart || isExit ? 'default' : 'pointer',
                          border: isFocused
                            ? '2px solid #38bdf8'
                            : placedList.length > 0
                              ? '1px solid #fff'
                              : 'none',
                          boxSizing: 'border-box',
                        }}
                        data-cell-row={r}
                        data-cell-col={c}
                        data-focused={isFocused ? 'true' : undefined}
                      >
                        {isStart
                          ? 'S'
                          : isExit
                            ? 'E'
                            : placedList.length > 0
                              ? placedList.length
                              : ''}
                      </div>
                    )
                  })
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--color-text-muted)' }}>
                Generating preview...
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: '8px',
            }}
          >
            {typeof onBack === 'function' ? (
              <Button
                variant="secondary"
                size="md"
                onClick={onBack}
                data-testid="manual-editor-back-btn"
              >
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
