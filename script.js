// ============================================================
//  Candidature Modérateur : script principal
//  Base de données : Firebase Firestore (partagée entre tous les
//  visiteurs) avec un secours local si la base est injoignable.
// ============================================================

// ---------- Stockage local (secours) ----------
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

const APP_ID = 'mod-app-v3';
const FIREBASE_VERSIONS = ['13.0.0', '11.6.1'];
const ADMIN_PIN = 'EZ85//';

// ---------- État de la base en ligne ----------
let fb = null;                 // { db, fs, version }
let useCloudDB = false;        // true quand TOUTES les collections répondent
let cloudOk = { applications: false, users: false, retries: false };
let dbIssue = null;            // message d'erreur affiché dans l'admin
let unsubs = [];
let liveApps = [];
let liveUsers = [];
let liveRetries = {};
let lastAppData = null;
let cloudReady = Promise.resolve();
let adminTab = 'apps';

function isFirebaseConfigured() {
    return !!(window.firebaseConfig && window.firebaseConfig.apiKey);
}

// ---------- Utilitaires ----------
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Identifiant de document Firestore dérivé d'un pseudo (insensible à la casse)
function keyOf(name) {
    return encodeURIComponent(String(name || '').trim().toLowerCase()).replace(/\./g, '%2E');
}

function formatDate(iso) {
    return iso ? new Date(iso).toLocaleString('fr-FR') : '';
}

// SHA-256 en JavaScript pur (pas de dépendance au contexte sécurisé du navigateur)
function sha256Hex(message) {
    const K = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    const bytes = new TextEncoder().encode(message);
    const len = bytes.length;
    const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 4, (len * 8) >>> 0);
    dv.setUint32(padded.length - 8, Math.floor((len * 8) / 4294967296));

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    for (let off = 0; off < padded.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => x.toString(16).padStart(8, '0')).join('');
}

function hashPassword(password) {
    return 'sha256:' + sha256Hex('mod-v3:' + password);
}

function passwordMatches(user, password) {
    if (user.passwordHash) return user.passwordHash === hashPassword(password);
    return user.password === password; // anciens comptes locaux (migrés ensuite)
}

// ---------- Firebase : chargement et connexion ----------
function cloudDoc(name, id) {
    return fb.fs.doc(fb.db, 'artifacts', APP_ID, 'public', 'data', name, id);
}
function cloudCol(name) {
    return fb.fs.collection(fb.db, 'artifacts', APP_ID, 'public', 'data', name);
}

function explainCloudError(err) {
    const code = (err && (err.code || err.name)) || 'inconnu';
    const msg = (err && err.message) || String(err);
    if (/permission-denied|insufficient permissions/i.test(code + ' ' + msg)) {
        return 'Firestore refuse l\'accès (permission-denied). Dans la console Firebase : Firestore Database → onglet « Règles », colle le contenu du fichier firestore.rules puis clique sur « Publier ». (Les règles en « mode test » expirent après 30 jours.)';
    }
    if (/operation-not-allowed|admin-restricted-operation/i.test(code + ' ' + msg)) {
        return 'La connexion anonyme est désactivée. Console Firebase : Authentication → Sign-in method → active « Anonyme ».';
    }
    if (/not-found|unavailable|failed-precondition|database.*(not|does)/i.test(code + ' ' + msg)) {
        return 'La base Firestore est introuvable ou injoignable (' + code + '). Console Firebase : Firestore Database → « Créer une base de données », puis recharge la page.';
    }
    return 'Erreur Firebase (' + code + ') : ' + msg;
}

function setDbStatus(state) {
    const dot = document.getElementById('dbStatusDot');
    const text = document.getElementById('dbStatusText');
    if (dot && text) {
        const map = {
            local: ['#f59e0b', 'Base : mode local'],
            connecting: ['#60a5fa', 'Base : connexion…'],
            ok: ['#34d399', 'Base : en ligne'],
            error: ['#f87171', 'Base : erreur']
        };
        const [color, label] = map[state] || map.local;
        dot.style.backgroundColor = color;
        text.textContent = label;
    }
    renderDbIssue();
}

