import { createTeamIdentity } from './team-identity.js'

// Local business policy, not account authentication. Call with the pre-change
// durable config inside the owning transaction; never authorize against a patch.
export function assertTeamActionPre(config, action) {
  const identity = createTeamIdentity({ engine: { config } })
  const result = identity.canDo(action)
  if (result.ok === true) return { ...result, member: config && config.teamEnabled === true ? identity.currentMember() : null }
  const error = new Error('team-forbidden: ' + action)
  error.code = 'team-forbidden'
  error.statusCode = 403
  error.action = action
  throw error
}
