import { useRef, useState } from 'react'
import type { AgentSummary, PartyPanelMode, TaskAgent } from '../../../shared/ipc'
import { callBlock } from '../../../shared/agentGate'
import { agentKey, type PartyWork } from '../conversation/agentWork'
import type { CallTarget } from '../hooks/useConversation'
import AgentIcon from './AgentIcon'
import './PartyPanel.css'

type PartyPanelProps = {
  agents: AgentSummary[]
  loaded: boolean
  call: CallTarget | null
  onCall: (agent: AgentSummary | null) => void
  // A run is in progress: nobody can be called.
  busy: boolean
  // What each agent is doing in the current run, by agentKey.
  work: Map<string, PartyWork>
  mode: PartyPanelMode
  onToggle: () => void
  onOpenTask: (taskId: string) => void
}

type RowState = 'idle' | 'calling' | 'working' | 'waiting' | 'off'

type Member = {
  key: string
  // null for a built-in agent Claude brought in, shown only while it works.
  agent: AgentSummary | null
  look: TaskAgent
  state: RowState
  // The smaller line under the name, or null for none.
  smaller: string | null
  // What a click does.
  action: { kind: 'call' } | { kind: 'open'; taskId: string } | null
}

function members(
  agents: AgentSummary[],
  call: CallTarget | null,
  work: Map<string, PartyWork>
): Member[] {
  const fileKeys = new Set<string>()
  const list: Member[] = agents.map((agent) => {
    const key = agentKey(agent)
    fileKeys.add(key)
    const look: TaskAgent = {
      name: agent.name,
      scope: agent.scope,
      filePath: agent.filePath,
      icon: agent.icon,
      role: agent.role
    }
    const busy = work.get(key)
    if (busy) {
      return {
        key,
        agent,
        look,
        state: busy.state,
        smaller:
          busy.state === 'waiting' ? 'Needs your approval' : (busy.activity ?? 'Starting...'),
        action: { kind: 'open', taskId: busy.taskId }
      }
    }
    const block = callBlock(agent, agents)
    if (block) return { key, agent, look, state: 'off', smaller: block.short, action: null }
    const calling = call?.ref.filePath === agent.filePath
    return {
      key,
      agent,
      look,
      state: calling ? 'calling' : 'idle',
      smaller: agent.role,
      action: { kind: 'call' }
    }
  })
  // Built-in agents Claude brought in get a row at the end while they work.
  for (const [key, entry] of work) {
    if (fileKeys.has(key)) continue
    list.push({
      key,
      agent: null,
      look: entry.agent,
      state: entry.state,
      smaller:
        entry.state === 'waiting' ? 'Needs your approval' : (entry.activity ?? 'Starting...'),
      action: { kind: 'open', taskId: entry.taskId }
    })
  }
  return list
}

function toolsText(tools: string[] | null): string {
  if (tools === null) return 'All tools'
  return tools.length === 0 ? 'No tools' : tools.join(' · ')
}

function accessibleName(member: Member): string {
  return member.look.role ? `${member.look.name}, ${member.look.role}` : member.look.name
}

