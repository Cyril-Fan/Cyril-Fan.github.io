type EducationSource = { education?: { first?: string; second?: string }; school?: string; major?: string; period?: string }

/** Legacy local copies remain readable; an explicitly cleared new field stays empty. */
export function educationFields(value: EducationSource) {
  return {
    first: value.education?.first ?? [value.school || '', value.major || '', value.period || ''].join('\n'),
    second: value.education?.second ?? ''
  }
}

export function educationCards(value: EducationSource, schoolUrl = '') {
  const education = educationFields(value)
  return (['second', 'first'] as const).flatMap(key => {
    const text = education[key]
    if (!text.trim()) return []
    const [school = '', major = '', period = ''] = text.split(/\r?\n/).map(line => line.trim())
    return [{ school, major, period, href: key === 'first' ? schoolUrl : '' }]
  })
}
