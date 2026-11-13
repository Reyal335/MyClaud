// Chat themes: the rules main and the window share. Pure: no imports, so they can
// be tested with plain values. A theme is a picture behind the CHAT history and
// stage, under a stepped navy fade.

// themeId values that are not an uploaded theme's id.
export const NONE_THEME = 'none'
export const TOKYO_NIGHT = 'tokyo-night'

const MB = 1024 * 1024
export const MAX_THEME_MB = 5
export const MAX_THEME_BYTES = MAX_THEME_MB * MB
export const MIN_THEME_WIDTH = 160
export const MIN_THEME_HEIGHT = 100
export const MAX_THEME_SIDE = 6000
// A picture no bigger than this on both sides is pixel art: it is scaled by whole
// numbers and drawn with square, sharp pixels. A bigger one is a picture, scaled
// smoothly to fill the frame.
export const PIXEL_ART_MAX_SIDE = 640
export const MAX_THEME_NAME_LENGTH = 24

export const FADE_STEP = 10
export const MAX_FADE = 100

// What a chat or the default holds: which theme, and how strongly it is faded.
export type ThemeChoice = { themeId: string; fade: number }

// The choice new chats start from until I save another.
export const DEFAULT_THEME: ThemeChoice = { themeId: TOKYO_NIGHT, fade: 60 }

// An uploaded theme. `image` is the PNG or JPG as a data URL, loaded the way mascot
// images are. The built-in Tokyo Night is bundled with the window, not listed here.
export type ThemeInfo = {
  id: string
  name: string
  addedAt: number
  image: string
}

// A fade is a whole number of tens, 0 to 100.
export function isValidFade(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_FADE &&
    value % FADE_STEP === 0
  )
}

// --- Messages ---------------------------------------------------------------------

export const THEME_TOO_BIG = `Theme must be ${MAX_THEME_MB} MB or smaller.`
export const THEME_NOT_IMAGE = 'Theme must be a PNG or JPG.'

export function themeTooSmall(fileName: string, width: number, height: number): string {
  return `Theme must be at least ${MIN_THEME_WIDTH}x${MIN_THEME_HEIGHT}. ${fileName} is ${width}x${height}.`
}

export function themeTooLarge(fileName: string, width: number, height: number): string {
  return `Theme must be ${MAX_THEME_SIDE} px or smaller on each side. ${fileName} is ${width}x${height}.`
}

// The size limits, in the order they are checked: at least 160x100, then at most 6000
// on each side. Any aspect ratio is fine. Null when the size is allowed, else the
// code and the message to show.
export function themeSizeProblem(
  fileName: string,
  width: number,
  height: number
): { code: 'too_small' | 'too_big_dimensions'; message: string } | null {
  if (width < MIN_THEME_WIDTH || height < MIN_THEME_HEIGHT) {
    return { code: 'too_small', message: themeTooSmall(fileName, width, height) }
  }
  if (width > MAX_THEME_SIDE || height > MAX_THEME_SIDE) {
    return { code: 'too_big_dimensions', message: themeTooLarge(fileName, width, height) }
  }
  return null
}

export function deleteThemeText(name: string): string {
  return `Delete ${name}? Chats using it go back to the default.`
}

// 1 to 24 characters once trimmed, and not blank.
export function themeNameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Name is required.'
  if (trimmed.length > MAX_THEME_NAME_LENGTH) {
    return `Name must be at most ${MAX_THEME_NAME_LENGTH} characters.`
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return 'Name cannot contain line breaks or tabs.'
  return null
}

// The name a new theme gets: its file name without the extension, cut to 24
// characters. A name that would be blank becomes "Theme".
export function themeNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, '')
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  const cut = cleaned.slice(0, MAX_THEME_NAME_LENGTH).trim()
  return cut === '' ? 'Theme' : cut
}

// --- Drawing ------------------------------------------------------------------------

// Small images are treated as pixel art.
export function isPixelArt(imageWidth: number, imageHeight: number): boolean {
  return imageWidth <= PIXEL_ART_MAX_SIDE && imageHeight <= PIXEL_ART_MAX_SIDE
}

export type ThemePlacement = {
  // Pixel art is drawn with square, sharp pixels; a picture is scaled smoothly.
  pixelated: boolean
  scale: number
  // The size the image is drawn at, in pixels, and its left edge in the frame.
  width: number
  height: number
  left: number
}

// Float noise (a scale of 3.0000000000000004) must not add a pixel of overhang.
function coverSize(value: number): number {
  return Math.ceil(value - 1e-6)
}

// Where the image goes in a frame. Its bottom edge sits on the frame's bottom edge, it
// is centered across, and the frame clips what does not fit. `left` is a whole pixel.
//
// - Pixel art (both sides 640 or less): scale = max(1, ceil(max(fw / iw, fh / ih))), a
//   whole number, so the pixels stay square.
// - A picture (a side over 640): scale = max(fw / iw, fh / ih), not rounded. The drawn
//   size is rounded up, so it always covers the frame with no gap.
//
// A thumbnail in the picker shows the whole picture instead, so for it the scale is
// never rounded and has no floor of 1: pixel art keeps its crisp look, but at a
// scale that fits the little frame.
export function themePlacement(
  frameWidth: number,
  frameHeight: number,
  imageWidth: number,
  imageHeight: number,
  thumbnail = false
): ThemePlacement {
  const pixelated = isPixelArt(imageWidth, imageHeight)
  const cover = Math.max(frameWidth / imageWidth, frameHeight / imageHeight)
  const whole = pixelated && !thumbnail
  const scale = whole ? Math.max(1, Math.ceil(cover)) : cover
  const width = whole ? imageWidth * scale : coverSize(imageWidth * scale)
  const height = whole ? imageHeight * scale : coverSize(imageHeight * scale)
  return { pixelated, scale, width, height, left: Math.floor((frameWidth - width) / 2) }
}

// The fade is five flat bands, top to bottom, of navy over the picture. At fade S
// band i has opacity min(0.95, BASE[i] * S / 60): 60 matches the mockup, 0 shows the
// picture as it is, and 100 nearly hides it. No smooth gradient.
const FADE_BASE = [0.9, 0.8, 0.7, 0.6, 0.55]
// Where each band starts and ends, in percent of the frame's height.
const FADE_EDGES = [0, 14, 28, 42, 56, 100]

export type FadeBand = { top: number; height: number; opacity: number }

export function fadeBands(fade: number): FadeBand[] {
  return FADE_BASE.map((base, i) => ({
    top: FADE_EDGES[i],
    height: FADE_EDGES[i + 1] - FADE_EDGES[i],
    opacity: Math.min(0.95, (base * fade) / 60)
  }))
}
