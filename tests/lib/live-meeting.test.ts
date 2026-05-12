import { describe, expect, it } from 'vitest';
import {
  getAllowedZoomMeetingHosts,
  isAllowedZoomMeetingHost,
  validateZoomMeetingUrl,
} from '@/lib/utils/live-meeting';

describe('live meeting utilities', () => {
  it('accepts Zoom and ZoomGov HTTPS join links on allowed subdomains', () => {
    expect(validateZoomMeetingUrl('https://us02web.zoom.us/j/123456789?pwd=abc')).toEqual({
      ok: true,
      url: 'https://us02web.zoom.us/j/123456789?pwd=abc',
    });
    expect(validateZoomMeetingUrl('https://agency.zoomgov.com/j/123456789')).toEqual({
      ok: true,
      url: 'https://agency.zoomgov.com/j/123456789',
    });
  });

  it('rejects non-HTTPS and non-Zoom links', () => {
    expect(validateZoomMeetingUrl('http://zoom.us/j/123').ok).toBe(false);
    expect(validateZoomMeetingUrl('https://meet.example.com/j/123').ok).toBe(false);
    expect(validateZoomMeetingUrl('https://evilzoom.us/j/123').ok).toBe(false);
  });

  it('rejects generic Zoom pages that are not attendee invite links', () => {
    expect(validateZoomMeetingUrl('https://zoom.us/profile').ok).toBe(false);
    expect(validateZoomMeetingUrl('https://zoom.us/signin').ok).toBe(false);
    expect(validateZoomMeetingUrl('https://zoom.us/join').ok).toBe(false);
    expect(validateZoomMeetingUrl('https://zoom.us/j/not-a-meeting').ok).toBe(false);
  });

  it('rejects host start links and credentialed URLs', () => {
    expect(validateZoomMeetingUrl('https://zoom.us/s/123456789?zak=secret').ok).toBe(false);
    expect(validateZoomMeetingUrl('https://zoom.us/start/videomeeting').ok).toBe(false);
    expect(validateZoomMeetingUrl('https://user:pass@zoom.us/j/123456789').ok).toBe(false);
  });

  it('supports environment allowlist overrides', () => {
    expect(getAllowedZoomMeetingHosts('video.example.edu, zoom.example.edu')).toEqual([
      'video.example.edu',
      'zoom.example.edu',
    ]);
    expect(
      validateZoomMeetingUrl('https://class.video.example.edu/j/123456789', {
        envAllowedHosts: 'video.example.edu',
      }).ok,
    ).toBe(true);
    expect(isAllowedZoomMeetingHost('sub.zoom.example.edu', ['zoom.example.edu'])).toBe(true);
  });
});
