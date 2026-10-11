/**
 * LANOVEL Translation Admin Dashboard - Ultra Cybernetic FX & Dynamic Engine
 * Maximum visual luxury, GPU/CPU accelerated particle matrix, 3D hologram tilt,
 * shockwave ripples, and synthesizer audio feedback.
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. Cyber High-Fidelity Audio & Ambient Engine (Studio Sample Based)
    // =========================================================================
    const CYBER_AUDIO_ASSETS = {
        click: '/static/audio/cyber_click.mp3',
        hover: '/static/audio/cyber_hover.mp3',
        powerup: '/static/audio/cyber_powerup.mp3',
        success: '/static/audio/cyber_success.mp3',
        warning: '/static/audio/cyber_warning.mp3',
        toggle: '/static/audio/cyber_toggle.mp3',
        pulse: '/static/audio/cyber_notify.mp3',
        drone: '/static/audio/cyber_drone.mp3',
        rain: '/static/audio/rain.wav',
        library: '/static/audio/library_ambient.wav',
        fireplace: '/static/audio/fireplace.wav'
    };

    const AMBIENT_TRACK_LIST = [
        { id: 'none', label: '배경음: 끄기', icon: 'headphones' },
        { id: 'drone', label: '퀀텀 드론 (Lo-Fi)', icon: 'graphic_eq' },
        { id: 'rain', label: '사이버 빗소리', icon: 'water_drop' },
        { id: 'library', label: '나이트 룸 (서재)', icon: 'nights_stay' },
        { id: 'fireplace', label: '따스한 불꽃', icon: 'local_fire_department' }
    ];

    class SoundEngine {
        constructor() {
            this.storageKey = 'lanovel_cyber_sound';
            this.storageAmbientKey = 'lanovel_cyber_ambient_track';
            this.storageAmbientVolKey = 'lanovel_cyber_ambient_vol';
            this.storageSfxVolKey = 'lanovel_cyber_sfx_vol';

            const savedSfx = localStorage.getItem(this.storageKey);
            this.enabled = savedSfx !== 'false';

            this.sfxVolume = parseFloat(localStorage.getItem(this.storageSfxVolKey) || '0.5');
            this.ambientVolume = parseFloat(localStorage.getItem(this.storageAmbientVolKey) || '0.45');
            this.currentAmbientTrack = localStorage.getItem(this.storageAmbientKey) || 'none';

            // Polyphonic pool for click/hover to allow fast, non-clipping feedback
            this.clickPool = [];
            this.clickIndex = 0;
            this.clickPoolSize = 6;

            this.hoverPool = [];
            this.hoverIndex = 0;
            this.hoverPoolSize = 4;
            this.lastHoverTime = 0;

            // Ambient audio elements
            this.ambientAudio = null;
            this.ambientFadeInterval = null;

            this._initPools();

            // Auto-unlock audio playback on first user gesture
            this._unlocked = false;
            this._unlockHandler = () => {
                if (this._unlocked) return;
                this._unlocked = true;
                if (this.currentAmbientTrack && this.currentAmbientTrack !== 'none') {
                    this.startAmbient(this.currentAmbientTrack, false);
                }
                window.removeEventListener('click', this._unlockHandler, { capture: true });
                window.removeEventListener('keydown', this._unlockHandler, { capture: true });
            };
            window.addEventListener('click', this._unlockHandler, { capture: true, passive: true });
            window.addEventListener('keydown', this._unlockHandler, { capture: true, passive: true });
        }

        _initPools() {
            try {
                for (let i = 0; i < this.clickPoolSize; i++) {
                    const a = new Audio(CYBER_AUDIO_ASSETS.click);
                    a.preload = 'auto';
                    this.clickPool.push(a);
                }
                for (let i = 0; i < this.hoverPoolSize; i++) {
                    const a = new Audio(CYBER_AUDIO_ASSETS.hover);
                    a.preload = 'auto';
                    this.hoverPool.push(a);
                }
                this.powerupAudio = new Audio(CYBER_AUDIO_ASSETS.powerup);
                this.successAudio = new Audio(CYBER_AUDIO_ASSETS.success);
                this.warningAudio = new Audio(CYBER_AUDIO_ASSETS.warning);
                this.toggleAudio = new Audio(CYBER_AUDIO_ASSETS.toggle);
                this.pulseAudio = new Audio(CYBER_AUDIO_ASSETS.pulse);

                this.powerupAudio.preload = 'auto';
                this.successAudio.preload = 'auto';
                this.warningAudio.preload = 'auto';
                this.toggleAudio.preload = 'auto';
                this.pulseAudio.preload = 'auto';
            } catch (e) {
                console.warn('[CyberSound] Audio pool init warning:', e);
            }
        }

        ensureContext() {
            // Backward compatibility stub for legacy calls
            if (!this._unlocked) {
                this._unlocked = true;
                if (this.currentAmbientTrack && this.currentAmbientTrack !== 'none') {
                    this.startAmbient(this.currentAmbientTrack, false);
                }
            }
        }

        toggle() {
            this.enabled = !this.enabled;
            localStorage.setItem(this.storageKey, this.enabled ? 'true' : 'false');
            if (this.enabled) {
                this.playPowerUp();
            }
            this.updateSoundBtn();
            return this.enabled;
        }

        updateSoundBtn() {
            const btn = document.getElementById('cyberSoundToggleBtn');
            if (!btn) return;
            if (this.enabled) {
                btn.classList.add('sound-active');
                btn.innerHTML = '<span class="material-icons">volume_up</span> <span class="sound-label">FX 켜짐</span>';
                btn.setAttribute('title', '사이버 네온 사운드 FX 켜짐 (클릭 또는 단축키 M)');
            } else {
                btn.classList.remove('sound-active');
                btn.innerHTML = '<span class="material-icons">volume_off</span> <span class="sound-label">FX 꺼짐</span>';
                btn.setAttribute('title', '사이버 네온 사운드 FX 꺼짐 (클릭 또는 단축키 M)');
            }
        }

        playClick() {
            if (!this.enabled || !this.clickPool.length) return;
            try {
                const audio = this.clickPool[this.clickIndex];
                this.clickIndex = (this.clickIndex + 1) % this.clickPoolSize;
                audio.currentTime = 0;
                audio.volume = Math.max(0, Math.min(1, this.sfxVolume * 0.7));
                audio.playbackRate = 0.97 + Math.random() * 0.06;
                audio.play().catch(() => {});
            } catch (_) {}
        }

        playHover() {
            if (!this.enabled || !this.hoverPool.length) return;
            const now = performance.now();
            if (now - this.lastHoverTime < 32) return; // Prevent audio swarm
            this.lastHoverTime = now;

            try {
                const audio = this.hoverPool[this.hoverIndex];
                this.hoverIndex = (this.hoverIndex + 1) % this.hoverPoolSize;
                audio.currentTime = 0;
                audio.volume = Math.max(0, Math.min(1, this.sfxVolume * 0.28));
                audio.playbackRate = 0.98 + Math.random() * 0.05;
                audio.play().catch(() => {});
            } catch (_) {}
        }

        playPowerUp() {
            if (!this.enabled || !this.powerupAudio) return;
            try {
                this.powerupAudio.currentTime = 0;
                this.powerupAudio.volume = Math.max(0, Math.min(1, this.sfxVolume * 0.8));
                this.powerupAudio.play().catch(() => {});
            } catch (_) {}
        }

        playSuccess() {
            if (!this.enabled || !this.successAudio) return;
            try {
                this.successAudio.currentTime = 0;
                this.successAudio.volume = Math.max(0, Math.min(1, this.sfxVolume * 0.75));
                this.successAudio.play().catch(() => {});
            } catch (_) {}
        }

        playWarning() {
            if (!this.enabled || !this.warningAudio) return;
            try {
                this.warningAudio.currentTime = 0;
                this.warningAudio.volume = Math.max(0, Math.min(1, this.sfxVolume * 0.7));
                this.warningAudio.play().catch(() => {});
            } catch (_) {}
        }

        playToggle() {
            if (!this.enabled || !this.toggleAudio) return;
            try {
                this.toggleAudio.currentTime = 0;
                this.toggleAudio.volume = Math.max(0, Math.min(1, this.sfxVolume * 0.65));
                this.toggleAudio.play().catch(() => {});
            } catch (_) {}
        }

        playActionPulse() {
            if (!this.enabled || !this.pulseAudio) return;
            try {
                this.pulseAudio.currentTime = 0;
                this.pulseAudio.volume = Math.max(0, Math.min(1, this.sfxVolume * 0.8));
                this.pulseAudio.play().catch(() => {});
            } catch (_) {}
        }

        playGlitch() {
            if (!this.enabled || !this.warningAudio) return;
            try {
                this.warningAudio.currentTime = 0;
                this.warningAudio.volume = Math.max(0, Math.min(1, this.sfxVolume * 0.5));
                this.warningAudio.playbackRate = 1.25;
                this.warningAudio.play().catch(() => {});
            } catch (_) {}
        }

        // ==========================================
        // AMBIENT BACKGROUND ASMR ENGINE
        // ==========================================

        getAmbientTrack() {
            return this.currentAmbientTrack;
        }

        cycleAmbient() {
            const currentIndex = AMBIENT_TRACK_LIST.findIndex(t => t.id === this.currentAmbientTrack);
            const nextIndex = (currentIndex + 1) % AMBIENT_TRACK_LIST.length;
            const nextTrack = AMBIENT_TRACK_LIST[nextIndex];
            this.startAmbient(nextTrack.id, true);
            this.playToggle();
            return nextTrack;
        }

        startAmbient(trackId, savePreference = true) {
            if (!trackId || trackId === 'none') {
                this.stopAmbient(savePreference);
                return;
            }

            const assetUrl = CYBER_AUDIO_ASSETS[trackId];
            if (!assetUrl) return;

            if (savePreference) {
                this.currentAmbientTrack = trackId;
                localStorage.setItem(this.storageAmbientKey, trackId);
            }

            if (this.ambientAudio) {
                if (this.ambientAudio.dataset.track === trackId && !this.ambientAudio.paused) {
                    this.updateAmbientUI();
                    return;
                }
                this._fadeOutAudio(this.ambientAudio, () => {
                    this._playNewAmbient(assetUrl, trackId);
                });
            } else {
                this._playNewAmbient(assetUrl, trackId);
            }

            this.updateAmbientUI();
        }

        _playNewAmbient(assetUrl, trackId) {
            try {
                const audio = new Audio(assetUrl);
                audio.loop = true;
                audio.dataset.track = trackId;
                audio.volume = 0;
                this.ambientAudio = audio;

                const promise = audio.play();
                if (promise !== undefined) {
                    promise.then(() => {
                        this._fadeInAudio(audio, this.ambientVolume);
                    }).catch(err => {
                        console.log('[CyberSound] Ambient waiting for user interaction:', err.message);
                    });
                }
            } catch (e) {
                console.warn('[CyberSound] Ambient play error:', e);
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

        _fadeOutAudio(audio, onComplete, durationMs = 400) {
            clearInterval(this.ambientFadeInterval);
            const startVol = audio ? audio.volume : 0;
            const stepMs = 40;
            const steps = durationMs / stepMs;
            let currentStep = 0;

            this.ambientFadeInterval = setInterval(() => {
                currentStep++;
                const vol = Math.max(0, startVol * (1 - currentStep / steps));
                if (audio) audio.volume = vol;
                if (currentStep >= steps) {
                    clearInterval(this.ambientFadeInterval);
                    this.ambientFadeInterval = null;
                    if (audio) {
                        audio.pause();
                        audio.src = '';
                    }
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
            this.updateAmbientUI();
        }

        updateAmbientUI() {
            const btn = document.getElementById('cyberAmbientToggleBtn');
            const labelEl = document.getElementById('cyberAmbientLabel');
            const track = AMBIENT_TRACK_LIST.find(t => t.id === this.currentAmbientTrack) || AMBIENT_TRACK_LIST[0];

            if (labelEl) {
                labelEl.textContent = track.label;
            }

            if (btn) {
                const iconEl = btn.querySelector('.material-icons');
                if (iconEl) {
                    iconEl.textContent = track.icon;
                }
                const isActive = this.currentAmbientTrack && this.currentAmbientTrack !== 'none';
                btn.classList.toggle('ambient-active', isActive);
                btn.setAttribute('title', `사이버 앰비언트: ${track.label} (클릭하여 전환, 단축키 B)`);
            }
        }
    }

    const soundEngine = new SoundEngine();

    // =========================================================================
    // 2. Interactive Quantum Particle & Constellation Matrix Canvas Engine
    // =========================================================================
    class ParticleNebula {
        constructor() {
            this.canvas = document.getElementById('cyber-bg-canvas');
            if (!this.canvas) {
                this.canvas = document.createElement('canvas');
                this.canvas.id = 'cyber-bg-canvas';
                document.body.prepend(this.canvas);
            }
            this.ctx = this.canvas.getContext('2d');
            this.particles = [];
            this.shockwaves = [];
            this.particleCount = 110;
            this.mouse = { x: -1000, y: -1000, radius: 200, active: false };
            this.colors = [
                'rgba(59, 130, 246, ',   // Neon Blue
                'rgba(14, 165, 233, ',   // Cyber Cyan
                'rgba(168, 85, 247, ',   // Quantum Purple
                'rgba(236, 72, 153, ',   // Neon Pink
                'rgba(16, 185, 129, '    // Matrix Emerald
            ];
            
            this.resize = this.resize.bind(this);
            this.animate = this.animate.bind(this);
            this.onMouseMove = this.onMouseMove.bind(this);
            this.onMouseLeave = this.onMouseLeave.bind(this);
            this.onClick = this.onClick.bind(this);

            window.addEventListener('resize', this.resize);
            window.addEventListener('mousemove', this.onMouseMove, { passive: true });
            document.addEventListener('mouseleave', this.onMouseLeave);
            window.addEventListener('click', this.onClick);

            this.resize();
            this.initParticles();
            requestAnimationFrame(this.animate);
        }

        resize() {
            this.width = window.innerWidth;
            this.height = window.innerHeight;
            this.canvas.width = this.width * window.devicePixelRatio;
            this.canvas.height = this.height * window.devicePixelRatio;
            this.canvas.style.width = this.width + 'px';
            this.canvas.style.height = this.height + 'px';
            this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }

        initParticles() {
            this.particles = [];
            const count = Math.min(Math.floor((this.width * this.height) / 10000), 160);
            for (let i = 0; i < count; i++) {
                this.particles.push({
                    x: Math.random() * this.width,
                    y: Math.random() * this.height,
                    vx: (Math.random() - 0.5) * 0.7,
                    vy: (Math.random() - 0.5) * 0.7,
                    radius: Math.random() * 2.2 + 0.8,
                    baseAlpha: Math.random() * 0.5 + 0.3,
                    alpha: 0.4,
                    color: this.colors[Math.floor(Math.random() * this.colors.length)],
                    pulseSpeed: Math.random() * 0.02 + 0.008,
                    pulsePhase: Math.random() * Math.PI * 2
                });
            }
        }

        onMouseMove(e) {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
            this.mouse.active = true;

            // Update global CSS mouse variables for real-time spotlight
            document.documentElement.style.setProperty('--cursor-x', `${e.clientX}px`);
            document.documentElement.style.setProperty('--cursor-y', `${e.clientY}px`);
        }

        onMouseLeave() {
            this.mouse.active = false;
            this.mouse.x = -1000;
            this.mouse.y = -1000;
        }

        onClick(e) {
            // Spawn expanding laser shockwave ring
            this.shockwaves.push({
                x: e.clientX,
                y: e.clientY,
                radius: 5,
                maxRadius: Math.min(this.width, this.height) * 0.35,
                speed: 6.5,
                alpha: 0.85,
                color: Math.random() > 0.5 ? 'rgba(56, 189, 248,' : 'rgba(168, 85, 247,'
            });
            soundEngine.playClick();
        }

        animate() {
            this.ctx.clearRect(0, 0, this.width, this.height);

            const isDark = document.body.classList.contains('dark-mode');

            // 1. Render Shockwaves
            for (let i = this.shockwaves.length - 1; i >= 0; i--) {
                const sw = this.shockwaves[i];
                sw.radius += sw.speed;
                sw.alpha -= 0.022;

                if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
                    this.shockwaves.splice(i, 1);
                    continue;
                }

                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
                this.ctx.strokeStyle = `${sw.color} ${sw.alpha})`;
                this.ctx.lineWidth = 2.5;
                this.ctx.shadowBlur = 18;
                this.ctx.shadowColor = `${sw.color} ${sw.alpha * 0.9})`;
                this.ctx.stroke();

                // Secondary soft glow ring
                this.ctx.beginPath();
                this.ctx.arc(sw.x, sw.y, Math.max(1, sw.radius - 8), 0, Math.PI * 2);
                this.ctx.strokeStyle = `${sw.color} ${sw.alpha * 0.4})`;
                this.ctx.lineWidth = 1;
                this.ctx.stroke();
                this.ctx.restore();
            }

            // 2. Update & Draw Particles
            const pLen = this.particles.length;
            const linkDistance = 110;
            const mouseDistance = this.mouse.radius;

            for (let i = 0; i < pLen; i++) {
                const p = this.particles[i];

                p.x += p.vx;
                p.y += p.vy;
                p.pulsePhase += p.pulseSpeed;
                p.alpha = p.baseAlpha + Math.sin(p.pulsePhase) * 0.2;

                // Screen bounce
                if (p.x < 0) { p.x = 0; p.vx *= -1; }
                else if (p.x > this.width) { p.x = this.width; p.vx *= -1; }
                if (p.y < 0) { p.y = 0; p.vy *= -1; }
                else if (p.y > this.height) { p.y = this.height; p.vy *= -1; }

                // Mouse interaction (gravity / repulsion)
                if (this.mouse.active) {
                    const dx = this.mouse.x - p.x;
                    const dy = this.mouse.y - p.y;
                    const dist = Math.hypot(dx, dy);

                    if (dist < mouseDistance) {
                        const force = (1 - dist / mouseDistance) * 2.2;
                        const angle = Math.atan2(dy, dx);
                        // Repel smoothly
                        p.x -= Math.cos(angle) * force;
                        p.y -= Math.sin(angle) * force;

                        // Laser beam to mouse
                        const mouseAlpha = (1 - dist / mouseDistance) * (isDark ? 0.45 : 0.25);
                        this.ctx.beginPath();
                        this.ctx.moveTo(p.x, p.y);
                        this.ctx.lineTo(this.mouse.x, this.mouse.y);
                        this.ctx.strokeStyle = isDark ? `rgba(96, 165, 250, ${mouseAlpha})` : `rgba(59, 130, 246, ${mouseAlpha})`;
                        this.ctx.lineWidth = 1;
                        this.ctx.stroke();
                    }
                }

                // Draw Particle Glow
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                this.ctx.fillStyle = `${p.color}${Math.max(0.1, p.alpha * (isDark ? 1 : 0.8))})`;
                this.ctx.shadowBlur = isDark ? 10 : 4;
                this.ctx.shadowColor = `${p.color}0.8)`;
                this.ctx.fill();

                // Draw Constellation Lines between nearby particles
                for (let j = i + 1; j < pLen; j++) {
                    const p2 = this.particles[j];
                    const dist = Math.hypot(p.x - p2.x, p.y - p2.y);

                    if (dist < linkDistance) {
                        const lineAlpha = (1 - dist / linkDistance) * (isDark ? 0.25 : 0.12);
                        this.ctx.beginPath();
                        this.ctx.moveTo(p.x, p.y);
                        this.ctx.lineTo(p2.x, p2.y);
                        this.ctx.strokeStyle = isDark ? `rgba(147, 197, 253, ${lineAlpha})` : `rgba(79, 140, 240, ${lineAlpha})`;
                        this.ctx.lineWidth = 0.85;
                        this.ctx.shadowBlur = 0;
                        this.ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(this.animate);
        }
    }

    // =========================================================================
    // 3. 3D Holographic Card Tilt (Only Small Stat Widgets, Never Big Panels!)
    // =========================================================================
    function init3DTilt() {
        // Strictly only small standalone stat cards. NO big reading panels or folder groups!
        const tiltTargets = [
            '.stat-item',
            '.kpi-card'
        ];

        const selector = tiltTargets.join(', ');

        document.addEventListener('mousemove', (e) => {
            const target = e.target.closest(selector);
            if (!target) return;

            // Never tilt folder groups, content lists, or tables
            if (target.closest('.history-folder-group, .list-group, .table-scroll-container, .master-controls, .header-nav')) {
                // If it's a stat-item inside master-controls that's fine, but do NOT tilt the container
                if (!target.classList.contains('stat-item') && !target.classList.contains('kpi-card')) {
                    return;
                }
            }

            const rect = target.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            const deltaX = (x - centerX) / centerX;
            const deltaY = (y - centerY) / centerY;

            // Very subtle, micro 3D rotation (max 2.5 deg) so it never causes motion sickness
            const rotateX = -deltaY * 2.5;
            const rotateY = deltaX * 2.5;

            target.style.transform = `perspective(800px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(3px)`;
            target.style.transition = 'transform 0.08s ease-out';

            // Calculate holographic light reflection percentage
            const glareX = ((x / rect.width) * 100).toFixed(1);
            const glareY = ((y / rect.height) * 100).toFixed(1);
            target.style.setProperty('--glare-x', `${glareX}%`);
            target.style.setProperty('--glare-y', `${glareY}%`);
        }, { passive: true });

        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest(selector);
            if (target && (!e.relatedTarget || !target.contains(e.relatedTarget))) {
                target.style.transform = '';
                target.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease';
            }
        });
    }

    // =========================================================================
    // 4. Interactive Neon Haptic Audio Hookup & Button Micro-Interactions
    // =========================================================================
    function setupInteractiveFeedback() {
        // Sound toggle button in header
        const soundBtn = document.getElementById('cyberSoundToggleBtn');
        if (soundBtn) {
            soundEngine.updateSoundBtn();
            soundBtn.addEventListener('click', () => {
                soundEngine.ensureContext();
                soundEngine.toggle();
            });
        }

        // Ambient background audio toggle button in header
        const ambientBtn = document.getElementById('cyberAmbientToggleBtn');
        if (ambientBtn) {
            soundEngine.updateAmbientUI();
            ambientBtn.addEventListener('click', () => {
                soundEngine.ensureContext();
                soundEngine.cycleAmbient();
            });
        }

        // Global hotkeys (B for ambient background, M for FX mute)
        window.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            const isTyping = active && (
                active.tagName === 'INPUT' ||
                active.tagName === 'TEXTAREA' ||
                active.tagName === 'SELECT' ||
                active.isContentEditable
            );
            if (isTyping) return;

            if (e.key === 'b' || e.key === 'B') {
                soundEngine.ensureContext();
                soundEngine.cycleAmbient();
            } else if (e.key === 'm' || e.key === 'M') {
                soundEngine.ensureContext();
                soundEngine.toggle();
            }
        });

        // Delegate hover & click sounds
        document.addEventListener('mouseover', (e) => {
            if (e.target.closest('button, .btn, .stat-item, .modal-tab-btn, a, .checkbox-container, .cyber-dot-screen-bezel, .dot-mode-chip')) {
                soundEngine.playHover();
            }
        }, { passive: true });

        document.addEventListener('click', (e) => {
            soundEngine.ensureContext();
            if (e.target.closest('button, .btn, .modal-tab-btn, .checkbox-container, .cyber-dot-screen-bezel')) {
                soundEngine.playClick();
            }
        });
    }

    // =========================================================================
    // 5. Dynamic Cyber HUD & Real-time Live Metrics Indicator
    // =========================================================================
    function initCyberHUD() {
        // Add live clock and quantum heartbeat indicator
        const timeBadge = document.getElementById('cyberLiveClock');
        if (timeBadge) {
            const updateClock = () => {
                const now = new Date();
                const timeStr = now.toTimeString().split(' ')[0];
                timeBadge.textContent = timeStr;
            };
            updateClock();
            setInterval(updateClock, 1000);
        }
    }

    // =========================================================================
    // 6. Retro Cyberpunk LED Dot-Matrix Animation Screen Engine (20x20 Grid)
    // =========================================================================
    const CYBER_ANIM_CATALOG = [
        { id: 'droid', label: '🤖 NEURAL DROID' },
        { id: 'cat', label: '🐱 CYBER-CAT' },
        { id: 'cube', label: '💠 3D HOLO-CUBE' },
        { id: 'runner', label: '🏃 CYBER RUNNER' },
        { id: 'skull', label: '💀 GLITCH SKULL' },
        { id: 'eye', label: '👁️ CYBER EYE' },
        { id: 'heart', label: '🫀 BIO-REACTOR' },
        { id: 'invader', label: '👾 NEON INVADER' },
        { id: 'vortex', label: '🌀 MATRIX VORTEX' },
        { id: 'katana', label: '⚡ LASER BLADE' }
    ];

    class DotMatrixScreen {
        constructor() {
            this.canvas = document.getElementById('cyberDotMatrixCanvas');
            if (!this.canvas) return;
            this.ctx = this.canvas.getContext('2d');
            this.cols = 20;
            this.rows = 20;
            this.width = this.canvas.width;   // 160
            this.height = this.canvas.height; // 160
            this.pitch = this.width / this.cols; // 8
            this.radius = 2.6;
            this.tick = 0;
            this.isComplete = false;

            // 10 Animations Playlist & Auto-Transition Engine
            this.playlist = [...CYBER_ANIM_CATALOG];
            this.currentIndex = 0;
            this.frameInAnim = 0;
            this.animDuration = 135;       // ~2.2s per animation
            this.transitionDuration = 18;  // ~0.3s glitch transition
            this.animFrameId = null;

            this.shuffleSequence();
            this.setupUI();
            this.render = this.render.bind(this);
            this.start();
        }

        setupUI() {
            const bezel = document.getElementById('cyberDotBezel');
            if (bezel) {
                bezel.addEventListener('click', () => {
                    this.nextAnimation(true);
                });
            }
        }

        shuffleSequence() {
            // Fisher-Yates shuffle so every loading session order is unique!
            for (let i = this.playlist.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
            }
            this.currentIndex = 0;
            this.frameInAnim = 0;
            this.updateHudTag();
        }

        nextAnimation(manual = false) {
            this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
            this.frameInAnim = 0;
            this.updateHudTag();
            if (manual && window.CyberSound) {
                window.CyberSound.playClick();
                window.CyberSound.playGlitch();
            }
        }

        updateHudTag() {
            const tag = document.getElementById('cyberAnimLiveTag');
            if (tag && this.playlist[this.currentIndex]) {
                tag.innerHTML = `<span class="pulse-dot"></span> ${this.playlist[this.currentIndex].label}`;
            }
        }

        setComplete(val) {
            this.isComplete = val;
            if (val) {
                const tag = document.getElementById('cyberAnimLiveTag');
                if (tag) tag.innerHTML = '<span class="pulse-dot" style="background:#10b981;box-shadow:0 0 8px #10b981;"></span> ✨ SYNCHRONIZED';
            }
        }

        start() {
            if (this.animFrameId) return;
            const loop = () => {
                this.render();
                this.animFrameId = requestAnimationFrame(loop);
            };
            this.animFrameId = requestAnimationFrame(loop);
        }

        stop() {
            if (this.animFrameId) {
                cancelAnimationFrame(this.animFrameId);
                this.animFrameId = null;
            }
        }

        render() {
            if (!this.ctx) return;
            this.tick++;
            this.frameInAnim++;

            // Check auto-transition to next animation
            const totalCycle = this.animDuration + this.transitionDuration;
            const isTransitioning = this.frameInAnim >= this.animDuration && !this.isComplete;

            if (this.frameInAnim === this.animDuration && window.CyberSound) {
                window.CyberSound.playGlitch();
            }

            if (this.frameInAnim >= totalCycle && !this.isComplete) {
                this.nextAnimation(false);
            }

            // 1. Clear Screen Canvas
            this.ctx.fillStyle = '#070b16';
            this.ctx.fillRect(0, 0, this.width, this.height);

            // 2. Active LED Dot Map
            const activeDots = new Map();
            const currentAnim = this.playlist[this.currentIndex] ? this.playlist[this.currentIndex].id : 'droid';

            // Route to appropriate animation generator
            switch (currentAnim) {
                case 'droid':   this.generateDroidFrame(activeDots); break;
                case 'cat':     this.generateCatFrame(activeDots); break;
                case 'cube':    this.generateCubeFrame(activeDots); break;
                case 'runner':  this.generateRunnerFrame(activeDots); break;
                case 'skull':   this.generateSkullFrame(activeDots); break;
                case 'eye':     this.generateEyeFrame(activeDots); break;
                case 'heart':   this.generateHeartFrame(activeDots); break;
                case 'invader': this.generateInvaderFrame(activeDots); break;
                case 'vortex':  this.generateVortexFrame(activeDots); break;
                case 'katana':  this.generateKatanaFrame(activeDots); break;
                default:        this.generateDroidFrame(activeDots); break;
            }

            // Apply Glitch Transition Matrix Overlay if transitioning
            if (isTransitioning) {
                const glitchPhase = this.frameInAnim - this.animDuration;
                for (let i = 0; i < 14; i++) {
                    const gc = Math.floor(Math.random() * 20);
                    const gr = Math.floor(Math.random() * 20);
                    activeDots.set(`${gc},${gr}`, {
                        color: Math.random() > 0.5 ? '#00f2fe' : (Math.random() > 0.5 ? '#ec4899' : '#ffffff'),
                        glow: true
                    });
                }
            }

            // 3. Draw All 400 LED Matrix Dots
            const offColor = 'rgba(56, 189, 248, 0.08)';
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    const cx = c * this.pitch + 4;
                    const cy = r * this.pitch + 4;
                    const dotInfo = activeDots.get(`${c},${r}`);

                    this.ctx.beginPath();
                    this.ctx.arc(cx, cy, this.radius, 0, Math.PI * 2);

                    if (dotInfo) {
                        this.ctx.fillStyle = dotInfo.color;
                        this.ctx.shadowBlur = dotInfo.glow ? 8 : 4;
                        this.ctx.shadowColor = dotInfo.color;
                        this.ctx.fill();
                        this.ctx.shadowBlur = 0;
                    } else {
                        this.ctx.fillStyle = offColor;
                        this.ctx.shadowBlur = 0;
                        this.ctx.fill();
                    }
                }
            }
        }

        addDot(map, col, row, color, glow = false) {
            if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
                map.set(`${Math.round(col)},${Math.round(row)}`, { color, glow });
            }
        }

        // =====================================================================
        // ANIMATION 1: 🤖 NEURAL DROID
        // =====================================================================
        generateDroidFrame(map) {
            const t = this.tick;
            const floatY = Math.round(Math.sin(t * 0.08) * 1.5);
            const isDone = this.isComplete;

            const antColor = (t % 16 < 8) ? '#ec4899' : '#ffffff';
            this.addDot(map, 9, 3 + floatY, antColor, true);
            this.addDot(map, 9, 4 + floatY, '#64748b');

            for (let c = 7; c <= 12; c++) {
                this.addDot(map, c, 5 + floatY, isDone ? '#10b981' : '#38bdf8');
            }

            this.addDot(map, 5, 6 + floatY, isDone ? '#34d399' : '#ec4899', true);
            this.addDot(map, 14, 6 + floatY, isDone ? '#34d399' : '#ec4899', true);
            this.addDot(map, 6, 6 + floatY, '#1e293b');
            this.addDot(map, 13, 6 + floatY, '#1e293b');

            const visorBase = isDone ? '#10b981' : '#00f2fe';
            const scanBeamCol = 6 + Math.round((Math.sin(t * 0.16) + 1) * 3);

            for (let r = 7; r <= 8; r++) {
                for (let c = 6; c <= 13; c++) {
                    if (isDone) {
                        if ((r === 7 && (c === 7 || c === 9 || c === 10 || c === 12)) ||
                            (r === 8 && (c === 8 || c === 11))) {
                            this.addDot(map, c, r + floatY, '#ffffff', true);
                        } else {
                            this.addDot(map, c, r + floatY, '#059669');
                        }
                    } else if (c === scanBeamCol || c === scanBeamCol + 1) {
                        this.addDot(map, c, r + floatY, '#ffffff', true);
                    } else {
                        this.addDot(map, c, r + floatY, visorBase);
                    }
                }
            }

            this.addDot(map, 6, 9 + floatY, '#1e293b');
            this.addDot(map, 13, 9 + floatY, '#1e293b');
            for (let c = 7; c <= 12; c++) {
                this.addDot(map, c, 9 + floatY, '#0f172a');
                this.addDot(map, c, 10 + floatY, isDone ? '#10b981' : '#38bdf8');
            }

            for (let c = 6; c <= 13; c++) {
                this.addDot(map, c, 11 + floatY, '#334155');
            }
            this.addDot(map, 7, 12 + floatY, '#1e293b');
            this.addDot(map, 8, 12 + floatY, '#1e293b');
            this.addDot(map, 11, 12 + floatY, '#1e293b');
            this.addDot(map, 12, 12 + floatY, '#1e293b');

            const coreColor = isDone ? '#10b981' : ((t % 10 < 5) ? '#ec4899' : '#c084fc');
            this.addDot(map, 9, 12 + floatY, coreColor, true);
            this.addDot(map, 10, 12 + floatY, coreColor, true);

            for (let c = 8; c <= 11; c++) {
                this.addDot(map, c, 13 + floatY, '#334155');
            }

            this.addDot(map, 9, 14 + floatY, '#64748b');
            this.addDot(map, 10, 14 + floatY, '#64748b');

            const flameStep = Math.floor(t * 0.3) % 3;
            const fColor = isDone ? '#34d399' : '#00f2fe';
            const fSubColor = isDone ? '#10b981' : '#ec4899';

            if (flameStep === 0) {
                this.addDot(map, 9, 15 + floatY, fColor, true);
                this.addDot(map, 10, 15 + floatY, fColor, true);
                this.addDot(map, 9, 16 + floatY, fSubColor);
            } else if (flameStep === 1) {
                this.addDot(map, 8, 15 + floatY, fColor);
                this.addDot(map, 9, 15 + floatY, '#ffffff', true);
                this.addDot(map, 10, 15 + floatY, '#ffffff', true);
                this.addDot(map, 11, 15 + floatY, fColor);
                this.addDot(map, 9, 16 + floatY, fSubColor, true);
                this.addDot(map, 10, 16 + floatY, fSubColor, true);
            } else {
                this.addDot(map, 9, 15 + floatY, fColor, true);
                this.addDot(map, 10, 15 + floatY, fColor, true);
                this.addDot(map, 10, 16 + floatY, fSubColor);
            }

            this.addDot(map, 3, (20 - Math.floor(t * 0.18)) % 20, '#00f2fe');
            this.addDot(map, 16, (20 - Math.floor(t * 0.22) + 6) % 20, '#ec4899');
        }

        // =====================================================================
        // ANIMATION 2: 🐱 CYBER-CAT
        // =====================================================================
        generateCatFrame(map) {
            const t = this.tick;
            const walkPhase = Math.floor(t * 0.22) % 4;
            const bob = (walkPhase % 2 === 0) ? 0 : 1;
            const isDone = this.isComplete;

            this.addDot(map, 6, 4 + bob, '#38bdf8');
            this.addDot(map, 7, 4 + bob, '#f472b6', true);
            this.addDot(map, 12, 4 + bob, '#f472b6', true);
            this.addDot(map, 13, 4 + bob, '#38bdf8');

            for (let c = 7; c <= 12; c++) {
                this.addDot(map, c, 5 + bob, '#38bdf8');
            }

            const glareCol = 6 + Math.floor((t * 0.22) % 8);
            const visorColor = isDone ? '#10b981' : '#ec4899';

            for (let r = 6; r <= 7; r++) {
                for (let c = 6; c <= 13; c++) {
                    if (c === glareCol) {
                        this.addDot(map, c, r + bob, '#ffffff', true);
                    } else {
                        this.addDot(map, c, r + bob, visorColor);
                    }
                }
            }

            this.addDot(map, 4, 8 + bob, '#94a3b8');
            this.addDot(map, 5, 8 + bob, '#94a3b8');
            for (let c = 6; c <= 13; c++) this.addDot(map, c, 8 + bob, '#38bdf8');
            this.addDot(map, 9, 8 + bob, '#fb7185', true);
            this.addDot(map, 10, 8 + bob, '#fb7185', true);
            this.addDot(map, 14, 8 + bob, '#94a3b8');
            this.addDot(map, 15, 8 + bob, '#94a3b8');

            for (let c = 8; c <= 11; c++) this.addDot(map, c, 9 + bob, '#38bdf8');

            for (let c = 7; c <= 12; c++) this.addDot(map, c, 10 + bob, '#1e293b');
            this.addDot(map, 9, 10 + bob, isDone ? '#10b981' : '#00f2fe', true);
            this.addDot(map, 10, 10 + bob, isDone ? '#10b981' : '#00f2fe', true);

            for (let r = 11; r <= 13; r++) {
                for (let c = 7; c <= 12; c++) this.addDot(map, c, r, '#38bdf8');
            }

            if (walkPhase === 0) {
                this.addDot(map, 7, 14, '#ffffff'); this.addDot(map, 8, 14, '#ffffff');
                this.addDot(map, 11, 14, '#ffffff'); this.addDot(map, 12, 14, '#ffffff');
            } else if (walkPhase === 1) {
                this.addDot(map, 7, 13, '#ffffff'); this.addDot(map, 8, 14, '#ffffff');
                this.addDot(map, 11, 14, '#ffffff'); this.addDot(map, 12, 13, '#ffffff');
            } else if (walkPhase === 2) {
                this.addDot(map, 7, 14, '#ffffff'); this.addDot(map, 8, 14, '#ffffff');
                this.addDot(map, 11, 14, '#ffffff'); this.addDot(map, 12, 14, '#ffffff');
            } else {
                this.addDot(map, 7, 14, '#ffffff'); this.addDot(map, 8, 13, '#ffffff');
                this.addDot(map, 11, 13, '#ffffff'); this.addDot(map, 12, 14, '#ffffff');
            }

            this.addDot(map, 13, 12, '#38bdf8');
            this.addDot(map, 14, 11, '#38bdf8');
            const tailTipX = 14 + Math.round(Math.sin(t * 0.16) * 1.6);
            this.addDot(map, tailTipX, 10, '#ec4899', true);
            this.addDot(map, tailTipX + 1, 9, '#ec4899', true);
        }

        // =====================================================================
        // ANIMATION 3: 💠 3D HOLO-CUBE
        // =====================================================================
        generateCubeFrame(map) {
            const t = this.tick;
            const isDone = this.isComplete;
            const angY = t * 0.045;
            const angX = 0.55;

            const verts = [
                [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
                [-1, -1, 1],  [1, -1, 1],  [1, 1, 1],  [-1, 1, 1]
            ];

            const projVerts = verts.map(([vx, vy, vz]) => {
                const rx = vx * Math.cos(angY) + vz * Math.sin(angY);
                const rz = -vx * Math.sin(angY) + vz * Math.cos(angY);
                const ry = vy * Math.cos(angX) - rz * Math.sin(angX);
                const fz = vy * Math.sin(angX) + rz * Math.cos(angX);
                return { x: 9.5 + rx * 5.2, y: 9.5 + ry * 5.2, z: fz };
            });

            const edges = [
                [0, 1], [1, 2], [2, 3], [3, 0],
                [4, 5], [5, 6], [6, 7], [7, 4],
                [0, 4], [1, 5], [2, 6], [3, 7]
            ];

            const scanRow = Math.floor((t * 0.35) % 20);

            edges.forEach(([i, j]) => {
                const v1 = projVerts[i];
                const v2 = projVerts[j];
                const avgZ = (v1.z + v2.z) / 2;
                const baseColor = isDone ? '#10b981' : (avgZ > 0 ? '#00f2fe' : '#818cf8');

                for (let s = 0; s <= 7; s++) {
                    const col = Math.round(v1.x + (v2.x - v1.x) * (s / 7));
                    const row = Math.round(v1.y + (v2.y - v1.y) * (s / 7));
                    if (row === scanRow) {
                        this.addDot(map, col, row, '#ffffff', true);
                    } else {
                        this.addDot(map, col, row, baseColor, avgZ > 0);
                    }
                }
            });

            const coreColor = isDone ? '#10b981' : ((t % 12 < 6) ? '#ec4899' : '#ffffff');
            this.addDot(map, 9, 9, coreColor, true);
            this.addDot(map, 10, 9, coreColor, true);
            this.addDot(map, 9, 10, coreColor, true);
            this.addDot(map, 10, 10, coreColor, true);
        }

        // =====================================================================
        // ANIMATION 4: 🏃 CYBER RUNNER
        // =====================================================================
        generateRunnerFrame(map) {
            const t = this.tick;
            const runCycle = Math.floor(t * 0.25) % 6;
            const isDone = this.isComplete;
            const rBob = (runCycle % 2 === 0) ? 0 : 1;

            // Head & Glowing Visor
            this.addDot(map, 10, 5 + rBob, '#e2e8f0');
            this.addDot(map, 11, 5 + rBob, '#e2e8f0');
            this.addDot(map, 11, 6 + rBob, isDone ? '#10b981' : '#00f2fe', true);
            this.addDot(map, 12, 6 + rBob, '#ffffff', true);

            // Flowing Cyber Scarf waving behind
            const scarfWave = Math.sin(t * 0.3) * 1.5;
            this.addDot(map, 9, 6 + rBob, '#ec4899', true);
            this.addDot(map, 8, 6 + Math.round(scarfWave), '#ec4899', true);
            this.addDot(map, 7, 7 + Math.round(scarfWave), '#ec4899');
            this.addDot(map, 6, 7 + Math.round(scarfWave * 0.8), '#ec4899');

            // Torso & Cyber Trench Coat
            for (let r = 7; r <= 10; r++) {
                this.addDot(map, 9, r + rBob, '#3b82f6');
                this.addDot(map, 10, r + rBob, '#1e293b');
                this.addDot(map, 11, r + rBob, '#3b82f6');
            }

            // Running Legs 6-Step Cycle
            if (runCycle === 0) {
                this.addDot(map, 8, 11, '#38bdf8'); this.addDot(map, 7, 12, '#ffffff'); // Leg back
                this.addDot(map, 11, 11, '#38bdf8'); this.addDot(map, 12, 12, '#ffffff'); // Leg forward
            } else if (runCycle === 1) {
                this.addDot(map, 8, 12, '#38bdf8'); this.addDot(map, 7, 13, '#ffffff');
                this.addDot(map, 11, 12, '#38bdf8'); this.addDot(map, 13, 13, '#ffffff');
            } else if (runCycle === 2) {
                this.addDot(map, 9, 11, '#38bdf8'); this.addDot(map, 9, 13, '#ffffff');
                this.addDot(map, 10, 11, '#38bdf8'); this.addDot(map, 12, 12, '#ffffff');
            } else if (runCycle === 3) {
                this.addDot(map, 11, 11, '#38bdf8'); this.addDot(map, 12, 12, '#ffffff');
                this.addDot(map, 8, 11, '#38bdf8'); this.addDot(map, 7, 12, '#ffffff');
            } else if (runCycle === 4) {
                this.addDot(map, 11, 12, '#38bdf8'); this.addDot(map, 13, 13, '#ffffff');
                this.addDot(map, 8, 12, '#38bdf8'); this.addDot(map, 7, 13, '#ffffff');
            } else {
                this.addDot(map, 10, 11, '#38bdf8'); this.addDot(map, 11, 13, '#ffffff');
                this.addDot(map, 9, 11, '#38bdf8'); this.addDot(map, 8, 12, '#ffffff');
            }

            // Scrolling Neon Ground Track
            for (let c = 0; c < 20; c++) {
                if ((c + Math.floor(t * 0.4)) % 4 !== 0) {
                    this.addDot(map, c, 15, isDone ? '#10b981' : '#38bdf8');
                }
            }

            // Speed trailing particles
            this.addDot(map, 4, 9, '#00f2fe');
            this.addDot(map, 3, 10, '#ec4899');
        }

        // =====================================================================
        // ANIMATION 5: 💀 GLITCH SKULL
        // =====================================================================
        generateSkullFrame(map) {
            const t = this.tick;
            const isDone = this.isComplete;
            const jawDrop = (t % 28 < 14) ? 1 : 0;

            // Cranium Top
            for (let c = 7; c <= 12; c++) this.addDot(map, c, 4, '#e2e8f0');
            for (let c = 6; c <= 13; c++) this.addDot(map, c, 5, '#cbd5e1');

            // VR Visor / Goggles across eyes (Rows 6-7)
            const vCol = 5 + Math.floor((t * 0.25) % 9);
            const vBase = isDone ? '#10b981' : '#ec4899';
            for (let r = 6; r <= 7; r++) {
                for (let c = 5; c <= 14; c++) {
                    if (c === vCol) {
                        this.addDot(map, c, r, '#ffffff', true);
                    } else {
                        this.addDot(map, c, r, vBase, true);
                    }
                }
            }

            // Cheekbones
            this.addDot(map, 5, 8, '#94a3b8'); this.addDot(map, 14, 8, '#94a3b8');
            this.addDot(map, 6, 9, '#e2e8f0'); this.addDot(map, 13, 9, '#e2e8f0');

            // Nose Cavity
            this.addDot(map, 9, 9, '#070b16'); this.addDot(map, 10, 9, '#070b16');

            // Upper Teeth (Row 11)
            for (let c = 7; c <= 12; c++) {
                if (c % 2 === 1) this.addDot(map, c, 11, '#ffffff');
            }

            // Lower Jaw & Teeth (Row 12-13 + jawDrop)
            for (let c = 7; c <= 12; c++) {
                if (c % 2 === 0) this.addDot(map, c, 12 + jawDrop, '#ffffff');
                this.addDot(map, c, 13 + jawDrop, '#94a3b8');
            }

            // Matrix glitch sparks
            this.addDot(map, 3, (t * 0.2) % 20, '#00f2fe');
            this.addDot(map, 16, (20 - (t * 0.3) % 20), '#ec4899');
        }

        // =====================================================================
        // ANIMATION 6: 👁️ CYBERNETIC EYE
        // =====================================================================
        generateEyeFrame(map) {
            const t = this.tick;
            const isDone = this.isComplete;
            const isBlink = (t % 70 < 6);

            if (isBlink) {
                // Closed eyelid laser line
                for (let c = 4; c <= 15; c++) this.addDot(map, c, 10, isDone ? '#10b981' : '#00f2fe', true);
                return;
            }

            // Almond Eye Contour
            const contour = [
                [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6],
                [5, 7], [14, 7], [4, 8], [15, 8], [3, 9], [16, 9], [3, 10], [16, 10],
                [4, 11], [15, 11], [5, 12], [14, 12],
                [6, 13], [7, 13], [8, 13], [9, 13], [10, 13], [11, 13], [12, 13], [13, 13]
            ];
            contour.forEach(([c, r]) => this.addDot(map, c, r, '#38bdf8'));

            // Iris looking side to side
            const irisShift = Math.round(Math.sin(t * 0.08) * 2.2);
            const irisCenter = 9.5 + irisShift;
            const irisColor = isDone ? '#10b981' : '#00f2fe';

            for (let r = 8; r <= 11; r++) {
                for (let c = Math.round(irisCenter - 2); c <= Math.round(irisCenter + 2); c++) {
                    const dist = Math.hypot(c - irisCenter, r - 9.5);
                    if (dist < 1.3) {
                        this.addDot(map, c, r, '#ffffff', true); // Pupil flare
                    } else if (dist < 2.3) {
                        this.addDot(map, c, r, irisColor, true); // Iris
                    }
                }
            }

            // Rotating HUD Brackets around eye
            const ang = t * 0.05;
            for (let a = 0; a < 4; a++) {
                const curA = ang + a * (Math.PI / 2);
                const bx = Math.round(9.5 + Math.cos(curA) * 7.5);
                const by = Math.round(9.5 + Math.sin(curA) * 7.5);
                this.addDot(map, bx, by, '#ec4899', true);
            }
        }

        // =====================================================================
        // ANIMATION 7: 🫀 BIO-REACTOR
        // =====================================================================
        generateHeartFrame(map) {
            const t = this.tick;
            const isDone = this.isComplete;
            const pulse = (t % 36 < 8) ? 1 : 0;
            const hColor = isDone ? '#10b981' : (pulse ? '#ff2a5f' : '#ec4899');

            // Upper Ventricles
            this.addDot(map, 6, 6 - pulse, hColor, true); this.addDot(map, 7, 5 - pulse, hColor, true); this.addDot(map, 8, 5 - pulse, hColor, true);
            this.addDot(map, 11, 5 - pulse, hColor, true); this.addDot(map, 12, 5 - pulse, hColor, true); this.addDot(map, 13, 6 - pulse, hColor, true);

            // Heart Body
            for (let c = 5; c <= 14; c++) this.addDot(map, c, 7, hColor);
            for (let c = 6; c <= 13; c++) this.addDot(map, c, 8, hColor);
            for (let c = 7; c <= 12; c++) this.addDot(map, c, 9, hColor);
            for (let c = 8; c <= 11; c++) this.addDot(map, c, 10, hColor);
            this.addDot(map, 9, 11, hColor, true); this.addDot(map, 10, 11, hColor, true);

            // Center Reactor Singularity
            this.addDot(map, 9, 7, '#ffffff', true);
            this.addDot(map, 10, 7, '#ffffff', true);

            // ECG Heartbeat line across row 15
            const ecgCol = Math.floor((t * 0.4) % 20);
            for (let c = 0; c < 20; c++) {
                if (c === ecgCol) {
                    this.addDot(map, c, 13, '#00f2fe', true);
                    this.addDot(map, c, 14, '#ffffff', true);
                } else if (c === (ecgCol + 1) % 20) {
                    this.addDot(map, c, 16, '#00f2fe', true);
                } else {
                    this.addDot(map, c, 15, 'rgba(56, 189, 248, 0.4)');
                }
            }
        }

        // =====================================================================
        // ANIMATION 8: 👾 NEON INVADER
        // =====================================================================
        generateInvaderFrame(map) {
            const t = this.tick;
            const isDone = this.isComplete;
            const flap = (t % 28 < 14) ? 0 : 1;
            const iColor = isDone ? '#10b981' : ((t % 40 < 20) ? '#00f2fe' : '#a855f7');

            // Invader Top Antennae
            this.addDot(map, 6, 4, iColor); this.addDot(map, 13, 4, iColor);
            this.addDot(map, 7, 5, iColor); this.addDot(map, 12, 5, iColor);

            // Head & Body
            for (let c = 6; c <= 13; c++) this.addDot(map, c, 6, iColor);
            for (let c = 5; c <= 14; c++) this.addDot(map, c, 7, iColor);

            // Glowing Alien Eyes
            this.addDot(map, 7, 7, '#ffffff', true); this.addDot(map, 12, 7, '#ffffff', true);

            for (let c = 5; c <= 14; c++) this.addDot(map, c, 8, iColor);
            for (let c = 7; c <= 12; c++) this.addDot(map, c, 9, iColor);

            // Flapping Tentacles
            if (flap === 0) {
                this.addDot(map, 5, 10, iColor); this.addDot(map, 14, 10, iColor);
                this.addDot(map, 6, 11, iColor); this.addDot(map, 13, 11, iColor);
                this.addDot(map, 8, 10, iColor); this.addDot(map, 11, 10, iColor);
            } else {
                this.addDot(map, 4, 9, iColor); this.addDot(map, 15, 9, iColor);
                this.addDot(map, 4, 10, iColor); this.addDot(map, 15, 10, iColor);
                this.addDot(map, 7, 10, iColor); this.addDot(map, 12, 10, iColor);
            }

            // Laser projectile
            const laserY = 12 + Math.floor((t * 0.3) % 7);
            this.addDot(map, 9, laserY, '#ec4899', true);
            this.addDot(map, 10, laserY, '#ec4899', true);
        }

        // =====================================================================
        // ANIMATION 9: 🌀 MATRIX VORTEX
        // =====================================================================
        generateVortexFrame(map) {
            const t = this.tick;
            const isDone = this.isComplete;

            // Falling Matrix Digital Code Streams
            for (let c = 0; c < 20; c += 2) {
                const speed = 0.2 + (c % 5) * 0.05;
                const headY = Math.floor((t * speed + c * 3) % 20);
                this.addDot(map, c, headY, '#ffffff', true);
                this.addDot(map, c, (headY - 1 + 20) % 20, isDone ? '#10b981' : '#00f2fe');
                this.addDot(map, c, (headY - 2 + 20) % 20, isDone ? '#059669' : '#0369a1');
            }

            // Spinning Quantum Singularity in Center
            const ang = t * 0.1;
            for (let i = 0; i < 8; i++) {
                const a = ang + (i * Math.PI / 4);
                const r = 2.5 + Math.sin(t * 0.1 + i) * 1.0;
                const vx = Math.round(9.5 + Math.cos(a) * r);
                const vy = Math.round(9.5 + Math.sin(a) * r);
                this.addDot(map, vx, vy, isDone ? '#34d399' : '#ec4899', true);
            }
            this.addDot(map, 9, 9, '#ffffff', true); this.addDot(map, 10, 10, '#ffffff', true);
        }

        // =====================================================================
        // ANIMATION 10: ⚡ LASER BLADE
        // =====================================================================
        generateKatanaFrame(map) {
            const t = this.tick;
            const isDone = this.isComplete;
            const charge = (t % 24 < 12);

            // Diagonal Blade from (4, 15) to (15, 4)
            // Hilt / Tsuka
            this.addDot(map, 4, 15, '#475569');
            this.addDot(map, 5, 14, '#ec4899', true);
            this.addDot(map, 6, 13, '#475569');

            // Guard / Tsuba
            this.addDot(map, 6, 12, '#f59e0b', true);
            this.addDot(map, 7, 13, '#f59e0b', true);

            // Plasma Blade
            const bladeColor = isDone ? '#10b981' : '#00f2fe';
            for (let s = 1; s <= 9; s++) {
                const bx = 6 + s;
                const by = 13 - s;
                if (charge && s % 3 === 0) {
                    this.addDot(map, bx, by, '#ffffff', true);
                } else {
                    this.addDot(map, bx, by, bladeColor, true);
                }
            }

            // Discharging lightning sparks
            if (charge) {
                this.addDot(map, 10, 8, '#ffffff', true);
                this.addDot(map, 13, 5, '#ec4899', true);
                this.addDot(map, 14, 4, '#00f2fe', true);
            }
        }
    }

    // =========================================================================
    // 7. Cyber Hologram Dot-Matrix Progress Loader Controller
    // =========================================================================
    class CyberLoader {
        constructor() {
            this.container = document.getElementById('loading-skeleton');
            this.card = this.container ? this.container.querySelector('.cyber-dot-loader-card') : null;
            this.percentEl = document.getElementById('cyberLoadingPercent');
            this.statusEl = document.getElementById('cyberLoadingStatus');
            this.barEl = document.getElementById('cyberLoadingBar');
            this.screen = new DotMatrixScreen();

            this.progress = 0;
            this.targetProgress = 0;
            this.animTimer = null;
            this.stepTimer = null;
            this.isFinishing = false;
            this.isActive = false;

            this.statusStages = [
                { threshold: 0, text: '네트워크 패킷 분석 및 DB 동기화 중...' },
                { threshold: 25, text: '소설별 번역 단락 클러스터 매핑...' },
                { threshold: 55, text: '인덱스 검증 및 캐시 최적화 수행 중...' },
                { threshold: 82, text: '초고속 뷰포트 아코디언 구성 중...' },
                { threshold: 100, text: '동기화 완료! 단락 패널 준비됨' }
            ];

            this.initObserver();

            // Auto-start if skeleton container is active on load
            if (this.container && window.getComputedStyle(this.container).display !== 'none') {
                this.start();
            }
        }

        initObserver() {
            if (!this.container) return;
            this.observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.attributeName === 'style') {
                        const disp = this.container.style.display;
                        if (disp !== 'none' && !this.isActive && !this.isFinishing) {
                            this.start();
                        } else if (disp === 'none' && this.isActive && !this.isFinishing) {
                            this.stopTimers();
                            this.isActive = false;
                            if (this.screen) this.screen.stop();
                        }
                    }
                }
            });
            this.observer.observe(this.container, { attributes: true, attributeFilter: ['style'] });
        }

        start() {
            if (!this.container) return;
            this.stopTimers();
            this.isActive = true;
            this.isFinishing = false;
            this.progress = 0;
            this.targetProgress = 18;

            // Reset visual states
            this.container.classList.remove('fade-out');
            this.container.style.opacity = '1';
            this.container.style.transform = 'none';
            this.container.style.display = 'flex';
            if (this.card) this.card.classList.remove('loader-complete');
            if (this.screen) {
                this.screen.shuffleSequence();
                this.screen.setComplete(false);
                this.screen.start();
            }

            this.render();

            // Smooth high-frequency ticker
            this.animTimer = setInterval(() => {
                if (this.isFinishing) return;
                if (this.progress < this.targetProgress) {
                    const diff = this.targetProgress - this.progress;
                    const step = Math.max(0.35, diff * 0.12);
                    this.progress = Math.min(this.targetProgress, this.progress + step);
                    this.render();
                }
            }, 30);

            // Staged increments simulating real data streaming
            let stepIndex = 0;
            const nextStep = () => {
                if (!this.isActive || this.isFinishing) return;
                stepIndex++;
                if (stepIndex === 1) {
                    this.targetProgress = 38 + Math.random() * 12;
                    this.stepTimer = setTimeout(nextStep, 180 + Math.random() * 120);
                } else if (stepIndex === 2) {
                    this.targetProgress = 66 + Math.random() * 10;
                    this.stepTimer = setTimeout(nextStep, 260 + Math.random() * 140);
                } else if (stepIndex === 3) {
                    this.targetProgress = 86 + Math.random() * 6;
                    this.stepTimer = setTimeout(nextStep, 360 + Math.random() * 200);
                } else if (stepIndex >= 4) {
                    this.targetProgress = Math.min(96, this.targetProgress + 1.2);
                    this.stepTimer = setTimeout(nextStep, 450 + Math.random() * 250);
                }
            };
            this.stepTimer = setTimeout(nextStep, 100);
        }

        render() {
            const p = Math.floor(this.progress);
            if (this.percentEl) {
                this.percentEl.innerHTML = `${p}<span class="percent-symbol">%</span>`;
            }
            if (this.barEl) {
                this.barEl.style.width = `${Math.min(100, this.progress)}%`;
            }

            // Update status text
            let currentText = this.statusStages[0].text;
            for (const stage of this.statusStages) {
                if (p >= stage.threshold) {
                    currentText = stage.text;
                }
            }
            if (this.statusEl && this.statusEl.textContent !== currentText) {
                this.statusEl.textContent = currentText;
            }
        }

        finish() {
            if (!this.isActive && (!this.container || this.container.style.display === 'none')) {
                return Promise.resolve();
            }

            this.isFinishing = true;
            this.stopTimers();

            return new Promise((resolve) => {
                let curr = this.progress;
                const surgeInterval = setInterval(() => {
                    curr += 7;
                    if (curr >= 100) {
                        clearInterval(surgeInterval);
                        this.progress = 100;
                        this.render();

                        // Visual complete on screen & card
                        if (this.screen) this.screen.setComplete(true);
                        if (this.card) this.card.classList.add('loader-complete');
                        if (this.statusEl) this.statusEl.textContent = '동기화 완료! 단락 패널 준비됨';

                        // Sci-fi audio chime
                        soundEngine.playActionPulse();

                        // Short pause to appreciate 100% completion then fade out
                        setTimeout(() => {
                            if (this.container) {
                                this.container.classList.add('fade-out');
                                setTimeout(() => {
                                    if (this.container) {
                                        this.container.style.display = 'none';
                                        this.container.classList.remove('fade-out');
                                        if (this.card) this.card.classList.remove('loader-complete');
                                        if (this.screen) {
                                            this.screen.setComplete(false);
                                            this.screen.stop();
                                        }
                                    }
                                    this.isActive = false;
                                    this.isFinishing = false;
                                    resolve();
                                }, 280);
                            } else {
                                this.isActive = false;
                                this.isFinishing = false;
                                resolve();
                            }
                        }, 220);
                    } else {
                        this.progress = curr;
                        this.render();
                    }
                }, 16);
            });
        }

        stopTimers() {
            if (this.animTimer) {
                clearInterval(this.animTimer);
                this.animTimer = null;
            }
            if (this.stepTimer) {
                clearTimeout(this.stepTimer);
                this.stepTimer = null;
            }
        }
    }

    let cyberLoaderInstance = null;

    // =========================================================================
    // Initialization on DOM Ready
    // =========================================================================
    document.addEventListener('DOMContentLoaded', () => {
        try {
            new ParticleNebula();
            init3DTilt();
            setupInteractiveFeedback();
            initCyberHUD();
            cyberLoaderInstance = new CyberLoader();
            window.CyberLoader = cyberLoaderInstance;
            console.log('%c[LANOVEL CyberFX]%c Maximum Visual Engine & Dot Matrix Loader Running!', 'background: #3b82f6; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;', 'color: #38bdf8; font-weight: bold;');
        } catch (err) {
            console.error('[CyberFX] Initialization error:', err);
        }
    });

    // Expose engines globally
    window.CyberSound = soundEngine;
    window.CyberLoader = {
        start: () => cyberLoaderInstance && cyberLoaderInstance.start(),
        finish: () => cyberLoaderInstance ? cyberLoaderInstance.finish() : Promise.resolve()
    };
})();