function renderDbIssue() {
    const box = document.getElementById('dbErrorBox');
    if (!box) return;
    if (dbIssue) {
        box.textContent = dbIssue;
        box.classList.remove('hidden');
    } else {
        box.classList.add('hidden');
    }
}

async function loadFirebaseSdk() {
    let lastErr;
    for (const v of FIREBASE_VERSIONS) {
        try {
            const base = 'https://www.gstatic.com/firebasejs/' + v + '/';
            const [appMod, authMod, fsMod] = await Promise.all([
                import(base + 'firebase-app.js'),
                import(base + 'firebase-auth.js'),
                import(base + 'firebase-firestore.js')
            ]);
            return { appMod, authMod, fsMod, version: v };
        } catch (e) {
            lastErr = e;
            console.warn('Firebase ' + v + ' non chargeable :', e);
        }
    }
    throw lastErr || new Error('Impossible de charger le SDK Firebase');
}

// Écoute une collection en temps réel ; résout true au 1er envoi de données
function listen(name, onData) {
    return new Promise(resolve => {
        let first = true;
        const unsub = fb.fs.onSnapshot(cloudCol(name), snap => {
            onData(snap);
            cloudOk[name] = true;
            if (first) { first = false; resolve(true); }
            refreshAdminIfOpen();
            refreshRetakeNotice();
        }, err => {
            console.warn('Firestore (' + name + ') :', err);
            cloudOk[name] = false;
            useCloudDB = false;
            dbIssue = explainCloudError(err);
            setDbStatus('error');
            if (first) { first = false; resolve(false); }
        });
        unsubs.push(unsub);
    });
}

async function initFirebase() {
    unsubs.forEach(u => { try { u(); } catch (e) {} });
    unsubs = [];
    useCloudDB = false;
    cloudOk = { applications: false, users: false, retries: false };
    dbIssue = null;

    if (!isFirebaseConfigured()) {
        dbIssue = 'Aucune configuration Firebase dans config.js : les données restent sur cet appareil uniquement.';
        setDbStatus('local');
        return;
    }

    setDbStatus('connecting');
    try {
        const { appMod, authMod, fsMod, version } = await loadFirebaseSdk();
        const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(window.firebaseConfig);

        try {
            const auth = authMod.getAuth(app);
            if (!auth.currentUser) await authMod.signInAnonymously(auth);
        } catch (e) {
            console.warn('Connexion anonyme impossible :', e);
            dbIssue = explainCloudError(e);
        }

        fb = { db: fsMod.getFirestore(app), fs: fsMod, version };

        const results = await Promise.all([
            listen('applications', snap => { liveApps = snap.docs.map(d => ({ ...d.data(), id: d.id })); }),
            listen('users', snap => { liveUsers = snap.docs.map(d => ({ ...d.data(), id: d.id })); }),
            listen('retries', snap => {
                liveRetries = {};
                snap.docs.forEach(d => { liveRetries[d.id] = !!d.data().requested; });
            })
        ]);

        if (results.every(Boolean)) {
            useCloudDB = true;
            dbIssue = null;
            setDbStatus('ok');
            await migrateLocalToCloud();
        } else {
            setDbStatus('error');
        }
    } catch (e) {
        console.warn('Firebase indisponible :', e);
        dbIssue = /import|fetch|network|load/i.test(String(e && e.message))
            ? 'Impossible de charger Firebase (connexion internet coupée ou bloqueur de publicités ?). Détail : ' + e.message
            : explainCloudError(e);
        setDbStatus('error');
    }
}

async function waitForCloud() {
    await Promise.race([cloudReady, new Promise(r => setTimeout(r, 8000))]);
}

