import { agentRoleError } from '../shared/agentRules'
import { normalizePath, prunePathMap, readPathMap, writePathMap, type PathMap } from './pathMap'

// An agent's role (for example "code-reader") is a Mya label, kept in
// userData/agent-roles.json by agent file path. It is never written into the
// agent file, so Claude Code does not see it.

const MAP_FILE = 'agent-roles.json'

function readMap(): Promise<PathMap> {
  return readPathMap(MAP_FILE, (role) => role.trim() !== '' && agentRoleError(role) === null)
}

// Reads the map, dropping entries whose agent file no longer exists. Returns the
// agent-path lookup used to fill in the list.
export async function loadRoles(): Promise<(agentPath: string) => string | null> {
  const map = await readMap()
  await prunePathMap(MAP_FILE, map)
  return (agentPath) => map[normalizePath(agentPath)] ?? null
}

// Records the role once the agent file is saved. `fromPath` is where the agent
// was before (null for a new agent), so a moved agent keeps its role.
export async function saveRole(
  fromPath: string | null,
  toPath: string,
  role: string | null
): Promise<void> {
  const map = await readMap()
  if (fromPath !== null) delete map[normalizePath(fromPath)]
  const key = normalizePath(toPath)
  if (role) map[key] = role
  else delete map[key]
  await writePathMap(MAP_FILE, map)
}

export async function forgetRole(agentPath: string): Promise<void> {
  const map = await readMap()
  const key = normalizePath(agentPath)
  if (!(key in map)) return
  delete map[key]
  await writePathMap(MAP_FILE, map)
}
