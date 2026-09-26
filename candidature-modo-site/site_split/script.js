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

            document.getElementById('modalUniqueCode').textContent = appData.code;
            openModal('successModal');
            document.getElementById('modForm').reset();
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
