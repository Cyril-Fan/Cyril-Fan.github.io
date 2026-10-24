import profileData from '../data/profile.json'
import academicData from '../data/academic.json'
export const profile: Record<string, any> = profileData
export const academic: Record<string, any> = academicData
export const lines = (value: string): string[] => (value || '').split('\n').map(x => x.trim()).filter(Boolean)
