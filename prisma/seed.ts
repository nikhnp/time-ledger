/**
 * prisma/seed.ts — no-op.
 *
 * This app does NOT seed demo users. Sign up via the UI to create your
 * first account (which becomes the admin).
 *
 * To intentionally clear all data and start fresh:
 *   npx prisma db push --force-reset
 *
 * (Previously this file created the demo users Asha/Bibek/Chandra/Diya/Elina
 * with deterministic ledgers. That has been removed at the user's request.)
 */
async function main() {
  console.log('')
  console.log('  prisma/seed.ts is a no-op.')
  console.log('  Sign up via the UI to create your first account (becomes admin).')
  console.log('')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
