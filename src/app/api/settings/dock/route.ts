import { NextRequest } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/server/auth'
import { getDockConfig, setDockConfig } from '@/lib/neon-sql'
import type { DockConfigT } from '@/lib/types'

export const dynamic = 'force-dynamic'

const VALID_TOOLS = ['habits', 'screen', 'board', 'budget', 'goals', 'inbox', 'matrix', 'notes', 'people']

/** GET /api/settings/dock — current user's dock config. */
export async function GET(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')
  const config = await getDockConfig(me.id)
  return Response.json({ config })
}

/** PUT /api/settings/dock — update current user's dock config. */
export async function PUT(req: NextRequest) {
  const me = await getSessionUser(req)
  if (!me) return jsonError(401, 'not logged in')

  let body: { enabled?: string[]; keepInDock?: string[] }
  try { body = await req.json() } catch { return jsonError(400, 'invalid JSON body') }

  const enabled = Array.isArray(body.enabled) ? body.enabled.filter((t) => VALID_TOOLS.includes(t)) : []
  const keepInDock = Array.isArray(body.keepInDock) ? body.keepInDock.filter((t) => enabled.includes(t)) : []

  const config: DockConfigT = { enabled, keepInDock }
  await setDockConfig(me.id, config)
  return Response.json({ config })
}
