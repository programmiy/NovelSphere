/**
 * LANOVEL Steampunk Mechanical Sound Engine (v1.0)
 * Pure Web Audio API Synthesizer - Ultra lightweight, zero external audio dependencies.
 * Synthesizes analog typewriter keystrokes, carriage returns, brass switches, and relays.
 */
(function (window) {
    'use strict';

    class SteampunkSoundEngine {
        constructor() {
            this.ctx = null;
            this.storageKey = 'lanovel_steampunk_sound';
            const saved = localStorage.getItem(this.storageKey);
            // Enabled by default unless explicitly turned off
            this.enabled = saved !== 'false';

            // Auto-unlock Web Audio on first user interaction
            this._unlockHandler = () => {
                this.ensureContext();
                window.removeEventListener('click', this._unlockHandler, { capture: true });
                window.removeEventListener('keydown', this._unlockHandler, { capture: true });
            };
            window.addEventListener('click', this._unlockHandler, { capture: true, passive: true });
            window.addEventListener('keydown', this._unlockHandler, { capture: true, passive: true });
        }

        ensureContext() {
            if (!this.ctx && typeof AudioContext !== 'undefined') {
                try {
                    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                } catch (e) {
                    console.warn('[SteampunkSound] AudioContext init failed:', e);
                }
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
            return this.ctx;
        }

        isEnabled() {
            return this.enabled;
        }

        toggle() {
            this.ensureContext();
            this.enabled = !this.enabled;
            localStorage.setItem(this.storageKey, this.enabled ? 'true' : 'false');
            if (this.enabled) {
                this.playLever();
            }
            this.updateToggleButtons();
            return this.enabled;
        }

        updateToggleButtons() {
            document.querySelectorAll('.steampunk-sound-toggle-btn').forEach(btn => {
                const icon = btn.querySelector('.material-icons');
                if (icon) {
                    icon.textContent = this.enabled ? 'volume_up' : 'volume_off';
                }
                btn.setAttribute('title', this.enabled ? '타자기 사운드 끄기' : '타자기 사운드 켜기');
                btn.classList.toggle('active', this.enabled);
            });
        }

        /**
         * 1. Vintage Typewriter Keystroke
         * Crisp mechanical hammer strike with body resonance and spring recoil
         */
        playKeyClick() {
            if (!this.enabled) return;
            const ctx = this.ensureContext();
            if (!ctx) return;

            try {
                const now = ctx.currentTime;
                // High transient mechanical impact (noise burst)
                const bufferSize = Math.floor(ctx.sampleRate * 0.025); // 25ms
                const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                const output = noiseBuffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.2));
                }

                const noise = ctx.createBufferSource();
                noise.buffer = noiseBuffer;

                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.value = 2400 + (Math.random() * 400 - 200);
                filter.Q.value = 3.5;

                const noiseGain = ctx.createGain();
                noiseGain.gain.setValueAtTime(0.35, now);
                noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

                noise.connect(filter);
                filter.connect(noiseGain);
                noiseGain.connect(ctx.destination);
                noise.start(now);

                // Metallic body thud (low pitch damped sine)
                const osc = ctx.createOscillator();
                const oscGain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(320 + Math.random() * 30, now);
                osc.frequency.exponentialRampToValueAtTime(110, now + 0.035);

                oscGain.gain.setValueAtTime(0.25, now);
                oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

                osc.connect(oscGain);
                oscGain.connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.04);
            } catch (_) {}
        }

        /**
         * 2. Mechanical Switch / Brass Button Click
         * Tactile snap of a copper/brass toggle lever
         */
        playSwitch() {
            if (!this.enabled) return;
            const ctx = this.ensureContext();
            if (!ctx) return;

            try {
                const now = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'square';
                osc.frequency.setValueAtTime(800 + Math.random() * 80, now);
                osc.frequency.exponentialRampToValueAtTime(200, now + 0.02);

                gain.gain.setValueAtTime(0.18, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.025);
            } catch (_) {}
        }

        /**
         * 3. Carriage Return / Page Flip Mechanical Lever
         * Double-ratchet sweep of typewriter carriage lever
         */
        playLever() {
            if (!this.enabled) return;
            const ctx = this.ensureContext();
            if (!ctx) return;

            try {
                const now = ctx.currentTime;
                // Two successive clicks with mechanical ratchet
                [0, 0.035].forEach((delay, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(idx === 0 ? 950 : 1300, now + delay);
                    osc.frequency.exponentialRampToValueAtTime(350, now + delay + 0.025);

                    gain.gain.setValueAtTime(0.15, now + delay);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.025);

                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + delay);
                    osc.stop(now + delay + 0.03);
                });
            } catch (_) {}
        }

        /**
         * Auto-attach sounds to common interactive elements
         */
        attachAutoSounds() {
            // Click listener for buttons, links, tabs, and cards
            document.addEventListener('click', (e) => {
                const target = e.target.closest('button, a, .book-card, .status-tab-btn, .theme-chip, .view-mode-btn, .stat-card, input[type="radio"], input[type="checkbox"]');
                if (!target) return;

                if (target.matches('.steampunk-sound-toggle-btn')) {
                    this.toggle();
                    return;
                }

                if (target.matches('#next-page-btn, #prev-page-btn, .nav-arrow, #toc-next-chapter-btn, #toc-prev-chapter-btn')) {
                    this.playLever();
                } else if (target.matches('.status-tab-btn, .view-mode-btn, .theme-chip')) {
                    this.playSwitch();
                } else {
                    this.playKeyClick();
                }
            }, { passive: true });

            // Keyboard typing in inputs
            document.addEventListener('keydown', (e) => {
                const target = e.target;
                if (!target || !target.matches('input[type="text"], input[type="search"], textarea, [contenteditable="true"]')) return;
                // Ignore modifier keys
                if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) return;

                if (e.key === 'Enter') {
                    this.playLever();
                } else {
                    this.playKeyClick();
                }
            }, { passive: true });

            // Initial UI sync
            this.updateToggleButtons();
        }
    }

    // Expose global instance
    const engine = new SteampunkSoundEngine();
    window.SteampunkSound = engine;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => engine.attachAutoSounds());
    } else {
        engine.attachAutoSounds();
    }
})(window);
