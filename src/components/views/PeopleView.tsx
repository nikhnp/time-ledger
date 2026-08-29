'use client'

import { useEffect } from 'react'
import { useLedger } from '@/store/useLedger'
import { Stamp, ViewHead, Washi } from '@/components/bits'
import { RoughBtn } from '@/components/rough/controls'
import { RoughTrack } from '@/components/rough/controls'
import { userColor } from '@/lib/colors'
import { daysSince } from '@/lib/dates'

export default function PeopleView() {
  const user = useLedger((s) => s.user)!
  const ledger = useLedger((s) => s.ledger)!
  const household = useLedger((s) => s.household)
  const fetchHousehold = useLedger((s) => s.fetchHousehold)
  const userAction = useLedger((s) => s.userAction)

  useEffect(() => { fetchHousehold() }, [fetchHousehold])

  const rows = household ?? []
  const max = Math.max(1, ...rows.map((r) => r.hoursThisWeek))
  const isAdmin = user.role === 'admin'
  const admins = rows.filter((r) => r.role === 'admin').length

  return (
    <>
      <ViewHead title="People" sub="the household, and who's in it" />
      <div className="card">
        <Stamp icon="house">Household — this week</Stamp>
        <p style={{ fontSize: '.82rem', color: 'var(--ink-faint)', margin: '0 0 16px' }}>
          Aggregate hours only — no individual timelines visible.
        </p>
        {rows.length > 0 ? rows.map((r) => {
          const col = userColor(r.name)
          return (
            <div className="bar-row" key={r.name}>
              <span className="bar-name" style={{ color: col }}>
                {r.name}
                {r.role === 'admin' && <Washi bg="var(--terracotta-soft)" color="var(--terracotta)">admin</Washi>}
              </span>
              <RoughTrack frac={r.hoursThisWeek / max} hex={col} />
              <span className="bar-val">{r.hoursThisWeek.toFixed(1)}h · {r.daysThisWeek}d</span>
            </div>
          )
        }) : <p className="note">counting the household books…</p>}
        <p className="chart-note">live from Postgres — every member&apos;s ledger, aggregated by the server</p>
      </div>

      <div className="card">
        <Stamp icon="users">Members</Stamp>
        <p style={{ fontSize: '.78rem', color: 'var(--ink-faint)', margin: '0 0 12px' }}>Max 2 admins, at least 1 required.</p>
        {rows.map((r) => {
          const isMe = r.name === user.name
          const synced = r.updated ? `synced ${daysSince(r.updated) === 0 ? 'today' : `${daysSince(r.updated)}d ago`}` : 'no ledger yet'
          return (
            <div className="admin-row" key={r.name}>
              <div>
                <strong>{r.name}</strong>
                {isMe && <Washi bg="var(--sage-soft)" color="var(--sage)">you</Washi>}
                <Washi
                  bg={r.role === 'admin' ? 'var(--terracotta-soft)' : 'var(--sage-soft)'}
                  color={r.role === 'admin' ? 'var(--terracotta)' : 'var(--sage)'}
                >
                  {r.role}
                </Washi>
                <span className="mono" style={{ fontSize: '.62rem', color: 'var(--ink-faint)', marginLeft: 6 }}>{synced}</span>
              </div>
              <div className="admin-actions">
                {isAdmin && !isMe ? (
                  <>
                    {r.role === 'admin' ? (
                      <RoughBtn className="btn-sm" disabled={admins <= 1} onClick={() => userAction(r.name, 'revoke')}>Revoke admin</RoughBtn>
                    ) : (
                      <RoughBtn className="btn-sm" disabled={admins >= 2} onClick={() => userAction(r.name, 'grant')}>Grant admin</RoughBtn>
                    )}
                    {/* P1-1a: the old "Reset pw" button (action 'resetpw') is gone —
                        it nulled the password hash, letting ANY password log in.
                        Use the admin panel's reset-link flow instead. */}
                    <RoughBtn className="btn-sm" onClick={() => userAction(r.name, 'kick')}>Force logout</RoughBtn>
                  </>
                ) : (
                  <span className="note" style={{ fontSize: '.72rem' }}>{isMe ? 'this is you' : 'admins only'}</span>
                )}
              </div>
            </div>
          )
        })}
        <p className="chart-note" style={{ marginTop: 10 }}>
          {ledger.inbox.length} items in your inbox · roles enforced server-side
        </p>
      </div>
    </>
  )
}