// Envoie vers la base en ligne les données qui étaient seulement sur cet appareil
async function migrateLocalToCloud() {
    if (!useCloudDB) return;
    const localUsers = JSON.parse(safeStorage.getItem(DB_KEYS.USERS) || '[]');
    const localApps = JSON.parse(safeStorage.getItem(DB_KEYS.APPLICATIONS) || '[]');
    const localRetries = JSON.parse(safeStorage.getItem(DB_KEYS.RETRIES) || '{}');
    if (!localUsers.length && !localApps.length && !Object.keys(localRetries).length) return;

    const jobs = [];
    localUsers.forEach(u => {
        const k = keyOf(u.username);
        if (liveUsers.some(x => x.id === k)) return;
        jobs.push(fb.fs.setDoc(cloudDoc('users', k), {
            username: u.username,
            passwordHash: u.passwordHash || hashPassword(u.password || ''),
            createdAt: u.createdAt || new Date().toISOString()
        }));
    });
    localApps.forEach(a => {
        const id = 'app_' + keyOf(a.accountUser);
        if (liveApps.some(x => x.id === id)) return;
        jobs.push(fb.fs.setDoc(cloudDoc('applications', id), { ...a, id }));
    });
    Object.keys(localRetries).forEach(k => {
        if (!localRetries[k]) return;
        jobs.push(fb.fs.setDoc(cloudDoc('retries', keyOf(k)), { requested: true }));
    });

    const res = await Promise.allSettled(jobs);
    if (res.every(r => r.status === 'fulfilled')) {
        safeStorage.removeItem(DB_KEYS.USERS);
        safeStorage.removeItem(DB_KEYS.APPLICATIONS);
        safeStorage.removeItem(DB_KEYS.RETRIES);
    } else {
        console.warn('Migration locale → base incomplète, données locales conservées.');
    }
}

// ---------- Accès aux données ----------
function getCurrentUser() {
    return safeStorage.getItem(DB_KEYS.CURRENT_USER);
}

function setCurrentUser(username) {
    if (username) safeStorage.setItem(DB_KEYS.CURRENT_USER, username);
    else safeStorage.removeItem(DB_KEYS.CURRENT_USER);
}

function localList(key, fallback) {
    try { return JSON.parse(safeStorage.getItem(key) || fallback); } catch (e) { return JSON.parse(fallback); }
}

function getApplications() {
    return useCloudDB ? liveApps : localList(DB_KEYS.APPLICATIONS, '[]');
}

function getUsersList() {
    return useCloudDB ? liveUsers : localList(DB_KEYS.USERS, '[]');
}

function getRetries() {
    return useCloudDB ? liveRetries : localList(DB_KEYS.RETRIES, '{}');
}

function isRetryRequested(retries, username) {
    return !!(retries[keyOf(username)] || retries[String(username).toLowerCase()]);
}

async function findUser(username) {
    if (useCloudDB) {
        const snap = await fb.fs.getDoc(cloudDoc('users', keyOf(username)));
        return snap.exists() ? snap.data() : null;
    }
    const users = localList(DB_KEYS.USERS, '[]');
    return users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
}

async function saveUser(user) {
    if (useCloudDB) {
        await fb.fs.setDoc(cloudDoc('users', keyOf(user.username)), user);
        return 'cloud';
    }
    const users = localList(DB_KEYS.USERS, '[]');
    users.push(user);
    safeStorage.setItem(DB_KEYS.USERS, JSON.stringify(users));
    return 'local';
}

function saveLocalApplication(appData) {
    let apps = localList(DB_KEYS.APPLICATIONS, '[]');
    apps = apps.filter(a => a.accountUser !== appData.accountUser);
    apps.push(appData);
    safeStorage.setItem(DB_KEYS.APPLICATIONS, JSON.stringify(apps));
}

