/* ============================================================
   effects.js : petits ajouts visuels et d'ergonomie
   - Bouton « œil » pour afficher / masquer les mots de passe
   - Avertissement « Verr. Maj. activée »
   - Halo lumineux qui suit la souris sur les cartes et sur la page
   - Confettis quand la candidature est bien envoyée
   N'a aucun lien avec la base de données : script.js n'est pas modifié.
   ============================================================ */
(function () {
    'use strict';

    /* ---------- Bouton œil ---------- */
    function setVisible(btn, input, show) {
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        var label = show ? 'Masquer le mot de passe' : 'Afficher le mot de passe';
        btn.setAttribute('aria-label', label);
        btn.title = label;
        var icon = btn.querySelector('i');
        if (icon) icon.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        btn.classList.remove('pop');
        void btn.offsetWidth; // relance l'animation
        btn.classList.add('pop');
    }

    var toggles = [];
    document.querySelectorAll('[data-toggle-password]').forEach(function (btn) {
        var input = document.getElementById(btn.getAttribute('data-toggle-password'));
        if (!input) return;
        toggles.push({ btn: btn, input: input });

        btn.addEventListener('click', function () {
            var show = input.type === 'password';
            setVisible(btn, input, show);
            input.focus({ preventScroll: true });
            // curseur à la fin du texte
            try { var n = input.value.length; input.setSelectionRange(n, n); } catch (e) {}
        });
    });

    function hideAll() {
        toggles.forEach(function (t) {
            if (t.input.type !== 'password') setVisible(t.btn, t.input, false);
        });
    }

    // Remet « masqué » quand un formulaire est vidé (changement de compte, déconnexion…)
    ['authForm', 'adminLoginForm'].forEach(function (id) {
        var f = document.getElementById(id);
        if (f) f.addEventListener('reset', function () { setTimeout(hideAll, 0); });
    });
    // Et à chaque ouverture / fermeture de la fenêtre admin
    ['headerAdminBtn', 'cancelAdminBtn', 'adminModalOverlay'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', hideAll);
    });
    var adminForm = document.getElementById('adminLoginForm');
    if (adminForm) adminForm.addEventListener('submit', function () { setTimeout(hideAll, 0); });

    /* ---------- Verr. Maj. ---------- */
    var pwd = document.getElementById('authPassword');
    var caps = document.getElementById('capsHint');
    if (pwd && caps) {
        var check = function (e) {
            if (!e.getModifierState) return;
            caps.classList.toggle('hidden', !e.getModifierState('CapsLock'));
        };
        pwd.addEventListener('keydown', check);
        pwd.addEventListener('keyup', check);
        pwd.addEventListener('blur', function () { caps.classList.add('hidden'); });
    }


    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- Halo doux qui suit la souris sur toute la page ---------- */
    if (!reduced && window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        var aura = document.createElement('div');
        aura.className = 'cursor-aura';
        aura.setAttribute('aria-hidden', 'true');
        document.body.appendChild(aura);
        var ax = window.innerWidth / 2, ay = window.innerHeight / 3, tx = ax, ty = ay;
        document.addEventListener('pointermove', function (e) { tx = e.clientX; ty = e.clientY; }, { passive: true });
        (function loop() {
            ax += (tx - ax) * 0.08; ay += (ty - ay) * 0.08;
            aura.style.transform = 'translate3d(' + ax.toFixed(1) + 'px,' + ay.toFixed(1) + 'px,0)';
            requestAnimationFrame(loop);
        })();
    }

    /* ---------- Confettis à l'envoi de la candidature ---------- */
    function confetti() {
        if (reduced) return;
        var cv = document.createElement('canvas');
        cv.setAttribute('aria-hidden', 'true');
        cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:70';
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var W = cv.width = window.innerWidth * dpr, H = cv.height = window.innerHeight * dpr;
        document.body.appendChild(cv);
        var ctx = cv.getContext('2d');
        var colors = ['#818cf8', '#a78bfa', '#f472b6', '#c4b5fd', '#f9a8d4', '#ffffff'];
        var parts = [];
        for (var i = 0; i < 90; i++) {
            var ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.5, sp = (7 + Math.random() * 9) * dpr;
            parts.push({
                x: W / 2, y: H * 0.38, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                w: (5 + Math.random() * 6) * dpr, h: (3 + Math.random() * 4) * dpr,
                r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
                c: colors[(Math.random() * colors.length) | 0]
            });
        }
        var start = performance.now(), DURATION = 2200;
        (function frame(now) {
            var t = now - start;
            ctx.clearRect(0, 0, W, H);
            ctx.globalAlpha = Math.max(0, 1 - t / DURATION);
            parts.forEach(function (p) {
                p.vy += 0.28 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
                ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
                ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
            });
            if (t < DURATION) requestAnimationFrame(frame); else cv.remove();
        })(start);
    }
    var okModal = document.getElementById('successModal');
    if (okModal && window.MutationObserver) {
        var wasHidden = okModal.classList.contains('hidden');
        new MutationObserver(function () {
            var hidden = okModal.classList.contains('hidden');
            if (wasHidden && !hidden) {
                // uniquement si la candidature est bien enregistrée (icône « check »)
                setTimeout(function () {
                    var ic = document.getElementById('modalIconI');
                    if (ic && ic.classList.contains('fa-check')) confetti();
                }, 250);
            }
            wasHidden = hidden;
        }).observe(okModal, { attributes: true, attributeFilter: ['class'] });
    }


    /* ---------- Aperçu du badge : le pseudo tapé apparaît en direct ---------- */
    document.querySelectorAll('[data-preview-from]').forEach(function (out) {
        var src = document.getElementById(out.getAttribute('data-preview-from'));
        if (!src) return;
        var fallback = out.getAttribute('data-preview-fallback') || '';
        var update = function () {
            var v = src.value.trim();
            out.textContent = v || fallback;
            out.classList.toggle('is-placeholder', !v);
        };
        src.addEventListener('input', update);
        var f = src.form;
        if (f) f.addEventListener('reset', function () { setTimeout(update, 0); });
        update();
    });

    /* ---------- Formulaire : coches vertes + progression du dossier ---------- */
    (function () {
        var form = document.getElementById('modForm');
        var strip = document.getElementById('dossierStrip');
        if (!form || !strip) return;
        var bar = document.getElementById('progressBar'), pct = document.getElementById('progressPct');
        var label = document.getElementById('progressLabel'), track = document.getElementById('progressTrack');
        var submit = document.getElementById('submitFormBtn');
        // poids : champs courts = rempli ; textareas = on récompense un texte un peu développé
        var fields = [
            { el: document.getElementById('pseudo'), full: 2 },
            { el: document.getElementById('playtime'), full: 3 },
            { el: document.getElementById('motivations'), full: 60 },
            { el: document.getElementById('experience'), full: 40 }
        ].filter(function (f) { return f.el; });

        function refresh() {
            var total = 0;
            fields.forEach(function (f) {
                var n = f.el.value.trim().length;
                var wrap = f.el.closest('.input-wrap');
                if (wrap) wrap.classList.toggle('filled', n > 0);
                total += Math.min(n / f.full, 1);
            });
            var p = Math.round(total / fields.length * 100);
            bar.style.width = p + '%';
            pct.textContent = p + ' %';
            track.setAttribute('aria-valuenow', p);
            var ready = p >= 100;
            strip.classList.toggle('is-ready', ready);
            if (submit) submit.classList.toggle('ready', ready);
            label.textContent = ready ? 'Prêt à envoyer' : (p === 0 ? 'Dossier à remplir' : 'Dossier en cours');
        }
        fields.forEach(function (f) { f.el.addEventListener('input', refresh); });
        form.addEventListener('reset', function () { setTimeout(refresh, 0); });
        refresh();
    })();

    /* ---------- Ciel étoilé discret ---------- */
    if (!reduced) {
        var sky = document.createElement('canvas');
        sky.className = 'starfield';
        sky.setAttribute('aria-hidden', 'true');
        document.body.insertBefore(sky, document.body.firstChild);
        var sctx = sky.getContext('2d'), stars = [], SW = 0, SH = 0, sdpr = Math.min(window.devicePixelRatio || 1, 2);
        var seed = function () {
            SW = sky.width = window.innerWidth * sdpr; SH = sky.height = window.innerHeight * sdpr;
            var count = Math.round(Math.min(110, window.innerWidth / 11));
            stars = [];
            for (var i = 0; i < count; i++) {
                stars.push({
                    x: Math.random() * SW, y: Math.random() * SH,
                    r: (0.4 + Math.random() * 1.2) * sdpr, ph: Math.random() * 6.28,
                    sp: 0.4 + Math.random() * 1.1, dy: (0.02 + Math.random() * 0.06) * sdpr,
                    pink: Math.random() < 0.22
                });
            }
        };
        seed();
        window.addEventListener('resize', seed);
        (function twinkle(t) {
            sctx.clearRect(0, 0, SW, SH);
            for (var i = 0; i < stars.length; i++) {
                var s = stars[i];
                s.y -= s.dy; if (s.y < -4) { s.y = SH + 4; s.x = Math.random() * SW; }
                var a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t / 1000 * s.sp + s.ph));
                sctx.globalAlpha = a;
                sctx.fillStyle = s.pink ? '#f9a8d4' : '#c7d2fe';
                sctx.beginPath(); sctx.arc(s.x, s.y, s.r, 0, 6.2832); sctx.fill();
            }
            requestAnimationFrame(twinkle);
        })(0);
    }

    /* ---------- Emblème : le bouclier s'incline vers la souris ---------- */
    (function () {
        var tilt = document.querySelector('.emblem-tilt');
        var wrap = document.querySelector('.emblem');
        if (!tilt || !wrap || !window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        document.addEventListener('pointermove', function (ev) {
            var r = wrap.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight) return;   // hors écran : rien à faire
            var dx = (ev.clientX - (r.left + r.width / 2)) / window.innerWidth;
            var dy = (ev.clientY - (r.top + r.height / 2)) / window.innerHeight;
            tilt.style.setProperty('--ry', (dx * 36).toFixed(2) + 'deg');
            tilt.style.setProperty('--rx', (-dy * 36).toFixed(2) + 'deg');
        }, { passive: true });
        document.addEventListener('pointerleave', function () {
            tilt.style.setProperty('--rx', '0deg'); tilt.style.setProperty('--ry', '0deg');
        });
    })();

    /* ---------- Halo qui suit la souris sur les cartes ---------- */
    document.addEventListener('pointermove', function (e) {
        var t = e.target;
        var card = t && t.closest ? t.closest('.card-main') : null;
        if (!card) return;
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
})();
