import baseline from '../data/cms-published.json'
import type { Payload } from '../../supabase/functions/_shared/cms'
export const profile = baseline.documents.find(d => d.kind === 'profile')!.payload as Payload
export const academic = baseline.documents.find(d => d.kind === 'academic')!.payload as Payload
export const lines = (value: string): string[] => value.split('\n').map(x => x.trim()).filter(Boolean)
