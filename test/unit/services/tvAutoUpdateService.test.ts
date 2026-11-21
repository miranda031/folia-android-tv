// @vitest-environment jsdom
// test/unit/services/tvAutoUpdateService.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { compareFoliaVersions, normalizeVersionTag, useTvUpdateStore } from '../../../src/services/tvAutoUpdateService';

describe('tvAutoUpdateService', () => {
    beforeEach(() => {
        localStorage.clear();
        useTvUpdateStore.setState({
            enableUpdateCheck: true,
            enableAutoUpdate: true,
            useMirrorAcceleration: true,
            ignoredVersion: null,
            status: 'idle',
            latestVersion: null,
            isUpdateModalOpen: false,
        });
    });

    it('normalizes version tags by stripping leading v/V', () => {
        expect(normalizeVersionTag('v0.7.25-tv.16')).toBe('0.7.25-tv.16');
        expect(normalizeVersionTag('V0.8.0')).toBe('0.8.0');
        expect(normalizeVersionTag('0.7.25-tv.15')).toBe('0.7.25-tv.15');
    });

    it('accurately compares semver and -tv.N suffix build numbers', () => {
        expect(compareFoliaVersions('v0.7.25-tv.16', '0.7.25-tv.15')).toBeGreaterThan(0);
        expect(compareFoliaVersions('0.7.25-tv.15', '0.7.25-tv.16')).toBeLessThan(0);
        expect(compareFoliaVersions('0.7.25-tv.16', '0.7.25-tv.16')).toBe(0);
        expect(compareFoliaVersions('v0.8.0', '0.7.25-tv.99')).toBeGreaterThan(0);
        expect(compareFoliaVersions('0.7.26-tv.1', '0.7.25-tv.20')).toBeGreaterThan(0);
    });

    it('persists auto-update preferences to localStorage', () => {
        const store = useTvUpdateStore.getState();
        store.setEnableUpdateCheck(false);
        expect(useTvUpdateStore.getState().enableUpdateCheck).toBe(false);
        expect(localStorage.getItem('folia_tv_enable_update_check')).toBe('false');

        store.setEnableAutoUpdate(false);
        expect(useTvUpdateStore.getState().enableAutoUpdate).toBe(false);
        expect(localStorage.getItem('folia_tv_enable_auto_update')).toBe('false');

        store.setUseMirrorAcceleration(false);
        expect(useTvUpdateStore.getState().useMirrorAcceleration).toBe(false);
        expect(localStorage.getItem('folia_tv_update_mirror_accel')).toBe('false');
    });
});
