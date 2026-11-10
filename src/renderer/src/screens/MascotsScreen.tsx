import './Screen.css'

function MascotsScreen(): React.JSX.Element {
  return (
    <section className="screen" aria-labelledby="mascots-title">
      <h1 id="mascots-title" className="screen__title">
        MASCOTS
      </h1>
      <p className="screen__note">Your mascots and their spritesheet uploads will live here.</p>
    </section>
  )
}

export default MascotsScreen
