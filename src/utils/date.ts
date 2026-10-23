import config from '@/site-config'

const dateOptions: Intl.DateTimeFormatOptions = { ...config.locale.dateOptions, hourCycle: 'h23' }
const dateFormat = new Intl.DateTimeFormat(config.locale.dateLocale, dateOptions)

export function getFormattedDate(
  date: string | number | Date,
  options?: Intl.DateTimeFormatOptions
) {
  if (typeof options !== 'undefined') {
    return new Date(date).toLocaleDateString(config.locale.dateLocale, {
      ...dateOptions,
      ...options
    })
  }

  return dateFormat.format(new Date(date))
}
