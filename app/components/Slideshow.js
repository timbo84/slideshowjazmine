'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import styles from './Slideshow.module.css'

const SLIDE_INTERVAL_MS = 4000
const TRANSITION_COUNT = 7
const KB_COUNT = 6

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function songName(url) {
  try {
    return decodeURIComponent(url.split('/').pop().split('?')[0])
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]/g, ' ')
  } catch { return '' }
}

function parseYear(url) {
  try {
    const filename = decodeURIComponent(url.split('/').pop().split('?')[0])
    if (/^dsc/i.test(filename)) return '2009'
    const m = filename.match(/(19\d{2}|20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/)
    return m ? m[1] : null
  } catch { return null }
}

function parseDate(url) {
  try {
    const filename = decodeURIComponent(url.split('/').pop().split('?')[0])
    // DSC files don't have dates in the name — label them with their known era
    if (/^dsc/i.test(filename)) return '2009 – 2010'
    const m = filename.match(/(19\d{2}|20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/)
    if (!m) return null
    const date = new Date(+m[1], +m[2] - 1, +m[3])
    if (date.getMonth() !== +m[2] - 1) return null
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return null }
}

const RESUME_KEY = 'gradparty_resume_idx'

export default function Slideshow({ images, songs = [], configError }) {
  const [started, setStarted] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [savedIdx, setSavedIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [looping, setLooping] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [slideKey, setSlideKey] = useState(0)
  const [ghost, setGhost] = useState(null)
  const [songIndex, setSongIndex] = useState(0)
  const [playlist, setPlaylist] = useState([])
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubYear, setScrubYear] = useState(null)

  const containerRef = useRef(null)
  const hideTimer = useRef(null)
  const audioRef = useRef(null)
  const scrubberRef = useRef(null)
  const wakeLockRef = useRef(null)
  const transitionRef = useRef(0)

  // Year tick marks for the timeline scrubber
  const yearMarkers = useMemo(() => {
    const markers = []
    let lastYear = null
    let lastLabelPct = -Infinity
    images.forEach((url, idx) => {
      const year = parseYear(url)
      if (year && year !== lastYear) {
        const pct = (idx / Math.max(images.length - 1, 1)) * 100
        const showLabel = pct - lastLabelPct >= 5
        if (showLabel) lastLabelPct = pct
        markers.push({ year, idx, pct, showLabel })
        lastYear = year
      }
    })
    return markers
  }, [images])
  const kbRef = useRef(0)
  // Refs so navigate callback doesn't need state as deps
  const activeIdxRef = useRef(0)
  const loopingRef = useRef(true)

  useEffect(() => { loopingRef.current = looping }, [looping])
  useEffect(() => { if (songs.length > 0) setPlaylist(shuffle(songs)) }, [songs])

  // Keep screen awake while slideshow is playing (same as video players)
  useEffect(() => {
    if (!started || !playing) {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
      return
    }
    navigator.wakeLock?.request('screen')
      .then(lock => { wakeLockRef.current = lock })
      .catch(() => {})
  }, [started, playing])

  // Re-acquire after phone screen wakes back up (lock releases on page hide)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && started && playing) {
        navigator.wakeLock?.request('screen')
          .then(lock => { wakeLockRef.current = lock })
          .catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [started, playing])

  // Load saved position on mount
  useEffect(() => {
    const saved = parseInt(localStorage.getItem(RESUME_KEY) || '0', 10)
    if (saved > 0 && saved < images.length) setSavedIdx(saved)
  }, [images.length])

  // Save position while slideshow is playing
  useEffect(() => {
    if (started) localStorage.setItem(RESUME_KEY, activeIdx)
  }, [activeIdx, started])

  const navigate = useCallback((dir) => {
    const cur = activeIdxRef.current
    let next = cur + dir
    if (next >= images.length) next = loopingRef.current ? 0 : cur
    if (next < 0) next = loopingRef.current ? images.length - 1 : cur
    if (next === cur) return

    let t
    do { t = Math.floor(Math.random() * TRANSITION_COUNT) } while (t === transitionRef.current)
    transitionRef.current = t

    let kb
    do { kb = Math.floor(Math.random() * KB_COUNT) } while (kb === kbRef.current)
    kbRef.current = kb

    setGhost({ src: images[cur], key: Date.now() })
    activeIdxRef.current = next
    setActiveIdx(next)
    setSlideKey(k => k + 1)
  }, [images])

  // Auto-advance
  useEffect(() => {
    if (!started || !playing || images.length === 0) return
    const id = setInterval(() => navigate(1), SLIDE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [started, playing, navigate, images.length])

  // Start audio on launch
  useEffect(() => {
    if (!started || playlist.length === 0) return
    audioRef.current?.play().catch(() => {})
  }, [started, playlist])

  // Sync music with play/pause
  useEffect(() => {
    if (!started || !audioRef.current) return
    if (playing) audioRef.current.play().catch(() => {})
    else audioRef.current.pause()
  }, [playing, started])

  // Advance to next song
  const handleSongEnd = () => setSongIndex(prev => (prev + 1) % playlist.length)

  useEffect(() => {
    if (!started || playlist.length === 0 || !audioRef.current) return
    audioRef.current.load()
    audioRef.current.play().catch(() => {})
  }, [songIndex, started, playlist])

  // Keyboard shortcuts
  useEffect(() => {
    if (!started) return
    const handler = (e) => {
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': navigate(1); break
        case 'ArrowLeft':  case 'ArrowUp':   navigate(-1); break
        case ' ': e.preventDefault(); setPlaying(p => !p); break
        case 'l': case 'L': setLooping(l => !l); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [started, navigate])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const bumpControlsTimer = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3000)
  }, [])

  const seekTo = useCallback((idx) => {
    const cur = activeIdxRef.current
    if (idx === cur) return
    let t
    do { t = Math.floor(Math.random() * TRANSITION_COUNT) } while (t === transitionRef.current)
    transitionRef.current = t
    let kb
    do { kb = Math.floor(Math.random() * KB_COUNT) } while (kb === kbRef.current)
    kbRef.current = kb
    setGhost({ src: images[cur], key: Date.now() })
    activeIdxRef.current = idx
    setActiveIdx(idx)
    setSlideKey(k => k + 1)
  }, [images])

  const getIdxFromX = useCallback((clientX) => {
    const rect = scrubberRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(pct * (images.length - 1))
  }, [images.length])

  const handleScrubStart = useCallback((e) => {
    e.preventDefault()
    setIsScrubbing(true)
    bumpControlsTimer()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const idx = getIdxFromX(clientX)
    seekTo(idx)
    setScrubYear(parseYear(images[idx]) ?? '')
  }, [getIdxFromX, seekTo, images, bumpControlsTimer])

  // Global move/up handlers while scrubbing
  useEffect(() => {
    if (!isScrubbing) return
    const onMove = (e) => {
      bumpControlsTimer()
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const idx = getIdxFromX(clientX)
      seekTo(idx)
      setScrubYear(parseYear(images[idx]) ?? '')
    }
    const onEnd = () => { setIsScrubbing(false); setScrubYear(null) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('mouseup', onEnd)
    window.addEventListener('touchend', onEnd)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('mouseup', onEnd)
      window.removeEventListener('touchend', onEnd)
    }
  }, [isScrubbing, getIdxFromX, seekTo, images, bumpControlsTimer])

  const handleStart = (startIdx = 0) => {
    activeIdxRef.current = startIdx
    setActiveIdx(startIdx)
    setStarted(true)
    bumpControlsTimer()
    containerRef.current?.requestFullscreen?.().catch?.(() => {})
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch?.(() => {})
    } else {
      containerRef.current?.requestFullscreen?.().catch?.(() => {})
    }
  }

  // ── Landing ──────────────────────────────────────────────────────────────────
  if (!started) {
    const statusText =
      configError === 'missing_config'
        ? '⚠ Add SUPABASE_URL and SUPABASE_ANON_KEY to .env.local'
        : images.length === 0
        ? '⚠ No photos found — check your bucket/folder config'
        : `${images.length} photos ready`

    const statusClass =
      images.length > 0 && !configError ? styles.badge : `${styles.badge} ${styles.badgeWarn}`

    return (
      <div className={styles.landing}>
        <div className={styles.landingContent}>
          {/* Arc title above the grad cap */}
          <div className={styles.arcWrapper}>
            <svg viewBox="0 0 520 235" className={styles.arcSvg} aria-hidden>
              <defs>
                <path id="arc" d="M 10,220 A 240,240 0 0,1 510,220" />
                <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%"   stopColor="#006633" />
                  <stop offset="100%" stopColor="#f5af19" />
                </linearGradient>
              </defs>
              <text className={styles.arcText}>
                <textPath href="#arc" startOffset="50%" textAnchor="middle">
                  Jazmine Through the Years
                </textPath>
              </text>
            </svg>
            <span className={styles.cap} aria-hidden>🎓</span>
          </div>
          <h1 className={styles.titleSr}>Jazmine Through the Years</h1>
          <p className={styles.subtitle}>Class of 2026</p>
          <p className={statusClass}>{statusText}</p>
          <button
            className={styles.startBtn}
            onClick={() => handleStart(0)}
            disabled={images.length === 0}
          >
            ▶&nbsp;&nbsp;Start Slideshow
          </button>
          {savedIdx > 0 && (
            <button
              className={styles.resumeBtn}
              onClick={() => handleStart(savedIdx)}
            >
              ↩&nbsp;&nbsp;Resume from photo {savedIdx + 1}
            </button>
          )}
          <p className={styles.hint}>Fullscreen · Auto-advances · Looping</p>
        </div>

      </div>
    )
  }

  // ── Slideshow ────────────────────────────────────────────────────────────────
  const prevIndex = (activeIdx - 1 + images.length) % images.length
  const nextIndex = (activeIdx + 1) % images.length
  const dateLabel = parseDate(images[activeIdx])
  const showUI = controlsVisible ? styles.uiVisible : styles.uiHidden

  return (
    <div
      ref={containerRef}
      className={`${styles.slideshow} ${controlsVisible ? styles.cursorDefault : styles.cursorNone}`}
      onMouseMove={bumpControlsTimer}
      onTouchStart={bumpControlsTimer}
    >
      {/* Audio */}
      {playlist.length > 0 && (
        <audio ref={audioRef} onEnded={handleSongEnd} preload="auto">
          <source src={playlist[songIndex]} />
        </audio>
      )}

      {/* Preload adjacent slides */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={images[prevIndex]} alt="" className={styles.preload} aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={images[nextIndex]} alt="" className={styles.preload} aria-hidden />

      {/* Ghost: previous photo crossfading out */}
      {ghost && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`ghost-${ghost.key}`}
          src={ghost.src}
          className={styles.ghost}
          onAnimationEnd={() => setGhost(null)}
          alt=""
          aria-hidden
        />
      )}

      {/* Active slide: entrance wrapper + Ken Burns on the image */}
      <div
        key={`wrap-${slideKey}`}
        className={`${styles.slideWrap} ${styles[`t${transitionRef.current}`]}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[activeIdx]}
          alt={`Photo ${activeIdx + 1} of ${images.length}`}
          className={`${styles.slide} ${styles[`kb${kbRef.current}`]}`}
          style={{ animationDuration: `${SLIDE_INTERVAL_MS}ms` }}
        />
      </div>

      {/* Date overlay — always visible, re-animates on each slide */}
      {dateLabel && (
        <div key={`date-${slideKey}`} className={styles.dateOverlay}>{dateLabel}</div>
      )}

      {/* Now playing — bottom left */}
      {playlist.length > 0 && (
        <div className={`${styles.nowPlaying} ${showUI}`}>
          ♪ {songName(playlist[songIndex])}
        </div>
      )}

      {/* Controls */}
      <div className={`${styles.controls} ${showUI}`}>
        {/* Year timeline scrubber */}
        <div className={styles.scrubArea}>
          {scrubYear && (
            <div
              className={styles.scrubTooltip}
              style={{ left: `${(activeIdx / Math.max(images.length - 1, 1)) * 100}%` }}
            >
              {scrubYear}
            </div>
          )}
          <div
            ref={scrubberRef}
            className={styles.scrubber}
            onMouseDown={handleScrubStart}
            onTouchStart={handleScrubStart}
          >
            <div className={styles.scrubTrack} />
            <div
              className={styles.scrubFill}
              style={{ width: `${(activeIdx / Math.max(images.length - 1, 1)) * 100}%` }}
            />
            {yearMarkers.map(({ year, pct, showLabel }) => (
              <div key={year} className={styles.yearMark} style={{ left: `${pct}%` }}>
                <div className={styles.yearTick} />
                {showLabel && <span className={styles.yearLabel}>{year}</span>}
              </div>
            ))}
            <div
              className={styles.scrubThumb}
              style={{ left: `${(activeIdx / Math.max(images.length - 1, 1)) * 100}%` }}
            />
          </div>
        </div>
        <div className={styles.controlRow}>
          <span className={styles.counter}>{activeIdx + 1}&nbsp;/&nbsp;{images.length}</span>
          <div className={styles.navBtns}>
            <button className={styles.iconBtn} onClick={() => navigate(-1)} title="Previous (←)">‹</button>
            <button className={`${styles.iconBtn} ${styles.playBtn}`} onClick={() => setPlaying(p => !p)} title="Play / Pause (Space)">
              {playing ? '⏸' : '▶'}
            </button>
            <button className={styles.iconBtn} onClick={() => navigate(1)} title="Next (→)">›</button>
          </div>
          <div className={styles.extraBtns}>
            <button className={`${styles.iconBtn} ${looping ? styles.iconBtnActive : ''}`} onClick={() => setLooping(l => !l)} title="Loop (L)">↺</button>
            <button className={styles.iconBtn} onClick={toggleFullscreen} title="Fullscreen">
              {isFullscreen ? '⊡' : '⊞'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
