import { describe, expect, it } from 'vitest';
import {
  getBrowserLocalTargetAddressSpace,
  hasHostedLocalProviderTopologyMismatch,
  isHostedOrigin,
  isLocalOnlyProvider,
  isLocalOrPrivateBaseUrl,
  isLocalOrPrivateHostname,
  isLoopbackHostname,
} from '@/lib/utils/url';

describe('url topology helpers', () => {
  it('classifies local and private hostnames', () => {
    expect(isLocalOrPrivateHostname('localhost')).toBe(true);
    expect(isLocalOrPrivateHostname('127.0.0.1')).toBe(true);
    expect(isLocalOrPrivateHostname('app.localhost')).toBe(true);
    expect(isLocalOrPrivateHostname('printer.local')).toBe(true);
    expect(isLocalOrPrivateHostname('192.168.1.5')).toBe(true);
    expect(isLocalOrPrivateHostname('10.0.0.8')).toBe(true);
    expect(isLocalOrPrivateHostname('172.16.10.2')).toBe(true);
    expect(isLocalOrPrivateHostname('169.254.1.20')).toBe(true);
    expect(isLocalOrPrivateHostname('::1')).toBe(true);
    expect(isLocalOrPrivateHostname('fc00::1')).toBe(true);
    expect(isLocalOrPrivateHostname('fe80::1')).toBe(true);
    expect(isLocalOrPrivateHostname('open-raic.com')).toBe(false);
  });

  it('classifies loopback hostnames separately from other local addresses', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('app.localhost')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('192.168.1.5')).toBe(false);
    expect(isLoopbackHostname('printer.local')).toBe(false);
  });

  it('classifies local and private base URLs', () => {
    expect(isLocalOrPrivateBaseUrl('http://localhost:1234/v1')).toBe(true);
    expect(isLocalOrPrivateBaseUrl('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLocalOrPrivateBaseUrl('http://192.168.1.25:8080')).toBe(true);
    expect(isLocalOrPrivateBaseUrl('http://[::1]:1234/v1')).toBe(true);
    expect(isLocalOrPrivateBaseUrl('https://api.example.com/v1')).toBe(false);
    expect(isLocalOrPrivateBaseUrl('not-a-url')).toBe(false);
  });

  it('maps browser-local target address spaces from base URLs', () => {
    expect(getBrowserLocalTargetAddressSpace('http://localhost:1234/v1')).toBe('loopback');
    expect(getBrowserLocalTargetAddressSpace('http://127.0.0.1:1234/v1')).toBe('loopback');
    expect(getBrowserLocalTargetAddressSpace('http://[::1]:1234/v1')).toBe('loopback');
    expect(getBrowserLocalTargetAddressSpace('http://192.168.1.25:8080')).toBe('local');
    expect(getBrowserLocalTargetAddressSpace('http://printer.local')).toBe('local');
    expect(getBrowserLocalTargetAddressSpace('https://api.example.com/v1')).toBeNull();
  });

  it('distinguishes hosted origins from local origins', () => {
    expect(isHostedOrigin('open-raic.com')).toBe(true);
    expect(isHostedOrigin('localhost')).toBe(false);
    expect(isHostedOrigin('192.168.1.22')).toBe(false);
  });

  it('tracks local-only providers', () => {
    expect(isLocalOnlyProvider('lmstudio')).toBe(true);
    expect(isLocalOnlyProvider('ollama')).toBe(true);
    expect(isLocalOnlyProvider('openai')).toBe(false);
  });

  it('flags hosted-to-local topology mismatches for local-only providers', () => {
    expect(
      hasHostedLocalProviderTopologyMismatch({
        providerId: 'lmstudio',
        originHostname: 'open-raic.com',
        baseUrl: 'http://127.0.0.1:1234/v1',
      }),
    ).toBe(true);

    expect(
      hasHostedLocalProviderTopologyMismatch({
        providerId: 'lmstudio',
        originHostname: 'localhost',
        baseUrl: 'http://127.0.0.1:1234/v1',
      }),
    ).toBe(false);

    expect(
      hasHostedLocalProviderTopologyMismatch({
        providerId: 'openai',
        originHostname: 'open-raic.com',
        baseUrl: 'https://api.example.com/v1',
      }),
    ).toBe(false);
  });
});
