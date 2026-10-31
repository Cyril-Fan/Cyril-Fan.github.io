export const PROFILE_AVATAR_PATH = '/avatar/avatar.png'
export const PROFILE_AVATAR_URL = `https://cyril-fan.top${PROFILE_AVATAR_PATH}`
export const DEFAULT_PROFILE_AVATAR = '/src/assets/avatar.png'

/** The public permalink is an output, never another editable source. */
export function profileAvatarSource(value: string | undefined): string {
  if (!value) return DEFAULT_PROFILE_AVATAR
  const url = new URL(value, 'https://cyril-fan.top')
  if (['cyril-fan.top', 'www.cyril-fan.top'].includes(url.hostname) && url.pathname === PROFILE_AVATAR_PATH) return DEFAULT_PROFILE_AVATAR
  return value
}
