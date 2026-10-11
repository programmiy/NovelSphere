/**
 * LANOVEL Steampunk Mechanical & Ambient Sound Engine (v2.0)
 * Studio High-Fidelity Audio - Real acoustic typewriter, brass switches, paper flips, and soothing ASMR.
 * Replaces synthetic beep oscillators with zero-latency authentic audio samples.
 */
(function (window) {
    'use strict';

    class SteampunkSoundEngine {
        constructor() {
            this.storageKey = 'lanovel_steampunk_sound';
            this.storageAmbientKey = 'lanovel_ambient_track';
            this.storageAmbientVolKey = 'lanovel_ambient_volume';
            this.storageSfxVolKey = 'lanovel_sfx_volume';

            const savedSfx = localStorage.getItem(this.storageKey);
            this.enabled = savedSfx !== 'false';

            this.sfxVolume = parseFloat(localStorage.getItem(this.storageSfxVolKey) || '0.65');
            this.ambientVolume = parseFloat(localStorage.getItem(this.storageAmbientVolKey) || '0.45');
            this.currentAmbientTrack = localStorage.getItem(this.storageAmbientKey) || 'none';

            // Audio Asset URLs
            this.ASSETS = {
                key: '/static/audio/typewriter_key.mp3',
                lever: '/static/audio/typewriter_return.mp3',
                page: '/static/audio/page_flip.mp3',
                switch: '/static/audio/switch.wav',
                rain: '/static/audio/rain.wav',
                fireplace: '/static/audio/fireplace.wav',
                library: '/static/audio/library_ambient.wav'
            };

            // Polyphonic pool for typewriter keys (prevents clipping during rapid typing)
            this.keyPool = [];
            this.keyPoolIndex = 0;
            this.poolSize = 8;

            // Ambient audio elements
            this.ambientAudio = null;
            this.ambientFadeInterval = null;

            // Preload SFX
            this._initPools();

            // Auto-unlock audio playback on first user interaction
            this._unlocked = false;
            this._unlockHandler = () => {
                if (this._unlocked) return;
                this._unlocked = true;
                this._resumePlayback();
                window.removeEventListener('click', this._unlockHandler, { capture: true });
                window.removeEventListener('keydown', this._unlockHandler, { capture: true });
            };
            window.addEventListener('click', this._unlockHandler, { capture: true, passive: true });
            window.addEventListener('keydown', this._unlockHandler, { capture: true, passive: true });
        }

        _initPools() {
            try {
                for (let i = 0; i < this.poolSize; i++) {
                    const audio = new Audio(this.ASSETS.key);
                    audio.preload = 'auto';
                    this.keyPool.push(audio);
                }
                this.leverAudio = new Audio(this.ASSETS.lever);
                this.pageAudio = new Audio(this.ASSETS.page);
                this.switchAudio = new Audio(this.ASSETS.switch);

                this.leverAudio.preload = 'auto';
                this.pageAudio.preload = 'auto';
                this.switchAudio.preload = 'auto';
            } catch (e) {
                console.warn('[SoundEngine] Audio pool init warning:', e);
            }
        }

        _resumePlayback() {
            if (this.currentAmbientTrack && this.currentAmbientTrack !== 'none') {
                this.startAmbient(this.currentAmbientTrack, false);
            }
        }

        isEnabled() {
            return this.enabled;
        }

        toggle() {
            this.enabled = !this.enabled;
            localStorage.setItem(this.storageKey, this.enabled ? 'true' : 'false');
            if (this.enabled) {
                this.playSwitch();
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
                btn.setAttribute('title', this.enabled ? '타자기 & 효과음 끄기 (M)' : '타자기 & 효과음 켜기 (M)');
                btn.classList.toggle('active', this.enabled);
            });
        }

        // ==========================================
        // SFX PLAYERS (Realistic Samples with Acoustic Variance)
        // ==========================================

        /**
         * 1. Vintage Mechanical Typewriter Key Strike
         * Pitched with subtle natural human variance (0.94 ~ 1.06x)
         */
        playKeyClick() {
            if (!this.enabled || !this.keyPool.length) return;
            try {
                const audio = this.keyPool[this.keyPoolIndex];
                this.keyPoolIndex = (this.keyPoolIndex + 1) % this.poolSize;

                audio.currentTime = 0;
                audio.volume = Math.max(0, Math.min(1, this.sfxVolume));
                // Micro-variations in pitch for authentic mechanical clatter
                audio.playbackRate = 0.94 + Math.random() * 0.12;
                audio.play().catch(() => {});
            } catch (_) {}
        }

        /**
         * 2. Heavy Typewriter Carriage Return / Mechanical Lever
         */
        playLever() {
            if (!this.enabled || !this.leverAudio) return;
            try {
                this.leverAudio.currentTime = 0;
                this.leverAudio.volume = Math.max(0, Math.min(1, this.sfxVolume * 0.9));
                this.leverAudio.play().catch(() => {});
            } catch (_) {}
        }

        /**
         * 3. Tactile Book Page Flip / Turn
         */
        playPageFlip() {
            if (!this.enabled || !this.pageAudio) return;
            try {
                this.pageAudio.currentTime = 0;
                this.pageAudio.volume = Math.max(0, Math.min(1, this.sfxVolume));
                this.pageAudio.playbackRate = 0.98 + Math.random() * 0.06;
                this.pageAudio.play().catch(() => {});
            } catch (_) {}
        }

        /**
         * 4. Antique Brass Mechanical Switch / Relay
         */
        playSwitch() {
            if (!this.enabled || !this.switchAudio) return;
            try {
                this.switchAudio.currentTime = 0;
                this.switchAudio.volume = Math.max(0, Math.min(1, this.sfxVolume * 0.75));
                this.switchAudio.playbackRate = 0.96 + Math.random() * 0.08;
                this.switchAudio.play().catch(() => {});
            } catch (_) {}
        }

        // ==========================================
        // AMBIENT ASMR SOUND ENGINE
        // ==========================================

        getAmbientTrack() {
            return this.currentAmbientTrack;
        }

        setAmbientVolume(vol) {
            this.ambientVolume = Math.max(0, Math.min(1, parseFloat(vol)));
            localStorage.setItem(this.storageAmbientVolKey, this.ambientVolume.toString());
            if (this.ambientAudio && !this.ambientFadeInterval) {
                this.ambientAudio.volume = this.ambientVolume;
            }
        }

        setSfxVolume(vol) {
            this.sfxVolume = Math.max(0, Math.min(1, parseFloat(vol)));
            localStorage.setItem(this.storageSfxVolKey, this.sfxVolume.toString());
        }

        startAmbient(trackName, savePreference = true) {
            if (!trackName || trackName === 'none') {
                this.stopAmbient(savePreference);
                return;
            }

            const assetUrl = this.ASSETS[trackName];
            if (!assetUrl) return;

            if (savePreference) {
                this.currentAmbientTrack = trackName;
                localStorage.setItem(this.storageAmbientKey, trackName);
            }

            if (this.ambientAudio) {
                if (this.ambientAudio.dataset.track === trackName && !this.ambientAudio.paused) {
                    return; // Already playing
                }
                this._fadeOutAudio(this.ambientAudio, () => {
                    this._playNewAmbient(assetUrl, trackName);
                });
            } else {
                this._playNewAmbient(assetUrl, trackName);
            }

            this._notifyAmbientChange();
        }

        _playNewAmbient(assetUrl, trackName) {
            try {
                const audio = new Audio(assetUrl);
                audio.loop = true;
                audio.dataset.track = trackName;
                audio.volume = 0;
                this.ambientAudio = audio;

                const promise = audio.play();
                if (promise !== undefined) {
                    promise.then(() => {
                        this._fadeInAudio(audio, this.ambientVolume);
                    }).catch(err => {
                        console.log('[SoundEngine] Autoplay waiting for gesture:', err.message);
                    });
                }
            } catch (e) {
                console.warn('[SoundEngine] Ambient play error:', e);
            }
        }

        _fadeInAudio(audio, targetVolume, durationMs = 600) {
            clearInterval(this.ambientFadeInterval);
            const stepMs = 50;
            const steps = durationMs / stepMs;
            let currentStep = 0;

            this.ambientFadeInterval = setInterval(() => {
                currentStep++;
                const vol = Math.min(targetVolume, (currentStep / steps) * targetVolume);
                if (audio) audio.volume = vol;
                if (currentStep >= steps) {
                    clearInterval(this.ambientFadeInterval);
                    this.ambientFadeInterval = null;
                }
            }, stepMs);
        }

        _fadeOutAudio(audio, onComplete, durationMs = 500) {
            clearInterval(this.ambientFadeInterval);
            const initialVolume = audio.volume;
            const stepMs = 50;
            const steps = durationMs / stepMs;
            let currentStep = 0;

            this.ambientFadeInterval = setInterval(() => {
                currentStep++;
                const vol = Math.max(0, initialVolume * (1 - currentStep / steps));
                if (audio) audio.volume = vol;
                if (currentStep >= steps) {
                    clearInterval(this.ambientFadeInterval);
                    this.ambientFadeInterval = null;
                    audio.pause();
                    if (onComplete) onComplete();
                }
            }, stepMs);
        }

        stopAmbient(savePreference = true) {
            if (savePreference) {
                this.currentAmbientTrack = 'none';
                localStorage.setItem(this.storageAmbientKey, 'none');
            }
            if (this.ambientAudio) {
                this._fadeOutAudio(this.ambientAudio, () => {
                    this.ambientAudio = null;
                });
            }
            this._notifyAmbientChange();
        }

        cycleAmbient() {
            const tracks = ['none', 'rain', 'fireplace', 'library'];
            const idx = tracks.indexOf(this.currentAmbientTrack);
            const nextTrack = tracks[(idx + 1) % tracks.length];
            this.startAmbient(nextTrack, true);
            return nextTrack;
        }

        _notifyAmbientChange() {
            window.dispatchEvent(new CustomEvent('lanovel:ambient-changed', {
                detail: { track: this.currentAmbientTrack, volume: this.ambientVolume }
            }));
            this._updateAmbientButtons();
        }

        _updateAmbientButtons() {
            const labels = {
                none: '배경음 꺼짐',
                rain: '심야 빗소리',
                fireplace: '벽난로 모닥불',
                library: '고풍 서재 앰비언트'
            };
            const icons = {
                none: 'headphones',
                rain: 'water_drop',
                fireplace: 'local_fire_department',
                library: 'menu_book'
            };

            document.querySelectorAll('#ambient-sound-btn, .ambient-toggle-btn').forEach(btn => {
                const icon = btn.querySelector('.material-icons');
                if (icon) {
                    icon.textContent = icons[this.currentAmbientTrack] || 'headphones';
                }
                const labelText = labels[this.currentAmbientTrack] || '배경음 꺼짐';
                btn.setAttribute('title', `앰비언트 ASMR: ${labelText} (B 누르면 전환)`);
                btn.classList.toggle('active', this.currentAmbientTrack !== 'none');
            });
        }

        /**
         * Auto-attach sounds to common interactive elements
         */
        attachAutoSounds() {
            // Click listener for buttons, links, tabs, and cards
            document.addEventListener('click', (e) => {
                const target = e.target.closest('button, a, .book-card, .status-tab-btn, .theme-chip, .view-mode-btn, .stat-card, input[type="radio"], input[type="checkbox"], .nav-arrow');
                if (!target) return;

                if (target.matches('.steampunk-sound-toggle-btn')) {
                    this.toggle();
                    return;
                }

                if (target.matches('#next-page-btn, #prev-page-btn, .nav-arrow, #toc-next-chapter-btn, #toc-prev-chapter-btn')) {
                    this.playPageFlip();
                } else if (target.matches('.status-tab-btn, .view-mode-btn, .theme-chip, .segment-btn, .ambient-chip')) {
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
            this._updateAmbientButtons();
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
