import type { APIRoute } from 'astro'
import { renderProfileAvatar } from '../../../scripts/profile-avatar.mjs'

export const GET: APIRoute = async () => new Response(new Uint8Array(await renderProfileAvatar()), {
  headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=0, must-revalidate' }
})
