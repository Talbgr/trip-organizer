import { describe, expect, it } from 'vitest';
import { cleanPlaceName, directionsUrl, iosAppUrl, isIos, navQuery } from '../web/src/nav.ts';

describe('navigation links', () => {
  it('searches the place name together with its city', () => {
    expect(navQuery('Kabukicho', { cityId: 'tokyo' })).toBe('Kabukicho Tokyo');
    expect(navQuery('Ryokan', { location: 'קו לאנטה' })).toBe('Ryokan Koh Lanta');
    expect(navQuery('Gonpachi', {})).toBe('Gonpachi Japan');
  });

  it('drops the workbook\'s "שולם" from hotel names', () => {
    expect(cleanPlaceName('Agora kyoto shijo\nשולם\n')).toBe('Agora kyoto shijo');
    expect(cleanPlaceName('NOGHA HOTEL HAKIHABARA TOKYO          שולם\n')).toBe('NOGHA HOTEL HAKIHABARA TOKYO');
  });

  it('builds Google Maps directions links', () => {
    expect(directionsUrl('Golden Gai Tokyo')).toBe('https://www.google.com/maps/dir/?api=1&destination=Golden%20Gai%20Tokyo');
    expect(iosAppUrl('Golden Gai Tokyo')).toBe('comgooglemaps://?daddr=Golden%20Gai%20Tokyo');
  });

  it('recognizes iPhones (and iPads that report a Mac)', () => {
    expect(isIos({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)' })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: 'Mozilla/5.0 (Linux; Android 15)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
  });
});
