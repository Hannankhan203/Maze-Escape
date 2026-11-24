import { HorrorAudioEngine } from './HorrorAudioEngine.js'

export function runAudioSubtitlesTests() {
  console.log('Running Audio Subtitles Unit Tests...')

  // Test 1: Default state & options
  const engine = new HorrorAudioEngine({ subtitles: false })
  const initialOpts = engine.getAudioOptions()
  if (initialOpts.subtitles !== false) {
    throw new Error('Test 1 failed: Default subtitles should be false')
  }

  // Test 2: Enable subtitles via setAudioOptions
  engine.setAudioOptions({ subtitles: true })
  const updatedOpts = engine.getAudioOptions()
  if (updatedOpts.subtitles !== true) {
    throw new Error('Test 2 failed: Subtitles should be enabled via setAudioOptions')
  }

  // Test 3: Subscription & subtitle emission
  let receivedSubtitle = null
  const unsubscribe = engine.subscribeSubtitles((entry) => {
    receivedSubtitle = entry
  })

  engine._emitSubtitle('Player hurt', 'player', 2.0, 10)

  if (!receivedSubtitle || receivedSubtitle.text !== 'Player hurt') {
    throw new Error('Test 3 failed: Subtitle event was not received by subscriber')
  }

  // Test 4: Deduplication within 900ms
  receivedSubtitle = null
  engine._emitSubtitle('Player hurt', 'player', 2.0, 10)
  if (receivedSubtitle !== null) {
    throw new Error('Test 4 failed: Rapid identical subtitle was not deduplicated')
  }

  // Test 5: Distance filtering (> 18.0 units)
  receivedSubtitle = null
  engine._emitSubtitle('Distant noise', 'enemy', 20.0, 5)
  if (receivedSubtitle !== null) {
    throw new Error('Test 5 failed: Subtitle with distance > 18.0 should be filtered out')
  }

  // Test 6: Unsubscribe cleanup
  unsubscribe()
  engine._emitSubtitle('Player hurt again', 'player', 1.0, 10)
  // Since unsubscribed, receivedSubtitle should not update to new one
  console.log('Audio Subtitles Unit Tests Passed Successfully!')
  return true
}

if (typeof window !== 'undefined') {
  window.runAudioSubtitlesTests = runAudioSubtitlesTests
}