// Retourne 'cloud' ou 'local' selon l'endroit où la candidature a été enregistrée
async function saveApplication(appData) {
    if (useCloudDB) {
        try {
            await fb.fs.setDoc(cloudDoc('applications', appData.id), appData);
            return 'cloud';
        } catch (e) {
            console.warn('Enregistrement en ligne impossible :', e);
            dbIssue = explainCloudError(e);
            setDbStatus('error');
        }
    }
    saveLocalApplication(appData);
    return 'local';
}

async function removeApplication(id) {
    try {
        if (useCloudDB) {
            await fb.fs.deleteDoc(cloudDoc('applications', id));
        } else {
            const apps = localList(DB_KEYS.APPLICATIONS, '[]').filter(a => a.id !== id);
            safeStorage.setItem(DB_KEYS.APPLICATIONS, JSON.stringify(apps));
        }
    } catch (e) {
        alert('Suppression impossible : ' + explainCloudError(e));
    }
    renderAdmin();
}

async function removeUserAccount(username) {
    try {
        if (useCloudDB) {
            const key = keyOf(username);
            const appIds = liveApps.filter(a => String(a.accountUser).toLowerCase() === username.toLowerCase()).map(a => a.id);
            await Promise.all([
                fb.fs.deleteDoc(cloudDoc('users', key)),
                fb.fs.deleteDoc(cloudDoc('retries', key)),
                ...appIds.map(id => fb.fs.deleteDoc(cloudDoc('applications', id)))
            ]);
        } else {
            const lower = username.toLowerCase();
            safeStorage.setItem(DB_KEYS.USERS, JSON.stringify(localList(DB_KEYS.USERS, '[]').filter(u => u.username.toLowerCase() !== lower)));
            safeStorage.setItem(DB_KEYS.APPLICATIONS, JSON.stringify(localList(DB_KEYS.APPLICATIONS, '[]').filter(a => String(a.accountUser).toLowerCase() !== lower)));
            const retries = localList(DB_KEYS.RETRIES, '{}');
            delete retries[lower];
            safeStorage.setItem(DB_KEYS.RETRIES, JSON.stringify(retries));
        }
    } catch (e) {
        alert('Suppression impossible : ' + explainCloudError(e));
    }
    renderAdmin();
}

async function setRetry(username, val) {
    const key = keyOf(username);
    try {
        if (useCloudDB) {
            if (val) await fb.fs.setDoc(cloudDoc('retries', key), { requested: true });
            else await fb.fs.deleteDoc(cloudDoc('retries', key));
        } else {
            const retries = localList(DB_KEYS.RETRIES, '{}');
            if (val) retries[key] = true; else { delete retries[key]; delete retries[username.toLowerCase()]; }
            safeStorage.setItem(DB_KEYS.RETRIES, JSON.stringify(retries));
        }
    } catch (e) {
        console.warn(e);
        alert('Action impossible : ' + explainCloudError(e));
    }
}

function generateUniqueCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// ---------- Gestion des vues ----------
function showView(view) {
    ['authView', 'formView', 'adminView'].forEach(id => {
        document.getElementById(id).classList.toggle('hidden', id !== view);
    });
}

function updateHeader() {
    const user = getCurrentUser();
    document.getElementById('headerUserDisplay').textContent = user ? user : 'Non connecté';
}

function checkRetakeStatus(username) {
    const notice = document.getElementById('retakeNotice');
    if (username && isRetryRequested(getRetries(), username)) {
        notice.classList.remove('hidden');
    } else {
        notice.classList.add('hidden');
    }
}

