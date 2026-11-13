import { useLayoutEffect, useRef, useState } from 'react'
import { fadeBands, themePlacement } from '../../../shared/themes'
import './ThemeBackdrop.css'

type ThemeBackdropProps = {
  // The theme picture as a URL, or null for none: the plain navy frame.
  image: string | null
  // 0 to 100, in steps of 10.
  fade: number
  // A tile in the picker: the whole picture is shown, at a scale that fits the small
  // frame, instead of the scale the chat uses.
  thumbnail?: boolean
}

type Size = { width: number; height: number }

// The theme behind the CHAT history and stage, and behind the picker's preview and
// tiles. It fills its positioned parent and draws, back to front: the navy
// background, the picture, and the fade. The content goes on top, in the parent.
//
// The picture is anchored to the frame's bottom edge and centered across, and the
// frame clips the rest. Pixel art (both sides 640 or less) is scaled by whole numbers
// so its pixels stay square; a bigger picture is scaled smoothly to fill the frame.
// The frame is measured again whenever it is resized. The picture is decoration only.
function ThemeBackdrop({ image, fade, thumbnail = false }: ThemeBackdropProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<Size | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    // Rounded up, so the picture always covers a frame whose size is not whole.
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect()
      const width = Math.ceil(box.width)
      const height = Math.ceil(box.height)
      setFrame((current) =>
        current && current.width === width && current.height === height
          ? current
          : { width, height }
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="theme-backdrop" aria-hidden="true">
      {image !== null && frame !== null && frame.width > 0 && frame.height > 0 && (
        <BackdropImage key={image} image={image} fade={fade} frame={frame} thumbnail={thumbnail} />
      )}
    </div>
  )
}

// Its own component so that a picture that fails to load is remembered for as long
// as that picture is shown: it draws as none, and warns once. The picture's own size
// is only known once it has loaded, and decides how it is scaled.
function BackdropImage({
  image,
  fade,
  frame,
  thumbnail
}: {
  image: string
  fade: number
  frame: Size
  thumbnail: boolean
}): React.JSX.Element | null {
  const [failed, setFailed] = useState(false)
  const [natural, setNatural] = useState<Size | null>(null)
  if (failed) return null

  const placement = natural
    ? themePlacement(frame.width, frame.height, natural.width, natural.height, thumbnail)
    : null
  return (
    <>
      <img
        className={`theme-backdrop__image${placement?.pixelated ? ' theme-backdrop__image--pixel' : ''}`}
        src={image}
        alt=""
        draggable={false}
        style={
          placement
            ? { width: placement.width, height: placement.height, left: placement.left }
            : { visibility: 'hidden' }
        }
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget
          // A picture with no size cannot be placed: it draws as none.
          if (naturalWidth > 0 && naturalHeight > 0) {
            setNatural({ width: naturalWidth, height: naturalHeight })
          } else {
            console.warn('The chat theme picture could not be loaded. Showing no theme.')
            setFailed(true)
          }
        }}
        onError={() => {
          console.warn('The chat theme picture could not be loaded. Showing no theme.')
          setFailed(true)
        }}
      />
      {placement &&
        fadeBands(fade)
          .filter((band) => band.opacity > 0)
          .map((band) => (
            <span
              key={band.top}
              className="theme-backdrop__band"
              style={{ top: `${band.top}%`, height: `${band.height}%`, opacity: band.opacity }}
            />
          ))}
    </>
  )
}

export default ThemeBackdrop
