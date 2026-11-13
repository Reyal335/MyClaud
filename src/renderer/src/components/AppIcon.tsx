// The app's pixel icon (the cloud with a face), drawn from its art grid at 1x so every
// art pixel is one CSS pixel. The grid is the one scripts/make-icon.mjs renders the
// icon files from; keep the two the same. W is the body, N the eyes and mouth, T the
// cheeks and the base. Colors come from the title bar, so it can dim with the window.
const ART = [
  '.......WWWW.....',
  '......WWWWWW....',
  '..WWW.WWWWWWW...',
  '.WWWWWWWWWWWWW..',
  '.WWWWWWWWWWWWWW.',
  'WWWWWWWWWWWWWWWW',
  'WWWWNNWWWWNNWWWW',
  'WWWWNNWWWWNNWWWW',
  'WWTTWWWNNWWWTTWW',
  'WWWWWWWWWWWWWWWW',
  '.WWWWWWWWWWWWWW.',
  '..TTTTTTTTTTTT..'
]

const WIDTH = ART[0].length
const HEIGHT = ART.length

// One path per color: a rectangle for each horizontal run of that color.
function pathFor(color: string): string {
  const runs: string[] = []
  ART.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (row[x] !== color) {
        x += 1
        continue
      }
      let end = x
      while (end < row.length && row[end] === color) end += 1
      runs.push(`M${x} ${y}h${end - x}v1h${x - end}z`)
      x = end
    }
  })
  return runs.join('')
}

const BODY = pathFor('W')
const FACE = pathFor('N')
const TRIM = pathFor('T')

function AppIcon(): React.JSX.Element {
  return (
    <svg
      className="app-icon"
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path className="app-icon__body" d={BODY} />
      <path className="app-icon__face" d={FACE} />
      <path className="app-icon__trim" d={TRIM} />
    </svg>
  )
}

export default AppIcon