function refreshRetakeNotice() {
    const cu = getCurrentUser();
    if (cu) checkRetakeStatus(cu);
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

// Mode d'authentification : 'login' ou 'register'
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

    const submitBtn = document.getElementById('authSubmitBtn');
    submitBtn.disabled = true;
    try {
        await waitForCloud();

        if (authMode === 'register') {
            const existing = await findUser(username);
            if (existing) {
                showAuthError('Ce nom d\'utilisateur est déjà pris.');
                return;
            }
            const where = await saveUser({
                username,
                passwordHash: hashPassword(password),
                createdAt: new Date().toISOString()
            });
            setCurrentUser(username);
            showAuthSuccess(where === 'cloud'
                ? 'Compte créé avec succès !'
                : 'Compte créé (mode local : la base en ligne est indisponible).');
            setTimeout(() => enterFormView(username), 400);
        } else {
            const user = await findUser(username);
            if (!user || !passwordMatches(user, password)) {
                showAuthError('Identifiant ou mot de passe incorrect.');
                return;
            }
            setCurrentUser(user.username);
            showAuthSuccess('Connexion réussie !');
            setTimeout(() => enterFormView(user.username), 300);
        }
    } catch (err) {
        console.warn(err);
        showAuthError('Erreur de base de données : ' + explainCloudError(err));
    } finally {
        submitBtn.disabled = false;
    }
}

