// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useI18n } from '../i18n';
import { fmtTimeAgo, fmtAbsolute } from '../utils/format';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => Date.now() - ms;

describe('fmtTimeAgo', () => {
  beforeEach(() => {
    useI18n.getState().setPref('zh-CN');
  });

  it('renders a coarse relative label in zh-CN', () => {
    expect(fmtTimeAgo(ago(5 * SEC))).toBe('刚刚');
    expect(fmtTimeAgo(ago(59 * SEC))).toBe('刚刚');
    expect(fmtTimeAgo(ago(2 * MIN))).toBe('2 分钟前');
    expect(fmtTimeAgo(ago(3 * HOUR))).toBe('3 小时前');
    expect(fmtTimeAgo(ago(5 * DAY))).toBe('5 天前');
    expect(fmtTimeAgo(ago(70 * DAY))).toBe('2 个月前');
    expect(fmtTimeAgo(ago(800 * DAY))).toBe('2 年前');
  });

  it('uses a single space before the unit in English', () => {
    useI18n.getState().setPref('en');
    expect(fmtTimeAgo(ago(5 * SEC))).toBe('just now');
    expect(fmtTimeAgo(ago(2 * MIN))).toBe('2 minutes ago');
    expect(fmtTimeAgo(ago(3 * HOUR))).toBe('3 hours ago');
    expect(fmtTimeAgo(ago(5 * DAY))).toBe('5 days ago');
    expect(fmtTimeAgo(ago(70 * DAY))).toBe('2 months ago');
    expect(fmtTimeAgo(ago(800 * DAY))).toBe('2 years ago');
  });

  it('converts units to Traditional Chinese', () => {
    useI18n.getState().setPref('zh-TW');
    expect(fmtTimeAgo(ago(2 * MIN))).toBe('2 分鐘前');
    expect(fmtTimeAgo(ago(5 * DAY))).toBe('5 天前');
  });

  it('accepts ISO strings and returns "-" for unusable input', () => {
    expect(fmtTimeAgo(new Date(ago(2 * HOUR)).toISOString())).toBe('2 小时前');
    expect(fmtTimeAgo(undefined)).toBe('-');
    expect(fmtTimeAgo('')).toBe('-');
    expect(fmtTimeAgo('not-a-date')).toBe('-');
    expect(fmtTimeAgo(NaN)).toBe('-');
  });

  it('treats future timestamps as "just now" rather than a negative age', () => {
    expect(fmtTimeAgo(Date.now() + 10 * MIN)).toBe('刚刚');
  });
});

describe('fmtAbsolute', () => {
  it('renders an exact local timestamp for the hover title', () => {
    const out = fmtAbsolute(ago(DAY));
    expect(out).not.toBe('-');
    expect(out).toMatch(/\d{4}/);
  });

  it('returns "-" for unusable input', () => {
    expect(fmtAbsolute(undefined)).toBe('-');
    expect(fmtAbsolute('nope')).toBe('-');
  });
});