// The party panel from designs/8-chat-party.html, and the icon rail from
// 8c-party-rail.html. Every member state is in 8b-party-states.html.
function PartyPanel({
  agents,
  loaded,
  call,
  onCall,
  busy,
  work,
  mode,
  onToggle,
  onOpenTask
}: PartyPanelProps): React.JSX.Element {
  const [pointed, setPointed] = useState<string | null>(null)
  const [cardTop, setCardTop] = useState(0)
  const railRef = useRef<HTMLElement>(null)
  const list = members(agents, call, work)
  const pointedMember = list.find((member) => member.key === pointed) ?? null
  const calledMember = call
    ? (list.find((member) => member.agent?.filePath === call.ref.filePath) ?? null)
    : null

  function activate(member: Member): void {
    if (!member.action) return
    if (member.action.kind === 'open') {
      onOpenTask(member.action.taskId)
      return
    }
    if (busy || !member.agent) return
    onCall(member.state === 'calling' ? null : member.agent)
  }

  // The hover card sits beside the pointed icon, measured against the rail.
  function point(member: Member, element: HTMLElement | null): void {
    setPointed(member.key)
    if (element && railRef.current) {
      setCardTop(element.getBoundingClientRect().top - railRef.current.getBoundingClientRect().top)
    }
  }

  const pointHandlers = (
    member: Member
  ): Pick<
    React.HTMLAttributes<HTMLElement>,
    'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur'
  > => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => point(member, event.currentTarget),
    onMouseLeave: () => setPointed((current) => (current === member.key ? null : current)),
    onFocus: (event: React.FocusEvent<HTMLElement>) => point(member, event.currentTarget),
    onBlur: () => setPointed((current) => (current === member.key ? null : current))
  })

  const toggle = (
    <button
      type="button"
      className="party__toggle"
      aria-label={mode === 'open' ? 'Collapse the party panel' : 'Open the party panel'}
      aria-expanded={mode === 'open'}
      onClick={onToggle}
    >
      {mode === 'open' ? '>>' : '<<'}
    </button>
  )

  if (mode === 'rail') {
    return (
      <aside className="party party--rail" aria-label="Party" ref={railRef}>
        {toggle}
        <span className="party__rail-title">PARTY</span>
        <div className="party__rail-list" onScroll={() => setPointed(null)}>
          {list.map((member) => {
            const className = `party__icon party__icon--${member.state}`
            const icon = (
              <span className={member.state === 'working' ? 'party__hop' : undefined}>
                <AgentIcon src={member.look.icon} size={32} label="" />
              </span>
            )
            const marker = (member.state === 'working' || member.state === 'waiting') && (
              <span className="party__icon-marker" aria-hidden="true" />
            )
            if (!member.action) {
              return (
                <div
                  key={member.key}
                  className={className}
                  role="img"
                  aria-label={`${accessibleName(member)}. ${member.smaller ?? ''}`}
                  tabIndex={0}
                  {...pointHandlers(member)}
                >
                  {icon}
                </div>
              )
            }
            return (
              <button
                key={member.key}
                type="button"
                className={className}
                aria-label={accessibleName(member)}
                aria-pressed={
                  member.action.kind === 'call' ? member.state === 'calling' : undefined
                }
                aria-disabled={member.action.kind === 'call' && busy ? true : undefined}
                onClick={() => activate(member)}
                {...pointHandlers(member)}
              >
                {icon}
                {marker}
              </button>
            )
          })}
        </div>
        {pointedMember && (
          <div className="party__card" style={{ top: cardTop }} role="tooltip">
            <div className="party__card-head">
              <span className="party__card-name">{pointedMember.look.name}</span>
              {pointedMember.look.role && (
                <span className="party__card-role">{pointedMember.look.role}</span>
              )}
              {pointedMember.agent?.model && (
                <span className="party__tag">{pointedMember.agent.model}</span>
              )}
            </div>
            {pointedMember.agent && (
              <p className="party__card-description">{pointedMember.agent.description}</p>
            )}
            <p className="party__card-note">
              {pointedMember.state === 'idle' || pointedMember.state === 'calling'
                ? 'Click to call for your next message'
                : pointedMember.smaller}
            </p>
          </div>
        )}
      </aside>
    )
  }

  const detail = pointedMember ?? calledMember
  return (
    <aside className="party" aria-label="Party">
      <div className="party__head">
        <h2 className="party__title">PARTY</h2>
        <span className="party__count">
          {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
        </span>
        {toggle}
      </div>
      <p className="party__note">
        {call
          ? `Calling ${call.agent.name} for your next message.`
          : 'Click a member to call them for your next message.'}
      </p>

      <div className="party__list">
        {loaded && list.length === 0 && (
          <p className="party__empty">No agents yet. Make one on the AGENTS screen.</p>
        )}
        {list.map((member) => {
          const content = (
            <>
              <span className={member.state === 'working' ? 'party__hop' : undefined}>
                <AgentIcon src={member.look.icon} size={32} label="" />
              </span>
              <span className="party__names">
                <span className="party__name">{member.look.name}</span>
                {member.smaller && <span className="party__smaller">{member.smaller}</span>}
              </span>
              {(member.state === 'working' || member.state === 'waiting') && (
                <span className="party__marker" aria-hidden="true" />
              )}
            </>
          )
          const className = `party__row party__row--${member.state}`
          if (!member.action) {
            return (
              <div key={member.key} className={className} tabIndex={0} {...pointHandlers(member)}>
                {content}
              </div>
            )
          }
          return (
            <button
              key={member.key}
              type="button"
              className={className}
              aria-label={
                member.action.kind === 'open'
                  ? `${accessibleName(member)}. ${member.smaller ?? ''}. Open its task in INBOX`
                  : accessibleName(member)
              }
              aria-pressed={member.action.kind === 'call' ? member.state === 'calling' : undefined}
              aria-disabled={member.action.kind === 'call' && busy ? true : undefined}
              onClick={() => activate(member)}
              {...pointHandlers(member)}
            >
              {content}
            </button>
          )
        })}
      </div>

      <div className="party__detail">
        {detail ? (
          <>
            <div className="party__detail-head">
              <span className="party__detail-name">{detail.look.name}</span>
              {detail.agent?.model && <span className="party__tag">{detail.agent.model}</span>}
            </div>
            {detail.agent ? (
              <>
                <p className="party__detail-description">{detail.agent.description}</p>
                <p className="party__detail-tools">{toolsText(detail.agent.tools)}</p>
              </>
            ) : (
              <p className="party__detail-description">A built-in agent Claude brought in.</p>
            )}
          </>
        ) : (
          <p className="party__detail-empty">Hover a member to see what they do.</p>
        )}
      </div>
    </aside>
  )
}

export default PartyPanel
