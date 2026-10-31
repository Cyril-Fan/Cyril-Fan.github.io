export const PROFILE_AVATAR_PATH = '/avatar/avatar.png'
export const PROFILE_AVATAR_URL = `https://cyril-fan.top${PROFILE_AVATAR_PATH}`

/** The public permalink is an output, never another editable source. */
export function profileAvatarSource(value: string | undefined): string {
  if (!value?.trim()) throw new Error('Choose a profile avatar before publishing')
  const url = new URL(value, 'https://cyril-fan.top')
  if (['cyril-fan.top', 'www.cyril-fan.top'].includes(url.hostname) && url.pathname === PROFILE_AVATAR_PATH) throw new Error('The public avatar URL is generated; choose its source image instead')
  return value
}
