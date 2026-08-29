'use client'
/* speech.ts — real dictation via the Web Speech API (Chrome/Edge, online).
 * Falls back gracefully: if the browser can't dictate, the Record tab shows a
 * type-your-day textarea instead.
 *
 * v10.5 — two real-world fixes:
 *
 * 1. Android Chrome ends the recognizer after every utterance/pause. Our
 *    onend handler restarts it — but each NEW session re-delivers the audio
 *    recognised so far ("this", then "this is", then "this is what I"...).
 *    Appending those finals verbatim produced the infamous
 *    "this this this is this is what..." transcript. We now merge each final
 *    into the running text with a suffix/prefix-overlap check, and apply the
 *    merge strictly on the FIRST final after a session restart (where the
 *    re-delivery happens), so legit speech is never swallowed.
 *
 * 2. Desktop dictation that "stops after about a second" was a transient
 *    error ('network' / 'aborted' / 'audio-capture') silently killing the
 *    session: the old code stopped on every error except 'no-speech'.
 *    Transient errors now auto-restart with capped backoff; permanent ones
 *    (denied mic permission, unsupported language) surface a readable message.
 */

interface SpeechCallbacks {
  onLive?: (text: string) => void
  onDone?: (text: string) => void
  onErr?: (msg: string) => void
}

type SR = {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start: () => void
  stop: () => void
  onresult: ((e: SpeechRecognitionResultLikeEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionResultLikeEvent {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

interface SRCtor {
  new (): SR
}

/* errors that are worth an automatic retry (flaky network, hiccups) */
const TRANSIENT_ERRORS = new Set(['network', 'aborted', 'audio-capture'])
/* errors that will never fix themselves by retrying */
const PERMANENT_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone blocked — allow mic access for this site, then try again.',
  'service-not-allowed': 'Speech service blocked — check browser permissions policy.',
  'language-not-supported': 'This browser can\u2019t recognise your display language.',
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
}

export const Speech = {
  supported: false as boolean,
  _rec: null as SR | null,
  _active: false,
  _finalText: '',
  _restartTimer: null as ReturnType<typeof setTimeout> | null,
  _attempt: 0,
  _session: 0,
  /* true until the first final result of a (re)started session has been merged —
   * this is the window where Chrome re-delivers previous audio */
  _awaitingFirstFinal: false,
  _opts: null as SpeechCallbacks | null,

  init() {
    if (typeof window === 'undefined') return
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
    this.supported = !!(w.SpeechRecognition || w.webkitSpeechRecognition)
  },

  /** Merge a re-delivered final into the running text. Returns the new final text. */
  _mergeFinal(candidate: string): string {
    const candWords = words(candidate)
    if (!candWords.length) return this._finalText
    if (!this._awaitingFirstFinal || !this._finalText) {
      this._finalText = `${this._finalText}${this._finalText ? ' ' : ''}${candidate.trim()}`.replace(/\s+/g, ' ')
      return this._finalText
    }
    /* suffix-of-tail vs prefix-of-candidate overlap */
    const tailWords = words(this._finalText)
    let k = Math.min(tailWords.length, candWords.length)
    while (k > 0) {
      let same = true
      for (let i = 0; i < k; i++) {
        if (tailWords[tailWords.length - k + i] !== candWords[i]) { same = false; break }
      }
      if (same) break
      k--
    }
    if (k === candWords.length) {
      /* candidate is entirely re-delivered old audio — nothing new */
      return this._finalText
    }
    const fresh = candWords.slice(k).join(' ')
    this._finalText = `${this._finalText} ${fresh}`.replace(/\s+/g, ' ')
    return this._finalText
  },

  start(opts: SpeechCallbacks): boolean {
    if (typeof window === 'undefined') return false
    this.init()
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) { opts.onErr?.('This browser doesn\u2019t support dictation — use the type-it option.'); return false }

    this.stop()
    this._active = true
    this._finalText = ''
    this._attempt = 0
    this._awaitingFirstFinal = true
    this._opts = opts
    const sid = ++this._session
    const isCurrent = () => this._session === sid && this._active
    const rec = (this._rec = new Ctor())
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.lang = navigator.language || 'en-US'

    rec.onresult = (e) => {
      if (!isCurrent()) return
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0]?.transcript ?? ''
        if (!t) continue
        if (r.isFinal) {
          this._mergeFinal(t)
          this._awaitingFirstFinal = false
        } else {
          interim += t
        }
      }
      /* dedupe interim text that merely re-delivers the committed tail
       * (Android shows the full-so-far text as interim after a restart) */
      let live = interim
      if (this._awaitingFirstFinal && this._finalText && interim) {
        const tailWords = words(this._finalText)
        const liveWords = words(interim)
        let k = Math.min(tailWords.length, liveWords.length)
        while (k > 0) {
          let same = true
          for (let i = 0; i < k; i++) {
            if (tailWords[tailWords.length - k + i] !== liveWords[i]) { same = false; break }
          }
          if (same) break
          k--
        }
        if (k === liveWords.length) live = ''
        else if (k > 0) live = liveWords.slice(k).join(' ')
      }
      this._opts?.onLive?.(`${this._finalText}${live ? ` ${live}` : ''}`.trim())
    }

    rec.onerror = (e) => {
      if (!isCurrent()) return
      if (e.error === 'no-speech') return // benign — onend decides whether to restart
      if (TRANSIENT_ERRORS.has(e.error)) {
        // transient: let onend restart with backoff; surface only after repeated failure
        if (this._attempt >= 4) {
          this._active = false
          this._opts?.onErr?.('Speech service is flaky right now — try again in a moment.')
        }
        return
      }
      this._active = false
      this._opts?.onErr?.(PERMANENT_ERRORS[e.error] ?? `Dictation error: ${e.error}`)
    }

    rec.onend = () => {
      if (!isCurrent()) {
        /* a stopped/superseded session ending — deliver its transcript if the
         * user pressed stop (active=false, same session) */
        if (this._session === sid && !this._active && this._opts) {
          this._opts.onDone?.(this._finalText.trim())
        }
        return
      }
      /* Chrome ends the session every ~60s (and Android after each utterance);
       * restart to keep a long dictation going */
      this._attempt++
      this._awaitingFirstFinal = true
      const delay = Math.min(120 * Math.pow(2, Math.max(0, this._attempt - 1)), 4000)
      if (this._restartTimer) clearTimeout(this._restartTimer)
      this._restartTimer = setTimeout(() => {
        if (!this._active || this._session !== sid || !this._rec) return
        try { this._rec.start() } catch { /* already started */ }
      }, delay)
    }

    try { rec.start() } catch {
      this._active = false
      opts.onErr?.('Could not start dictation — is the microphone in use?')
      return false
    }
    return true
  },

  stop() {
    /* _active=false lets the current session's onend deliver onDone(finalText);
     * the session id guard stops stale sessions from restarting */
    this._active = false
    if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null }
    if (this._rec) { try { this._rec.stop() } catch { /* not running */ } }
  },
}
