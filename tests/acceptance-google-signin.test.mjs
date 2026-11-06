import { describe, expect, it } from 'vitest';
import { SignInStop, parseOtpSeed, totp } from '../scripts/acceptance/google-signin.mjs';

// RFC 6238 appendix B, SHA-1 seed "12345678901234567890".
const RFC_SEED_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('google-signin one-time codes', () => {
  it('matches the RFC 6238 SHA-1 vectors', () => {
    const seed = { ...parseOtpSeed(RFC_SEED_BASE32), digits: 8 };
    expect(totp(seed, 59_000)).toBe('94287082');
    expect(totp(seed, 1_111_111_109_000)).toBe('07081804');
    expect(totp(seed, 20_000_000_000_000)).toBe('65353130');
  });

  it('reads an otpauth URI with its digits and period', () => {
    const seed = parseOtpSeed(`otpauth://totp/Google:a%40example.com?secret=${RFC_SEED_BASE32}&issuer=Google&digits=8&period=30`);
    expect(seed.digits).toBe(8);
    expect(seed.period).toBe(30);
    expect(totp(seed, 59_000)).toBe('94287082');
  });

  it('accepts a spaced, lower-case key as 1Password shows it', () => {
    const spaced = RFC_SEED_BASE32.toLowerCase().replace(/(.{4})/g, '$1 ');
    expect(totp(parseOtpSeed(spaced), 59_000)).toBe('287082');
  });

  it('stops with a named reason on a missing or invalid seed', () => {
    expect(() => parseOtpSeed('')).toThrow(SignInStop);
    expect(() => parseOtpSeed('not base32 !')).toThrow('otp-seed-invalid');
    expect(() => parseOtpSeed('otpauth://totp/x?issuer=Google')).toThrow('otp-seed-invalid');
  });
});
