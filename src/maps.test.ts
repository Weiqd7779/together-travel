import { describe, expect, it } from 'vitest'
import { parseGoogleMapsLink } from './maps'

describe('Google Maps link import', () => {
  it('extracts the address from supported query and directions links', () => {
    expect(parseGoogleMapsLink('https://www.google.com/maps/search/?api=1&query=%E4%B8%8A%E9%87%8E%E5%85%AC%E5%9C%92')).toMatchObject({
      address: '上野公園',
    })
    expect(parseGoogleMapsLink('https://www.google.com/maps/dir/?api=1&destination=%E6%9D%B1%E4%BA%AC%E9%A7%85')).toMatchObject({
      address: '東京駅',
    })
    expect(parseGoogleMapsLink('https://www.google.com/maps/search/?api=1&query=100%25%20Coffee')).toMatchObject({
      address: '100% Coffee',
    })
  })

  it('accepts a Google Maps short link without pretending it contains an address', () => {
    expect(parseGoogleMapsLink('https://maps.app.goo.gl/abc123')).toEqual({
      url: 'https://maps.app.goo.gl/abc123',
      address: '',
    })
  })

  it('rejects non-Google and unsafe URLs', () => {
    expect(() => parseGoogleMapsLink('https://example.com/maps')).toThrow('Google Maps')
    expect(() => parseGoogleMapsLink('javascript:alert(1)')).toThrow('Google Maps')
  })
})
