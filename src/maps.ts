export interface ImportedMapLink {
  url: string
  address: string
}

function isGoogleMapsUrl(url: URL) {
  const host = url.hostname.toLowerCase()
  if (host === 'maps.app.goo.gl') return true
  if (host === 'goo.gl' && url.pathname.startsWith('/maps')) return true
  return /(^|\.)google\.(com|[a-z]{2,3}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host)
    && url.pathname.startsWith('/maps')
}

function readableValue(value: string | null) {
  if (!value) return ''
  const normalized = value.replace(/\+/g, ' ').trim()
  const decoded = /%[0-9a-f]{2}/i.test(normalized) ? decodeURIComponent(normalized) : normalized
  return /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(decoded) ? '' : decoded
}

export function parseGoogleMapsLink(value: string): ImportedMapLink {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || !isGoogleMapsUrl(url)) throw new Error()
    const placeMatch = url.pathname.match(/\/place\/([^/]+)/)
    const address = readableValue(
      url.searchParams.get('query')
        ?? url.searchParams.get('destination')
        ?? url.searchParams.get('q')
        ?? placeMatch?.[1]
        ?? null,
    )
    return { url: url.toString(), address }
  } catch {
    throw new Error('請貼上有效的 Google Maps 連結。')
  }
}

export function mapUrl(address: string, importedUrl?: string) {
  if (importedUrl) {
    try {
      return parseGoogleMapsLink(importedUrl).url
    } catch {
      // Fall back to a safe address search when old or damaged data contains an invalid URL.
    }
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}