async function enterFormView(username) {
    document.getElementById('authForm').reset();
    clearAuthMessages();
    updateHeader();
    checkRetakeStatus(username);
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

    const submitBtn = document.getElementById('submitFormBtn');
    submitBtn.disabled = true;
    try {
        await waitForCloud();

        const appData = {
            id: 'app_' + keyOf(username),
            accountUser: username,
            pseudo: document.getElementById('pseudo').value.trim(),
            playtime: document.getElementById('playtime').value.trim(),
            motivations: document.getElementById('motivations').value.trim(),
            experience: document.getElementById('experience').value.trim(),
            code: generateUniqueCode(),
            submittedAt: new Date().toISOString()
        };

        const where = await saveApplication(appData);
        await setRetry(username, false);
        document.getElementById('retakeNotice').classList.add('hidden');

        lastAppData = appData;

        const warn = document.getElementById('modalDbWarning');
        if (where === 'local' && isFirebaseConfigured()) {
            warn.textContent = 'Attention : la base en ligne est injoignable, ta candidature est seulement enregistrée sur cet appareil. Préviens un administrateur.';
            warn.classList.remove('hidden');
        } else {
            warn.classList.add('hidden');
        }

        document.getElementById('modalUniqueCode').textContent = appData.code;
        openModal('successModal');
        document.getElementById('modForm').reset();
    } finally {
        submitBtn.disabled = false;
    }
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

// ---------- Espace administrateur ----------
function renderAdminApplications() {
    const apps = getApplications();
    const grid = document.getElementById('applicationsGrid');
    document.getElementById('appCountBadge').textContent = apps.length + ' Candidature(s)';

    if (apps.length === 0) {
        grid.innerHTML = '<div class="text-center text-slate-400 text-sm py-10"><i class="fa-solid fa-inbox text-3xl mb-3 block"></i>Aucune candidature reçue pour le moment.</div>';
        return;
    }

    const retries = getRetries();

    grid.innerHTML = apps.slice().sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt))).reverse().map(app => {
        const retryRequested = isRetryRequested(retries, app.accountUser);
        const date = formatDate(app.submittedAt);
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
                    ${retryRequested ? '<span class="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs px-2.5 py-1 rounded-lg">Reprise demandée</span>' : ''}
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
                <button type="button" data-action="retry" data-user="${escapeHtml(app.accountUser)}" class="flex-1 text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 py-2 rounded-lg transition-colors cursor-pointer" ${retryRequested ? 'disabled' : ''}>
                    <i class="fa-solid fa-rotate-right mr-1"></i> ${retryRequested ? 'Reprise déjà demandée' : 'Demander une reprise'}
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
            renderAdmin();
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

function renderAdminUsers() {
    const users = getUsersList().slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const apps = getApplications();
    const grid = document.getElementById('usersGrid');
    document.getElementById('userCountBadge').textContent = users.length;

    if (users.length === 0) {
        grid.innerHTML = '<div class="text-center text-slate-400 text-sm py-10"><i class="fa-solid fa-users text-3xl mb-3 block"></i>Aucun compte créé pour le moment.</div>';
        return;
    }

    grid.innerHTML = users.map(u => {
        const app = apps.find(a => String(a.accountUser).toLowerCase() === String(u.username).toLowerCase());
        return `
        <div class="glass rounded-xl p-4 border border-white/5 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
                    <i class="fa-solid fa-user"></i>
                </div>
                <div>
                    <p class="text-white font-semibold text-sm">${escapeHtml(u.username)}</p>
                    <p class="text-xs text-slate-500">Inscrit le ${escapeHtml(formatDate(u.createdAt) || 'date inconnue')}</p>
                </div>
            </div>
            <div class="flex items-center gap-2">
                ${app
                    ? `<span class="bg-green-500/15 text-green-300 border border-green-500/30 text-xs px-2.5 py-1 rounded-lg">Candidature envoyée · <span class="font-mono">${escapeHtml(app.code)}</span></span>`
                    : '<span class="bg-slate-800 text-slate-400 border border-slate-700 text-xs px-2.5 py-1 rounded-lg">Pas encore de candidature</span>'}
                <button type="button" data-action="delete-user" data-user="${escapeHtml(u.username)}" class="text-xs bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
                    <i class="fa-solid fa-trash mr-1"></i> Supprimer le compte
                </button>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('[data-action="delete-user"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const name = btn.dataset.user;
            if (confirm('Supprimer le compte « ' + name + ' » et sa candidature ?')) {
                await removeUserAccount(name);
            }
        });
    });
}

function setAdminTab(tab) {
    adminTab = tab;
    const on = 'px-4 py-2 rounded-xl text-sm font-medium border cursor-pointer transition-colors bg-indigo-500/25 text-indigo-200 border-indigo-500/50';
    const off = 'px-4 py-2 rounded-xl text-sm font-medium border cursor-pointer transition-colors bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700';
    document.getElementById('tabAppsBtn').className = tab === 'apps' ? on : off;
    document.getElementById('tabUsersBtn').className = tab === 'users' ? on : off;
    document.getElementById('applicationsGrid').classList.toggle('hidden', tab !== 'apps');
    document.getElementById('usersGrid').classList.toggle('hidden', tab !== 'users');
}

function renderAdmin() {
    renderDbIssue();
    renderAdminApplications();
    renderAdminUsers();
}

function refreshAdminIfOpen() {
    const adminView = document.getElementById('adminView');
    if (adminView && !adminView.classList.contains('hidden')) renderAdmin();
}

function enterAdminView() {
    showView('adminView');
    setAdminTab(adminTab);
    renderAdmin();
}

function exitAdminView() {
    const user = getCurrentUser();
    showView(user ? 'formView' : 'authView');
    if (user) checkRetakeStatus(user);
}

// ---------- Démarrage ----------
document.addEventListener('DOMContentLoaded', () => {
    // Les boutons sont branchés EN PREMIER : Firebase ne doit jamais les bloquer
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
        if (pin === ADMIN_PIN) {
            document.getElementById('adminLoginError').classList.add('hidden');
            closeModal('adminLoginModal');
            enterAdminView();
        } else {
            document.getElementById('adminLoginError').classList.remove('hidden');
        }
    });
    document.getElementById('exitAdminBtn').addEventListener('click', exitAdminView);
    document.getElementById('tabAppsBtn').addEventListener('click', () => setAdminTab('apps'));
    document.getElementById('tabUsersBtn').addEventListener('click', () => setAdminTab('users'));
    document.getElementById('reconnectDbBtn').addEventListener('click', () => {
        cloudReady = initFirebase().catch(err => console.warn('Firebase non initialisé :', err));
    });

    // Restaurer la session
    const currentUser = getCurrentUser();
    updateHeader();
    if (currentUser) {
        checkRetakeStatus(currentUser);
        showView('formView');
    } else {
        showView('authView');
    }

    // Firebase est lancé en arrière-plan, sans bloquer l'interface
    cloudReady = initFirebase().catch(err => console.warn('Firebase non initialisé :', err));
});
