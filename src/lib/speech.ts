'use client'
/* speech.ts — real dictation via the Web Speech API (Chrome/Edge, online).
 * Falls back gracefully: if the browser can't dictate, the Record tab shows a
 * type-your-day textarea instead. */

interface SpeechCallbacks {
  onLive?: (text: string) => void
  onDone?: (text: string) => void
  onErr?: (msg: string) => void
}

type SR = {
  continuous: boolean
  interimResults: boolean
  lang: string
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

export const Speech = {
  supported: false as boolean,
  _rec: null as SR | null,
  _active: false,
  _finalText: '',

  init() {
    if (typeof window === 'undefined') return
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
    this.supported = !!(w.SpeechRecognition || w.webkitSpeechRecognition)
  },

  start(opts: SpeechCallbacks): boolean {
    if (typeof window === 'undefined') return false
    this.init()
    const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) { opts.onErr?.('not supported'); return false }

    this.stop()
    this._active = true
    this._finalText = ''
    const rec = (this._rec = new Ctor())
    rec.continuous = true
    rec.interimResults = true
    rec.lang = navigator.language || 'en-US'

    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) this._finalText += `${r[0].transcript} `
        else interim += r[0].transcript
      }
      opts.onLive?.(`${this._finalText}${interim}`.trim())
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech') return // benign — recognition auto-continues
      this._active = false
      opts.onErr?.(e.error)
    }
    rec.onend = () => {
      if (this._active) {
        // Chrome stops every ~60s; restart to keep a long dictation going
        setTimeout(() => { try { rec.start() } catch { /* already started */ } }, 120)
      } else {
        opts.onDone?.(this._finalText.trim())
      }
    }
    try { rec.start() } catch {
      this._active = false
      opts.onErr?.('could not start')
      return false
    }
    return true
  },

  stop() {
    this._active = false
    if (this._rec) { try { this._rec.stop() } catch { /* not running */ } }
  },
}
