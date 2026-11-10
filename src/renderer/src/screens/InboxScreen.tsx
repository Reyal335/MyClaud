import './Screen.css'

function InboxScreen(): React.JSX.Element {
  return (
    <section className="screen" aria-labelledby="inbox-title">
      <h1 id="inbox-title" className="screen__title">
        INBOX
      </h1>
      <p className="screen__note">Your agent conversations will show up here, with their status.</p>
    </section>
  )
}

export default InboxScreen
