// @vitest-environment jsdom
// test/unit/services/tvPlaybackPromptNavigation.test.ts
// 电视遥控器导航与首次启动资料库界面选择弹窗（PlaybackEntryViewPrompt）集成测试

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasActiveTvOverlayOrHigherView, dispatchTvKeyCapture } from '../../../src/services/tvNavigationEngine';

describe('tvNavigationEngine - PlaybackEntryViewPrompt', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('identifies playback prompt as an active TV overlay so background Home navigation yields', () => {
        expect(hasActiveTvOverlayOrHigherView()).toBe(false);

        const prompt = document.createElement('div');
        prompt.setAttribute('data-folia-playback-prompt', 'true');
        prompt.setAttribute('data-testid', 'playback-entry-view-prompt');
        // Give it non-zero bounding rect so queryTopmostVisible considers it visible
        vi.spyOn(prompt, 'getBoundingClientRect').mockReturnValue({
            width: 500,
            height: 400,
            top: 100,
            left: 200,
            bottom: 500,
            right: 700,
            x: 200,
            y: 100,
            toJSON: () => ({}),
        });
        container.appendChild(prompt);

        expect(hasActiveTvOverlayOrHigherView()).toBe(true);
    });

    it('intercepts Escape on playback prompt and clicks confirm button to dismiss without trapping user', () => {
        const prompt = document.createElement('div');
        prompt.setAttribute('data-folia-playback-prompt', 'true');
        prompt.setAttribute('data-testid', 'playback-entry-view-prompt');
        vi.spyOn(prompt, 'getBoundingClientRect').mockReturnValue({
            width: 500,
            height: 400,
            top: 100,
            left: 200,
            bottom: 500,
            right: 700,
            x: 200,
            y: 100,
            toJSON: () => ({}),
        });

        const confirmBtn = document.createElement('button');
        confirmBtn.setAttribute('data-testid', 'playback-entry-view-prompt-confirm');
        vi.spyOn(confirmBtn, 'getBoundingClientRect').mockReturnValue({
            width: 100,
            height: 40,
            top: 400,
            left: 550,
            bottom: 440,
            right: 650,
            x: 550,
            y: 400,
            toJSON: () => ({}),
        });
        const confirmSpy = vi.fn();
        confirmBtn.onclick = confirmSpy;
        prompt.appendChild(confirmBtn);
        container.appendChild(prompt);

        const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        const handled = dispatchTvKeyCapture(escapeEvent);

        expect(handled).toBe(true);
        expect(confirmSpy).toHaveBeenCalledTimes(1);
    });

    it('intercepts Escape on page 2 and clicks back button to return to page 1', () => {
        const prompt = document.createElement('div');
        prompt.setAttribute('data-folia-playback-prompt', 'true');
        prompt.setAttribute('data-testid', 'playback-entry-view-prompt');
        vi.spyOn(prompt, 'getBoundingClientRect').mockReturnValue({
            width: 500,
            height: 400,
            top: 100,
            left: 200,
            bottom: 500,
            right: 700,
            x: 200,
            y: 100,
            toJSON: () => ({}),
        });

        const backBtn = document.createElement('button');
        backBtn.setAttribute('data-testid', 'playback-entry-view-prompt-back');
        vi.spyOn(backBtn, 'getBoundingClientRect').mockReturnValue({
            width: 80,
            height: 40,
            top: 400,
            left: 450,
            bottom: 440,
            right: 530,
            x: 450,
            y: 400,
            toJSON: () => ({}),
        });
        const backSpy = vi.fn();
        backBtn.onclick = backSpy;
        prompt.appendChild(backBtn);

        const confirmBtn = document.createElement('button');
        confirmBtn.setAttribute('data-testid', 'playback-entry-view-prompt-confirm');
        vi.spyOn(confirmBtn, 'getBoundingClientRect').mockReturnValue({
            width: 100,
            height: 40,
            top: 400,
            left: 550,
            bottom: 440,
            right: 650,
            x: 550,
            y: 400,
            toJSON: () => ({}),
        });
        prompt.appendChild(confirmBtn);
        container.appendChild(prompt);

        const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        const handled = dispatchTvKeyCapture(escapeEvent);

        expect(handled).toBe(true);
        expect(backSpy).toHaveBeenCalledTimes(1);
    });

    it('navigates D-pad focus into prompt and between choices when arrow keys are pressed', () => {
        const prompt = document.createElement('div');
        prompt.setAttribute('data-folia-playback-prompt', 'true');
        prompt.setAttribute('data-testid', 'playback-entry-view-prompt');
        vi.spyOn(prompt, 'getBoundingClientRect').mockReturnValue({
            width: 600,
            height: 400,
            top: 100,
            left: 100,
            bottom: 500,
            right: 700,
            x: 100,
            y: 100,
            toJSON: () => ({}),
        });

        const card1 = document.createElement('button');
        card1.setAttribute('data-onboarding-library-suite', 'grid');
        vi.spyOn(card1, 'getBoundingClientRect').mockReturnValue({
            width: 200,
            height: 150,
            top: 150,
            left: 120,
            bottom: 300,
            right: 320,
            x: 120,
            y: 150,
            toJSON: () => ({}),
        });

        const card2 = document.createElement('button');
        card2.setAttribute('data-onboarding-library-suite', 'bravais');
        vi.spyOn(card2, 'getBoundingClientRect').mockReturnValue({
            width: 200,
            height: 150,
            top: 150,
            left: 360,
            bottom: 300,
            right: 560,
            x: 360,
            y: 150,
            toJSON: () => ({}),
        });

        prompt.appendChild(card1);
        prompt.appendChild(card2);
        container.appendChild(prompt);

        // When focus is not inside the prompt, pressing ArrowRight immediately focuses the first element
        const rightEvent1 = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
        dispatchTvKeyCapture(rightEvent1);
        expect(document.activeElement).toBe(card1);

        // Next ArrowRight moves focus spatially to card2
        const rightEvent2 = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
        dispatchTvKeyCapture(rightEvent2);
        expect(document.activeElement).toBe(card2);

        // ArrowLeft moves back to card1
        const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
        dispatchTvKeyCapture(leftEvent);
        expect(document.activeElement).toBe(card1);
    });
});
