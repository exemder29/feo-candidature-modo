        // Safe Storage Helper
        const memoryStorage = {};
        const safeStorage = {
            getItem: function(key) {
                try {
                    return localStorage.getItem(key);
                } catch(e) {
                    return memoryStorage[key] || null;
                }
            },
            setItem: function(key, val) {
                try {
                    localStorage.setItem(key, val);
                } catch(e) {
                    memoryStorage[key] = val;
                }
            },
            removeItem: function(key) {
                try {
                    localStorage.removeItem(key);
                } catch(e) {
                    delete memoryStorage[key];
                }
            }
        };

        const DB_KEYS = {
            USERS: 'mod_users_v3',
            CURRENT_USER: 'mod_current_user_v3',
            APPLICATIONS: 'mod_applications_v3',
            RETRIES: 'mod_retries_v3'
        };

        let db = null;
        let auth = null;
        let useCloudDB = false;
        let liveApps = [];
        let liveRetries = {};
        let lastAppData = null;

        // Dynamic Firebase Initializer
        async function initFirebase() {
            if (window.firebaseConfig && window.firebaseConfig.apiKey) {
                try {
                    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js");
                    const { getAuth, signInAnonymously } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js");
                    const { getFirestore, collection, onSnapshot } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");

                    const app = initializeApp(window.firebaseConfig);
                    auth = getAuth(app);
                    db = getFirestore(app);
                    await signInAnonymously(auth);
                    useCloudDB = true;

                    const appId = 'mod-app-v3';
                    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'applications'), (snapshot) => {
                        liveApps = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                        if (!document.getElementById('adminView').classList.contains('hidden')) {
                            renderAdminApplications();
                        }
                    }, err => console.warn("Firestore snapshot error:", err));

                    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'retries'), (snapshot) => {
                        liveRetries = {};
                        snapshot.docs.forEach(d => {
                            liveRetries[d.id] = d.data().requested || false;
                        });
                        const cu = getCurrentUser();
                        if (cu) checkRetakeStatus(cu);
                    }, err => console.warn("Firestore retries error:", err));

                } catch (e) {
                    console.warn("Cloud mode inactive, running on local storage:", e);
                }
            }
        }

        // Helper functions
        function escapeHtml(text) {
            if (!text) return '';
            return String(text)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function getCurrentUser() {
            return safeStorage.getItem(DB_KEYS.CURRENT_USER);
        }

        function setCurrentUser(username) {
            if (username) safeStorage.setItem(DB_KEYS.CURRENT_USER, username);
            else safeStorage.removeItem(DB_KEYS.CURRENT_USER);
        }

        async function getSavedUsers() {
            return JSON.parse(safeStorage.getItem(DB_KEYS.USERS) || '[]');
        }

        async function saveUser(newUser) {
            let users = JSON.parse(safeStorage.getItem(DB_KEYS.USERS) || '[]');
            users.push(newUser);
            safeStorage.setItem(DB_KEYS.USERS, JSON.stringify(users));
        }

        function getApplications() {
            if (useCloudDB && liveApps.length > 0) return liveApps;
            return JSON.parse(safeStorage.getItem(DB_KEYS.APPLICATIONS) || '[]');
        }

        async function saveApplication(appData) {
            let apps = JSON.parse(safeStorage.getItem(DB_KEYS.APPLICATIONS) || '[]');
            apps = apps.filter(a => a.accountUser !== appData.accountUser);
            apps.push(appData);
            safeStorage.setItem(DB_KEYS.APPLICATIONS, JSON.stringify(apps));

            if (useCloudDB && db) {
                try {
                    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
                    await setDoc(doc(db, 'artifacts', 'mod-app-v3', 'public', 'data', 'applications', appData.id), appData);
                } catch(e) { console.warn(e); }
            }
        }

        async function removeApplication(id) {
            let apps = JSON.parse(safeStorage.getItem(DB_KEYS.APPLICATIONS) || '[]');
            apps = apps.filter(a => a.id !== id);
            safeStorage.setItem(DB_KEYS.APPLICATIONS, JSON.stringify(apps));

            if (useCloudDB && db) {
                try {
                    const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
                    await deleteDoc(doc(db, 'artifacts', 'mod-app-v3', 'public', 'data', 'applications', id));
                } catch(e) { console.warn(e); }
            }
            renderAdminApplications();
        }

        function getRetries() {
            if (useCloudDB && Object.keys(liveRetries).length > 0) return liveRetries;
            return JSON.parse(safeStorage.getItem(DB_KEYS.RETRIES) || '{}');
        }

        async function setRetry(username, val) {
            let retries = JSON.parse(safeStorage.getItem(DB_KEYS.RETRIES) || '{}');
            if (val) retries[username.toLowerCase()] = true;
            else delete retries[username.toLowerCase()];
            safeStorage.setItem(DB_KEYS.RETRIES, JSON.stringify(retries));

            if (useCloudDB && db) {
                try {
                    const { doc, setDoc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js");
                    const ref = doc(db, 'artifacts', 'mod-app-v3', 'public', 'data', 'retries', username.toLowerCase());
                    if (val) await setDoc(ref, { requested: true });
                    else await deleteDoc(ref);
                } catch(e) { console.warn(e); }
            }
        }

        function generateUniqueCode() {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code = '';
            for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
            return code;
        }

        // View management
        function showView(view) {
            ['authView', 'formView', 'adminView'].forEach(id => {
                document.getElementById(id).classList.toggle('hidden', id !== view);
            });
        }

        function updateHeader() {
            const user = getCurrentUser();
            document.getElementById('headerUserDisplay').textContent = user ? user : 'Non connecté';
        }

        async function checkRetakeStatus(username) {
            const retries = getRetries();
            const notice = document.getElementById('retakeNotice');
            if (username && retries[username.toLowerCase()]) {
                notice.classList.remove('hidden');
            } else {
                notice.classList.add('hidden');
            }
        }

        function showAuthError(msg) {
            const el = document.getElementById('authError');
            el.textContent = msg;
            el.classList.remove('hidden');
            document.getElementById('authSuccess').classList.add('hidden');
        }

        function showAuthSuccess(msg) {
            const el = document.getElementById('authSuccess');
            el.textContent = msg;
            el.classList.remove('hidden');
            document.getElementById('authError').classList.add('hidden');
        }

        function clearAuthMessages() {
            document.getElementById('authError').classList.add('hidden');
            document.getElementById('authSuccess').classList.add('hidden');
        }

        // Auth mode: 'login' or 'register'
        let authMode = 'login';

        function setAuthMode(mode) {
            authMode = mode;
            clearAuthMessages();
            const title = document.getElementById('authTitle');
            const subtitle = document.getElementById('authSubtitle');
            const submitBtn = document.getElementById('authSubmitBtn');
            const toggleText = document.getElementById('authToggleText');

            if (mode === 'login') {
                title.textContent = 'Connexion requise';
                subtitle.textContent = 'Connectez-vous ou créez un compte pour soumettre votre candidature.';
                submitBtn.textContent = 'Se connecter';
                toggleText.innerHTML = 'Pas encore de compte ? <button type="button" id="authToggleBtn" class="text-indigo-400 hover:text-indigo-300 font-medium ml-1 underline cursor-pointer">S\'inscrire</button>';
            } else {
                title.textContent = 'Créer un compte';
                subtitle.textContent = 'Choisissez un pseudo et un mot de passe pour votre candidature.';
                submitBtn.textContent = "S'inscrire";
                toggleText.innerHTML = 'Déjà un compte ? <button type="button" id="authToggleBtn" class="text-indigo-400 hover:text-indigo-300 font-medium ml-1 underline cursor-pointer">Se connecter</button>';
            }
            document.getElementById('authToggleBtn').addEventListener('click', () => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
            });
        }

        async function handleAuthSubmit(e) {
            e.preventDefault();
            clearAuthMessages();
            const username = document.getElementById('authUsername').value.trim();
            const password = document.getElementById('authPassword').value;

            if (!username || !password) {
                showAuthError('Veuillez remplir tous les champs.');
                return;
            }

            const users = await getSavedUsers();

            if (authMode === 'register') {
                const exists = users.some(u => u.username.toLowerCase() === username.toLowerCase());
                if (exists) {
                    showAuthError('Ce nom d\'utilisateur est déjà pris.');
                    return;
                }
                await saveUser({ username, password });
                setCurrentUser(username);
                showAuthSuccess('Compte créé avec succès !');
                setTimeout(() => enterFormView(username), 400);
            } else {
                const match = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
                if (!match) {
                    showAuthError('Identifiant ou mot de passe incorrect.');
                    return;
                }
                setCurrentUser(match.username);
                showAuthSuccess('Connexion réussie !');
                setTimeout(() => enterFormView(match.username), 300);
            }
        }

        async function enterFormView(username) {
            document.getElementById('authForm').reset();
            clearAuthMessages();
            updateHeader();
            await checkRetakeStatus(username);
            showView('formView');
        }

        function handleLogout() {
            setCurrentUser(null);
            document.getElementById('modForm').reset();
            document.getElementById('authForm').reset();
            setAuthMode('login');
            updateHeader();
            showView('authView');
        }

        async function handleModFormSubmit(e) {
            e.preventDefault();
            const username = getCurrentUser();
            if (!username) {
                showView('authView');
                return;
            }

            const appData = {
                id: 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                accountUser: username,
                pseudo: document.getElementById('pseudo').value.trim(),
                playtime: document.getElementById('playtime').value.trim(),
                motivations: document.getElementById('motivations').value.trim(),
                experience: document.getElementById('experience').value.trim(),
                code: generateUniqueCode(),
                submittedAt: new Date().toISOString()
            };

            await saveApplication(appData);
            await setRetry(username, false);
            document.getElementById('retakeNotice').classList.add('hidden');

            lastAppData = appData;

            document.getElementById('modalUniqueCode').textContent = appData.code;
            openModal('successModal');
            document.getElementById('modForm').reset();
        }

        function buildApplicationHtml(appData) {
            const date = appData.submittedAt ? new Date(appData.submittedAt).toLocaleString('fr-FR') : '';
            const esc = escapeHtml;
            return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Candidature - ${esc(appData.pseudo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
        margin: 0;
        font-family: 'Inter', sans-serif;
        background-color: #0b0f19;
        background-image:
            radial-gradient(at 0% 0%, hsla(253, 35%, 12%, 1) 0, transparent 50%),
            radial-gradient(at 50% 0%, hsla(225, 45%, 18%, 0.4) 0, transparent 50%),
            radial-gradient(at 100% 0%, hsla(339, 45%, 18%, 0.4) 0, transparent 50%);
        color: #f1f5f9;
        min-height: 100vh;
        padding: 40px 16px;
    }
    h1, h2, h3 { font-family: 'Poppins', sans-serif; margin: 0; }
    .wrap { max-width: 640px; margin: 0 auto; }
    .card {
        background: rgba(17, 24, 39, 0.78);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
        border-radius: 20px;
        padding: 32px;
        position: relative;
        overflow: hidden;
    }
    .card::before {
        content: '';
        position: absolute; top: 0; left: 0; width: 100%; height: 4px;
        background: linear-gradient(90deg, #4f46e5, #7c3aed, #db2777);
    }
    .header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
    .badge {
        width: 46px; height: 46px; border-radius: 14px;
        background: rgba(99, 102, 241, 0.15); color: #818cf8;
        display: flex; align-items: center; justify-content: center;
        border: 1px solid rgba(99, 102, 241, 0.3); font-size: 20px;
    }
    .eyebrow { text-transform: uppercase; letter-spacing: 0.05em; font-size: 11px; color: #818cf8; font-weight: 600; }
    h1 { font-size: 22px; color: #fff; }
    .meta { font-size: 12px; color: #94a3b8; margin-top: 4px; }
    .code-box {
        display: flex; align-items: center; justify-content: space-between;
        background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 14px; padding: 16px 18px; margin: 22px 0;
    }
    .code-box span.label { font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; display: block; }
    .code-box span.code { font-size: 26px; font-weight: 800; letter-spacing: 0.08em; color: #818cf8; font-family: 'Courier New', monospace; }
    .section { margin-bottom: 20px; }
    .section h2 {
        font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
        color: #94a3b8; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;
    }
    .section h2 i { color: #818cf8; }
    .section p {
        margin: 0; font-size: 14.5px; line-height: 1.6; color: #e2e8f0;
        white-space: pre-wrap; background: rgba(15, 23, 42, 0.5);
        border: 1px solid rgba(148, 163, 184, 0.12); border-radius: 12px; padding: 14px 16px;
    }
    .footer {
        margin-top: 26px; padding-top: 18px; border-top: 1px solid rgba(148, 163, 184, 0.15);
        font-size: 12px; color: #64748b; text-align: center;
    }
    .footer i { color: #6366f1; margin-right: 4px; }
</style>
</head>
<body>
<div class="wrap">
    <div class="card">
        <div class="header">
            <div class="badge"><i class="fa-solid fa-shield-halved"></i></div>
            <div>
                <span class="eyebrow">Candidature Modérateur</span>
                <h1>${esc(appData.pseudo)}</h1>
                <div class="meta">Compte : ${esc(appData.accountUser)} &middot; ${esc(date)}</div>
            </div>
        </div>

        <div class="code-box">
            <div>
                <span class="label">Code unique</span>
                <span class="code">${esc(appData.code)}</span>
            </div>
            <i class="fa-solid fa-key" style="color:#818cf8; font-size:20px;"></i>
        </div>

        <div class="section">
            <h2><i class="fa-regular fa-clock"></i> Temps de jeu &amp; Disponibilités</h2>
            <p>${esc(appData.playtime)}</p>
        </div>

        <div class="section">
            <h2><i class="fa-solid fa-pen-nib"></i> Motivations</h2>
            <p>${esc(appData.motivations)}</p>
        </div>

        <div class="section">
            <h2><i class="fa-solid fa-award"></i> Expérience en modération</h2>
            <p>${esc(appData.experience)}</p>
        </div>

        <div class="footer">
            <i class="fa-brands fa-discord"></i> Envoyez ce fichier sur le Discord, dans le salon de candidature, avec votre code unique.
        </div>
    </div>
</div>
</body>
</html>`;
        }

        function downloadApplication(appData) {
            if (!appData) return;
            const content = buildApplicationHtml(appData);
            const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const safeName = (appData.pseudo || appData.accountUser || 'candidature').replace(/[^a-z0-9_-]+/gi, '_');
            a.href = url;
            a.download = `candidature_${safeName}_${appData.code}.html`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }

        function openModal(id) {
            const modal = document.getElementById(id);
            modal.classList.remove('hidden');
            requestAnimationFrame(() => {
                modal.classList.remove('opacity-0');
                const content = modal.querySelector('.glass');
                if (content) content.classList.remove('scale-95');
            });
        }

        function closeModal(id) {
            const modal = document.getElementById(id);
            modal.classList.add('opacity-0');
            const content = modal.querySelector('.glass');
            if (content) content.classList.add('scale-95');
            setTimeout(() => modal.classList.add('hidden'), 300);
        }

        function renderAdminApplications() {
            const apps = getApplications();
            const grid = document.getElementById('applicationsGrid');
            const badge = document.getElementById('appCountBadge');
            badge.textContent = apps.length + ' Candidature(s)';

            if (apps.length === 0) {
                grid.innerHTML = '<div class="text-center text-slate-400 text-sm py-10"><i class="fa-solid fa-inbox text-3xl mb-3 block"></i>Aucune candidature reçue pour le moment.</div>';
                return;
            }

            const retries = getRetries();

            grid.innerHTML = apps.slice().reverse().map(app => {
                const isRetryRequested = !!retries[app.accountUser.toLowerCase()];
                const date = app.submittedAt ? new Date(app.submittedAt).toLocaleString('fr-FR') : '';
                return `
                <div class="glass rounded-xl p-5 border border-white/5">
                    <div class="flex flex-wrap justify-between items-start gap-3 mb-3">
                        <div>
                            <h3 class="text-lg font-bold text-white flex items-center gap-2">
                                <i class="fa-solid fa-gamepad text-indigo-400 text-sm"></i> ${escapeHtml(app.pseudo)}
                            </h3>
                            <p class="text-xs text-slate-500">Compte : ${escapeHtml(app.accountUser)} · ${escapeHtml(date)}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono px-2.5 py-1 rounded-lg">${escapeHtml(app.code)}</span>
                            ${isRetryRequested ? '<span class="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs px-2.5 py-1 rounded-lg">Reprise demandée</span>' : ''}
                        </div>
                    </div>
                    <div class="grid sm:grid-cols-2 gap-3 text-sm mb-4">
                        <div>
                            <span class="text-slate-400 text-xs uppercase font-semibold block mb-1">Disponibilités</span>
                            <p class="text-slate-200">${escapeHtml(app.playtime)}</p>
                        </div>
                        <div>
                            <span class="text-slate-400 text-xs uppercase font-semibold block mb-1">Expérience</span>
                            <p class="text-slate-200 whitespace-pre-wrap">${escapeHtml(app.experience)}</p>
                        </div>
                    </div>
                    <div class="mb-4">
                        <span class="text-slate-400 text-xs uppercase font-semibold block mb-1">Motivations</span>
                        <p class="text-slate-200 whitespace-pre-wrap">${escapeHtml(app.motivations)}</p>
                    </div>
                    <div class="flex gap-2 pt-3 border-t border-slate-700/50">
                        <button type="button" data-action="retry" data-user="${escapeHtml(app.accountUser)}" class="flex-1 text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 py-2 rounded-lg transition-colors cursor-pointer" ${isRetryRequested ? 'disabled' : ''}>
                            <i class="fa-solid fa-rotate-right mr-1"></i> ${isRetryRequested ? 'Reprise déjà demandée' : 'Demander une reprise'}
                        </button>
                        <button type="button" data-action="delete" data-id="${escapeHtml(app.id)}" class="flex-1 text-xs bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 py-2 rounded-lg transition-colors cursor-pointer">
                            <i class="fa-solid fa-trash mr-1"></i> Supprimer
                        </button>
                    </div>
                </div>`;
            }).join('');

            grid.querySelectorAll('[data-action="retry"]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await setRetry(btn.dataset.user, true);
                    renderAdminApplications();
                });
            });
            grid.querySelectorAll('[data-action="delete"]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (confirm('Supprimer définitivement cette candidature ?')) {
                        await removeApplication(btn.dataset.id);
                    }
                });
            });
        }

        function enterAdminView() {
            showView('adminView');
            renderAdminApplications();
        }

        function exitAdminView() {
            const user = getCurrentUser();
            showView(user ? 'formView' : 'authView');
            if (user) checkRetakeStatus(user);
        }

        // Event listeners
        document.addEventListener('DOMContentLoaded', async () => {
            await initFirebase();

            setAuthMode('login');
            document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
            document.getElementById('modForm').addEventListener('submit', handleModFormSubmit);
            document.getElementById('logoutBtn').addEventListener('click', handleLogout);

            document.getElementById('closeModalBtn').addEventListener('click', () => closeModal('successModal'));
            document.getElementById('modalOverlay').addEventListener('click', () => closeModal('successModal'));
            document.getElementById('downloadAppBtn').addEventListener('click', () => {
                downloadApplication(lastAppData);
            });
            document.getElementById('copyCodeBtn').addEventListener('click', () => {
                const code = document.getElementById('modalUniqueCode').textContent;
                navigator.clipboard?.writeText(code).catch(() => {});
                const btn = document.getElementById('copyCodeBtn');
                const original = btn.innerHTML;
                btn.innerHTML = '<i class="fa-solid fa-check"></i> Copié';
                setTimeout(() => { btn.innerHTML = original; }, 1500);
            });

            document.getElementById('headerAdminBtn').addEventListener('click', () => {
                document.getElementById('adminPinInput').value = '';
                document.getElementById('adminLoginError').classList.add('hidden');
                openModal('adminLoginModal');
            });
            document.getElementById('cancelAdminBtn').addEventListener('click', () => closeModal('adminLoginModal'));
            document.getElementById('adminModalOverlay').addEventListener('click', () => closeModal('adminLoginModal'));
            document.getElementById('adminLoginForm').addEventListener('submit', (e) => {
                e.preventDefault();
                const pin = document.getElementById('adminPinInput').value;
                if (pin === 'EZ85//') {
                    document.getElementById('adminLoginError').classList.add('hidden');
                    closeModal('adminLoginModal');
                    enterAdminView();
                } else {
                    document.getElementById('adminLoginError').classList.remove('hidden');
                }
            });
            document.getElementById('exitAdminBtn').addEventListener('click', exitAdminView);

            // Restore session
            const currentUser = getCurrentUser();
            updateHeader();
            if (currentUser) {
                await checkRetakeStatus(currentUser);
                showView('formView');
            } else {
                showView('authView');
            }
        });
