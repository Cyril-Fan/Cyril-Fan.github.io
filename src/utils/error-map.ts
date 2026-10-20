import { z } from 'astro/zod'
import { AstroError } from 'astro/errors'

/** Keep schema defaults and transformations intact, and report paths with Zod 4. */
export function parseWithFriendlyErrors<T extends z.ZodType>(
  schema: T, input: z.input<T>, message: string
): z.output<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new AstroError(message, z.prettifyError(parsed.error))
  return parsed.data
}

export async function parseAsyncWithFriendlyErrors<T extends z.ZodType>(
  schema: T, input: z.input<T>, message: string
): Promise<z.output<T>> {
  const parsed = await schema.safeParseAsync(input)
  if (!parsed.success) throw new AstroError(message, z.prettifyError(parsed.error))
  return parsed.data
}
