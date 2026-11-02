require('dotenv').config();

const express = require('express');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID, randomBytes, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const scryptAsync = promisify(scrypt);

// ─── Initialisation Express & HTTP ───────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);

// ─── Socket.io (optionnel) ────────────────────────────────────────────────────
let io;
try {
    const { Server } = require('socket.io');
    io = new Server(server, { cors: { origin: process.env.FRONTEND_URL || process.env.PUBLIC_URL || false, methods: ['GET', 'POST'] } });
} catch (e) {
    console.warn('Socket.io non chargé:', e.message);
}

// ─── Configuration ────────────────────────────────────────────────────────────
const PORT       = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET || '';
const publicUrl  = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
const allowedOrigin = process.env.FRONTEND_URL || publicUrl;
const root = __dirname;

// Coordonnées IMO SN (modifiables via admin ou variables d'env)
const IMO_PHONE   = process.env.IMO_PHONE   || '+221789846529';
const IMO_WHATSAPP = process.env.IMO_WHATSAPP || '+221789846529';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';
const SUPABASE_STATE_TABLE = 'imo_sn_app_state';
let databaseWriteQueue = Promise.resolve();

// ─── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors({ origin: allowedOrigin }));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; " +
        "img-src 'self' https: data:; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
        "script-src 'self' 'unsafe-inline' https://cdn.socket.io https://cdnjs.cloudflare.com; " +
        "connect-src 'self' https: wss:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com"
    );
    next();
});
const standardJsonParser = express.json({ limit: '1mb' });
const adminPropertyJsonParser = express.json({ limit: '30mb' });
const standardFormParser = express.urlencoded({ extended: true, limit: '1mb' });
const isAdminPropertyRequest = req => /^\/api\/admin\/biens(?:\/|$)/.test(req.path);
app.use((req, res, next) => {
    if (isAdminPropertyRequest(req)) return next();
    return standardJsonParser(req, res, next);
});
app.use((req, res, next) => {
    if (isAdminPropertyRequest(req)) return next();
    return standardFormParser(req, res, next);
});
function ensureJsonObject(req, res, next) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
    next();
}
app.use((req, res, next) => isAdminPropertyRequest(req) ? next() : ensureJsonObject(req, res, next));

const asyncHandler = (handler) => (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

// ─── JWT Middlewares ──────────────────────────────────────────────────────────
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Accès non autorisé' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Session expirée ou invalide.' });
        req.user = decoded;
        next();
    });
}

function requireAdmin(req, res, next) {
    authenticateToken(req, res, () => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Accès réservé à l\'administrateur IMO SN.' });
        }
        next();
    });
}

// ─── Persistance JSON / Supabase ───────────────────────────────────────────────
const DATA_DIR = path.join(root, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
    properties: [
        {
            id: "1",
            title: "Villa Moderne de Luxe",
            type: "vente",
            category: "Villa",
            price: 185000000,
            priceFormatted: "185 000 000 FCFA",
            location: "Almadies, Dakar",
            city: "Dakar",
            neighborhood: "Almadies",
            bedrooms: 5,
            bathrooms: 3,
            area: 450,
            views: 342,
            featured: true,
            status: "disponible",
            published: true,
            images: [
                "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&h=550&fit=crop&q=80",
                "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&h=550&fit=crop&q=80"
            ],
            description: "Superbe villa contemporaine située dans le quartier résidentiel et sécurisé des Almadies. Finitions haut de gamme, piscine privée, grand jardin paysager, cuisine équipée et groupe électrogène.",
            createdAt: new Date().toISOString()
        },
        {
            id: "2",
            title: "Appartement Meublé Standing",
            type: "location",
            category: "Appartement",
            price: 750000,
            priceFormatted: "750 000 FCFA / mois",
            location: "Plateau, Dakar",
            city: "Dakar",
            neighborhood: "Plateau",
            bedrooms: 3,
            bathrooms: 2,
            area: 180,
            views: 512,
            featured: true,
            status: "disponible",
            published: true,
            images: [
                "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&h=550&fit=crop&q=80",
                "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&h=550&fit=crop&q=80"
            ],
            description: "Appartement meublé avec goût en plein centre-ville au Plateau. Vue dégagée, sécurité 24h/24, ascenseur, fibre optique et parking sous-sol inclus.",
            createdAt: new Date().toISOString()
        },
        {
            id: "3",
            title: "Villa Balnéaire avec Piscine",
            type: "vente",
            category: "Villa",
            price: 120000000,
            priceFormatted: "120 000 000 FCFA",
            location: "Saly, Mbour",
            city: "Mbour",
            neighborhood: "Saly",
            bedrooms: 4,
            bathrooms: 3,
            area: 380,
            views: 289,
            featured: true,
            status: "disponible",
            published: true,
            images: [
                "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&h=550&fit=crop&q=80"
            ],
            description: "Magnifique propriété à 5 minutes de la plage de Saly. Grande piscine lagon, terrasse couverte, salon spacieux et dépendance gardien.",
            createdAt: new Date().toISOString()
        },
        {
            id: "4",
            title: "Terrain Viabilisé & Titre Foncier",
            type: "vente",
            category: "Terrain",
            price: 25000000,
            priceFormatted: "25 000 000 FCFA",
            location: "Diamniadio, Dakar",
            city: "Dakar",
            neighborhood: "Diamniadio",
            bedrooms: 0,
            bathrooms: 0,
            area: 500,
            views: 198,
            featured: false,
            status: "disponible",
            published: true,
            images: [
                "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&h=550&fit=crop&q=80"
            ],
            description: "Parcelle viabilisée (eau, électricité, assainissement) avec Titre Foncier individuel. Emplacement stratégique à proximité des ministères et du TER.",
            createdAt: new Date().toISOString()
        },
        {
            id: "5",
            title: "Duplex Haut Standing",
            type: "location",
            category: "Duplex",
            price: 1200000,
            priceFormatted: "1 200 000 FCFA / mois",
            location: "Mermoz, Dakar",
            city: "Dakar",
            neighborhood: "Mermoz",
            bedrooms: 4,
            bathrooms: 3,
            area: 300,
            views: 430,
            featured: true,
            status: "disponible",
            published: true,
            images: [
                "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&h=550&fit=crop&q=80"
            ],
            description: "Duplex spacieux et très lumineux à Mermoz. Quartier calme, double salon, suite parentale avec dressing, climatisation intégrale et groupe électrogène.",
            createdAt: new Date().toISOString()
        },
        {
            id: "6",
            title: "Appartement Vue Mer Panoramique",
            type: "vente",
            category: "Appartement",
            price: 65000000,
            priceFormatted: "65 000 000 FCFA",
            location: "Ngor, Dakar",
            city: "Dakar",
            neighborhood: "Ngor",
            bedrooms: 3,
            bathrooms: 2,
            area: 200,
            views: 671,
            featured: true,
            status: "disponible",
            published: true,
            images: [
                "https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=800&h=550&fit=crop&q=80"
            ],
            description: "Appartement avec balcon terrasse offrant une vue imprenable sur l'île de Ngor et le coucher de soleil. Résidence récente avec ascenseur.",
            createdAt: new Date().toISOString()
        }
    ],
    users: [],
    messages: [],
    contactRequests: [],
    ads: [],
    siteConfig: {
        companyName: "IMO SN",
        tagline: "Votre partenaire immobilier de confiance au Sénégal",
        address: "Malika, Cité Sonatel, Dakar, Sénégal",
        phone: "+221 78 984 65 29",
        whatsapp: "+221789846529",
        email: "contact@imo-sn.com",
        hours: "Lun - Sam : 8h - 18h",
        facebook: "",
        instagram: "",
        linkedin: "",
        twitter: ""
    }
};

function loadJsonDatabase() {
    if (fs.existsSync(DB_FILE)) {
        const content = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(content);
        let migrated = false;
        parsed.properties = (parsed.properties || []).map(property => {
            const { landlord, ...publishedData } = property;
            if (landlord) migrated = true;
            return { status: 'disponible', published: true, ...publishedData };
        });
        for (const key of ['users', 'messages', 'contactRequests', 'ads']) {
            if (!Array.isArray(parsed[key])) {
                parsed[key] = [];
                migrated = true;
            }
        }
        const adminUsers = parsed.users.filter(user => user?.role === 'admin');
        if (adminUsers.length !== parsed.users.length) migrated = true;
        parsed.users = adminUsers;
        if (!parsed.siteConfig) {
            parsed.siteConfig = { ...DEFAULT_DB.siteConfig };
            migrated = true;
        }
        if (migrated && !SUPABASE_URL) saveJsonDatabase(parsed);
        return parsed;
    }
    if (!SUPABASE_URL) saveJsonDatabase(DEFAULT_DB);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
}

function saveJsonDatabase(data) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    const temporaryFile = `${DB_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(temporaryFile, DB_FILE);
}

async function supabaseRequest(pathname, options = {}) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
        ...options,
        signal: AbortSignal.timeout(15000),
        headers: {
            apikey: SUPABASE_SECRET_KEY,
            Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        }
    });
    const responseText = await response.text();
    let result;
    try {
        result = responseText ? JSON.parse(responseText) : null;
    } catch {
        result = null;
    }
    if (!response.ok) {
        const detail = typeof result?.message === 'string' ? ` ${result.message}` : '';
        throw new Error(`Supabase a refusé la requête (HTTP ${response.status}).${detail}`);
    }
    return result;
}

async function saveDatabase(data) {
    if (!SUPABASE_URL) {
        saveJsonDatabase(data);
        return;
    }

    const state = JSON.stringify(data);
    const write = databaseWriteQueue.then(() => supabaseRequest(
        `${SUPABASE_STATE_TABLE}?on_conflict=id`,
        {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ id: 'main', state: JSON.parse(state), updated_at: new Date().toISOString() })
        }
    ));
    databaseWriteQueue = write.catch(error => {
        console.error('[DATABASE] Synchronisation Supabase échouée:', error.message);
    });
    await write;
}

async function loadDatabase() {
    if (!SUPABASE_URL) return loadJsonDatabase();

    const rows = await supabaseRequest(
        `${SUPABASE_STATE_TABLE}?id=eq.main&select=state`
    );
    if (Array.isArray(rows) && rows.length > 0 && rows[0]?.state) {
        const state = rows[0].state;
        if (typeof state !== 'object' || Array.isArray(state))
            throw new Error('La base Supabase contient un état IMO SN invalide.');
        return state;
    }

    const initialState = loadJsonDatabase();
    await saveDatabase(initialState);
    console.log('[DATABASE] Données locales importées dans Supabase.');
    return initialState;
}

let db;

// ─── Création automatique du compte admin ─────────────────────────────────────
async function ensureAdminAccount() {
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    const existing = db.users.find(u => u.role === 'admin');
    if (existing) return;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || adminPassword.length < 12) {
        throw new Error('Configurez ADMIN_EMAIL et un ADMIN_PASSWORD d’au moins 12 caractères avant le premier démarrage.');
    }

    const user = {
        id: randomUUID(),
        identifier: adminEmail,
        name: 'Administrateur IMO SN',
        email: adminEmail,
        phone: IMO_PHONE,
        passwordHash: await hashPassword(adminPassword),
        role: 'admin',
        createdAt: new Date().toISOString()
    };
    db.users.push(user);
    await saveDatabase(db);
    console.log('[ADMIN] Compte administrateur initial créé.');
}

// ─── Helpers Auth ─────────────────────────────────────────────────────────────
const hashPassword = async (password) => {
    const salt = randomBytes(16).toString('hex');
    const hash = await scryptAsync(password, salt, 64);
    return `${salt}:${hash.toString('hex')}`;
};

const verifyPassword = async (password, passwordHash) => {
    const [salt, storedHash] = String(passwordHash || '').split(':');
    if (!salt || !storedHash) return false;
    const expected = Buffer.from(storedHash, 'hex');
    const actual   = await scryptAsync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const createAuthResponse = (user) => {
    const { passwordHash, passwordResetTokenHash, passwordResetExpiresAt, ...publicUser } = user;
    const token = jwt.sign(
        { id: user.id, identifier: user.identifier, name: user.name, role: user.role },
        JWT_SECRET,
        { expiresIn: '12h' }
    );
    return { success: true, token, user: publicUser };
};

const loginAttempts = new Map();
function limitLoginAttempts(req, res, next) {
    const now = Date.now();
    const key = req.ip;
    const attempt = loginAttempts.get(key);
    if (attempt && now - attempt.startedAt < 15 * 60 * 1000 && attempt.count >= 10)
        return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    next();
}

function recordLoginFailure(req) {
    const now = Date.now();
    const attempt = loginAttempts.get(req.ip);
    if (!attempt || now - attempt.startedAt >= 15 * 60 * 1000)
        loginAttempts.set(req.ip, { startedAt: now, count: 1 });
    else
        attempt.count += 1;
    if (loginAttempts.size > 1000) {
        for (const [ip, entry] of loginAttempts)
            if (now - entry.startedAt >= 15 * 60 * 1000) loginAttempts.delete(ip);
    }
}

// ─── ROUTES AUTH ──────────────────────────────────────────────────────────────

// Login (seule route d'auth nécessaire — pas d'inscription publique)
app.post('/api/auth/login', limitLoginAttempts, asyncHandler(async (req, res) => {
    const identifier = String(req.body.identifier || '').trim().toLowerCase();
    const password   = typeof req.body.password === 'string' ? req.body.password : '';
    if (!identifier || !password || identifier.length > 254 || password.length > 1024)
        return res.status(400).json({ error: 'Email et mot de passe requis.' });

    const user = db.users.find(u => u.identifier === identifier);
    if (!user || !await verifyPassword(password, user.passwordHash)) {
        recordLoginFailure(req);
        return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    }

    loginAttempts.delete(req.ip);
    return res.json(createAuthResponse(user));
}));

// Profil de l'utilisateur connecté
app.get('/api/auth/me', authenticateToken, (req, res) => {
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const { passwordHash, passwordResetTokenHash, passwordResetExpiresAt, ...publicUser } = user;
    res.json({ user: publicUser });
});

// Changement de mot de passe admin
app.post('/api/auth/change-password', requireAdmin, asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' ||
        currentPassword.length > 1024 || newPassword.length < 12 || newPassword.length > 1024)
        return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 12 caractères.' });

    const user = db.users.find(u => u.id === req.user.id);
    if (!user || !await verifyPassword(currentPassword, user.passwordHash))
        return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

    user.passwordHash = await hashPassword(newPassword);
    await saveDatabase(db);
    res.json({ success: true, message: 'Mot de passe modifié avec succès.' });
}));

// Mot de passe oublié
app.post('/api/auth/forgot-password', asyncHandler(async (req, res) => {
    const identifier = String(req.body.identifier || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier))
        return res.status(400).json({ error: 'Adresse e-mail invalide.' });

    const smtpPort = Number(process.env.SMTP_PORT || 587);
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)
        return res.status(503).json({ error: 'Récupération de mot de passe indisponible.' });

    const user = db.users.find(u => u.identifier === identifier);
    if (!user) return res.json({ success: true, message: 'Si ce compte existe, un lien de réinitialisation sera envoyé.' });

    const resetToken = randomBytes(32).toString('hex');
    user.passwordResetTokenHash = createHash('sha256').update(resetToken).digest('hex');
    user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await saveDatabase(db);

    const resetUrl = `${publicUrl}/admin.html?resetToken=${resetToken}`;
    try {
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST, port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
        await transporter.sendMail({
            from: process.env.SMTP_USER, to: user.identifier,
            subject: 'Réinitialisation mot de passe — IMO SN Admin',
            text: `Lien de réinitialisation (valable 1h) :\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`
        });
        return res.json({ success: true, message: 'Lien envoyé par e-mail.' });
    } catch (error) {
        delete user.passwordResetTokenHash;
        delete user.passwordResetExpiresAt;
        await saveDatabase(db);
        return res.status(502).json({ error: 'Impossible d\'envoyer l\'e-mail.' });
    }
}));

app.post('/api/auth/reset-password', asyncHandler(async (req, res) => {
    const { resetToken, password, passwordConfirm } = req.body;
    if (typeof resetToken !== 'string' || !/^[a-f0-9]{64}$/.test(resetToken))
        return res.status(400).json({ error: 'Lien invalide ou expiré.' });
    if (typeof password !== 'string' || password.length < 12 || password.length > 1024 || password !== passwordConfirm)
        return res.status(400).json({ error: 'Mot de passe invalide ou ne correspond pas.' });

    const tokenHash = createHash('sha256').update(resetToken).digest('hex');
    const user = db.users.find(u =>
        u.passwordResetTokenHash === tokenHash &&
        Date.parse(u.passwordResetExpiresAt) > Date.now()
    );
    if (!user) return res.status(400).json({ error: 'Lien invalide ou expiré.' });

    user.passwordHash = await hashPassword(password);
    delete user.passwordResetTokenHash;
    delete user.passwordResetExpiresAt;
    await saveDatabase(db);
    return res.json({ success: true, message: 'Mot de passe modifié.' });
}));

// ─── ROUTES PUBLIQUES — BIENS IMMOBILIERS ─────────────────────────────────────

// Liste des biens publiés avec filtres
app.get('/api/biens', (req, res) => {
    let list = db.properties.filter(p => p.published !== false);

    const { type, category, location, search, minPrice, maxPrice, featured, status } = req.query;
    const min = minPrice === undefined ? null : Number(minPrice);
    const max = maxPrice === undefined ? null : Number(maxPrice);
    if ((min !== null && (!Number.isFinite(min) || min < 0)) ||
        (max !== null && (!Number.isFinite(max) || max < 0)) ||
        (min !== null && max !== null && min > max))
        return res.status(400).json({ error: 'Fourchette de prix invalide.' });

    if (type && type !== 'all')
        list = list.filter(p => p.type === type.toLowerCase());
    if (category && category !== 'all')
        list = list.filter(p => p.category?.toLowerCase() === category.toLowerCase());
    if (status && status !== 'all')
        list = list.filter(p => p.status === status);
    if (location && location !== 'all') {
        const loc = location.toLowerCase();
        list = list.filter(p =>
            p.location?.toLowerCase().includes(loc) ||
            p.city?.toLowerCase().includes(loc) ||
            p.neighborhood?.toLowerCase().includes(loc)
        );
    }
    if (search) {
        const q = search.toLowerCase();
        list = list.filter(p =>
            p.title?.toLowerCase().includes(q) ||
            p.description?.toLowerCase().includes(q) ||
            p.location?.toLowerCase().includes(q) ||
            p.category?.toLowerCase().includes(q)
        );
    }
    if (min !== null) list = list.filter(p => p.price >= min);
    if (max !== null) list = list.filter(p => p.price <= max);
    if (featured === 'true') list = list.filter(p => p.featured === true);

    // Trier : vedettes d'abord, puis par date
    list.sort((a, b) => {
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    res.json(list);
});

// Détail d'un bien
app.get('/api/biens/:id', (req, res) => {
    const property = db.properties.find(p => p.id === req.params.id && p.published !== false);
    if (!property) return res.status(404).json({ error: 'Bien non trouvé' });
    res.json(property);
});

// Compteur de vues
app.post('/api/biens/:id/view', asyncHandler(async (req, res) => {
    const property = db.properties.find(p => p.id === req.params.id);
    if (!property) return res.status(404).json({ error: 'Bien non trouvé' });
    property.views = (property.views || 0) + 1;
    await saveDatabase(db);
    if (io) io.emit('property:view_updated', { propertyId: property.id, views: property.views });
    res.json({ success: true, views: property.views });
}));

// ─── ROUTES PUBLIQUES — FORMULAIRE DE CONTACT ─────────────────────────────────

app.post('/api/contact', asyncHandler(async (req, res) => {
    const name    = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
    const email   = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 150) : '';
    const phone   = typeof req.body.phone === 'string' ? req.body.phone.trim().slice(0, 30) : '';
    const subject = typeof req.body.subject === 'string' ? req.body.subject.trim().slice(0, 200) : '';
    const message = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';

    if (!name || !message)
        return res.status(400).json({ error: 'Nom et message requis.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ error: 'Adresse e-mail invalide.' });

    const propertyId = typeof req.body.propertyId === 'string' ? req.body.propertyId.slice(0, 100) : '';
    const property = propertyId ? db.properties.find(item => item.id === propertyId && item.published !== false) : null;
    if (propertyId && !property)
        return res.status(400).json({ error: 'Le bien associé à cette demande n’est plus disponible.' });

    const request = {
        id: randomUUID(),
        name, email, phone, subject, message,
        propertyId: property?.id || null,
        propertyTitle: property?.title || (typeof req.body.propertyTitle === 'string' ? req.body.propertyTitle.trim().slice(0, 200) : null),
        read: false,
        createdAt: new Date().toISOString()
    };

    db.contactRequests.push(request);
    if (db.contactRequests.length > 500) db.contactRequests.shift();
    await saveDatabase(db);

    // Notification Socket.io
    if (io) io.emit('admin:new_contact', { id: request.id, name, subject });

    // Envoi email si configuré
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const smtpPort = Number(process.env.SMTP_PORT || 587);
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST, port: smtpPort,
            secure: smtpPort === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
        transporter.sendMail({
            from: process.env.SMTP_USER,
            to: db.siteConfig?.email || process.env.SMTP_USER,
            subject: `[IMO SN] Nouveau contact: ${subject || name}`,
            text: `Nom: ${name}\nEmail: ${email}\nTéléphone: ${phone}\nSujet: ${subject}\n\nMessage:\n${message}${request.propertyTitle ? `\n\nBien concerné: ${request.propertyTitle}` : ''}`
        }).catch(err => console.warn('Email contact non envoyé:', err.message));
    }

    res.json({ success: true, message: 'Votre message a bien été envoyé. Nous vous répondrons rapidement.' });
}));

// ─── ROUTES PUBLIQUES — CONFIGURATION SITE ───────────────────────────────────

app.get('/api/config', (req, res) => {
    const { siteConfig } = db;
    // Ne pas exposer d'infos sensibles
    res.json({
        companyName: siteConfig?.companyName || 'IMO SN',
        tagline:     siteConfig?.tagline     || 'Votre partenaire immobilier de confiance au Sénégal',
        address:     siteConfig?.address     || '',
        phone:       siteConfig?.phone       || IMO_PHONE,
        whatsapp:    siteConfig?.whatsapp    || IMO_WHATSAPP,
        email:       siteConfig?.email       || '',
        hours:       siteConfig?.hours       || '',
        facebook:    isSafeHttpUrl(siteConfig?.facebook) ? siteConfig.facebook : '',
        instagram:   isSafeHttpUrl(siteConfig?.instagram) ? siteConfig.instagram : '',
        linkedin:    isSafeHttpUrl(siteConfig?.linkedin) ? siteConfig.linkedin : '',
        twitter:     isSafeHttpUrl(siteConfig?.twitter) ? siteConfig.twitter : ''
    });
});

// ─── ROUTES PUBLIQUES — PUBLICITÉS ────────────────────────────────────────────

app.get('/api/ads', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const activeAds = db.ads.filter(a =>
        a.active !== false &&
        (!a.startDate || a.startDate <= today) &&
        (!a.endDate || a.endDate >= today)
    );
    res.json(activeAds);
});

// ─── ROUTES ADMIN — BIENS IMMOBILIERS ────────────────────────────────────────

// Tous les biens (admin voit aussi les non-publiés)
app.get('/api/admin/biens', requireAdmin, (req, res) => {
    res.json(db.properties);
});

const MAX_PROPERTY_IMAGES = 10;
const MAX_PROPERTY_IMAGE_BYTES = 2 * 1024 * 1024;
function isSafeHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
        return false;
    }
}

function validatePropertyImage(image) {
    if (typeof image !== 'string' || image.length > 3000000) return false;
    if (/^https:\/\//i.test(image)) return isSafeHttpUrl(image);
    const match = image.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
    if (!match) return false;
    const encoded = match[2];
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > MAX_PROPERTY_IMAGE_BYTES ||
        bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, ''))
        return false;
    const mime = match[1].toLowerCase();
    if (mime === 'jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mime === 'png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function validatePropertyImages(images) {
    if (!Array.isArray(images) || images.length > MAX_PROPERTY_IMAGES) return false;
    return images.every(validatePropertyImage);
}

function isValidPropertyNumber(value, max) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= max;
}

function validateAd(ad) {
    if (typeof ad.company !== 'string' || !ad.company.trim() || ad.company.length > 200)
        return 'Nom de l’entreprise partenaire requis.';
    for (const field of ['contact', 'email', 'phone', 'format', 'notes']) {
        if (ad[field] !== undefined && ad[field] !== null && typeof ad[field] !== 'string')
            return 'Les informations de campagne sont invalides.';
    }
    if (ad.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ad.email))
        return 'Adresse e-mail partenaire invalide.';
    if (ad.contact?.length > 100 || ad.email?.length > 150 || ad.phone?.length > 30 ||
        ad.format?.length > 100 || ad.notes?.length > 1000)
        return 'Certaines informations de campagne dépassent la longueur autorisée.';
    if (ad.imageUrl && (typeof ad.imageUrl !== 'string' || ad.imageUrl.length > 2048))
        return 'URL de visuel invalide.';
    if (ad.link && (typeof ad.link !== 'string' || ad.link.length > 2048))
        return 'URL partenaire invalide.';
    if (ad.imageUrl && !isSafeHttpUrl(ad.imageUrl))
        return 'URL de visuel invalide.';
    if (ad.link && !isSafeHttpUrl(ad.link))
        return 'URL partenaire invalide.';
    const validDate = value => {
        if (!value) return true;
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!validDate(ad.startDate) || !validDate(ad.endDate))
        return 'Dates de campagne invalides.';
    if (ad.startDate && ad.endDate && ad.startDate > ad.endDate)
        return 'La date de fin doit être postérieure à la date de début.';
    return null;
}

// Créer un bien
app.post('/api/admin/biens', requireAdmin, adminPropertyJsonParser, ensureJsonObject, asyncHandler(async (req, res) => {
    const { title, type, category, price, location, city, neighborhood,
            bedrooms, bathrooms, area, description, images, featured, published, status, videoUrl } = req.body;

    if (typeof title !== 'string' || !title.trim() ||
        typeof location !== 'string' || !location.trim() ||
        !['vente', 'location'].includes(type) ||
        !Number.isFinite(Number(price)) || Number(price) <= 0 || Number(price) > 1e15 ||
        !isValidPropertyNumber(bedrooms ?? 0, 100) ||
        !isValidPropertyNumber(bathrooms ?? 0, 100) ||
        !isValidPropertyNumber(area ?? 0, 1000000))
        return res.status(400).json({ error: 'Titre, type, prix et localisation requis.' });
    for (const [field, maxLength] of [['category', 100], ['city', 100], ['neighborhood', 100], ['description', 5000]]) {
        if (req.body[field] !== undefined &&
            (typeof req.body[field] !== 'string' || req.body[field].length > maxLength))
            return res.status(400).json({ error: 'Certaines informations du bien sont invalides.' });
    }

    if (images !== undefined && !validatePropertyImages(images))
        return res.status(400).json({ error: 'Les photos doivent être des images JPEG, PNG ou WebP valides (10 maximum, 2 Mo chacune).' });
    if (status !== undefined && !['disponible', 'loue', 'vendu'].includes(status))
        return res.status(400).json({ error: 'Statut de disponibilité invalide.' });
    if (featured !== undefined && typeof featured !== 'boolean' ||
        req.body.published !== undefined && typeof req.body.published !== 'boolean')
        return res.status(400).json({ error: 'Options de publication invalides.' });
    if (videoUrl !== undefined && videoUrl !== null && videoUrl !== '' &&
        (typeof videoUrl !== 'string' || videoUrl.length > 500 || !isSafeHttpUrl(videoUrl)))
        return res.status(400).json({ error: 'URL vidéo invalide.' });

    const priceNum = Number(price);
    const property = {
        id:             randomUUID(),
        title:          String(title).trim().slice(0, 200),
        type,
        category:       String(category || 'Autre').trim(),
        price:          priceNum,
        priceFormatted: formatPrice(priceNum, type),
        location:       String(location).trim().slice(0, 200),
        city:           String(city || '').trim(),
        neighborhood:   String(neighborhood || '').trim(),
        bedrooms:       Number(bedrooms || 0),
        bathrooms:      Number(bathrooms || 0),
        area:           Number(area || 0),
        description:    String(description || '').trim().slice(0, 5000),
        images:         images || [],
        videoUrl:       typeof videoUrl === 'string' ? videoUrl.trim().slice(0, 500) : null,
        featured:       featured === true || featured === 'true',
        status:         ['disponible', 'loue', 'vendu'].includes(status) ? status : 'disponible',
        published:      published !== false,
        views:          0,
        createdAt:      new Date().toISOString(),
        updatedAt:      new Date().toISOString()
    };

    db.properties.unshift(property);
    await saveDatabase(db);
    if (io) io.emit('admin:property_added', { id: property.id, title: property.title });
    res.status(201).json({ success: true, property });
}));

// Modifier un bien
app.put('/api/admin/biens/:id', requireAdmin, adminPropertyJsonParser, ensureJsonObject, asyncHandler(async (req, res) => {
    const property = db.properties.find(p => p.id === req.params.id);
    if (!property) return res.status(404).json({ error: 'Bien non trouvé.' });

    const { title, type, category, price, location, city, neighborhood,
            bedrooms, bathrooms, area, description, images, featured, status, published, videoUrl } = req.body;

    if (title !== undefined && (typeof title !== 'string' || !title.trim()))
        return res.status(400).json({ error: 'Le titre ne peut pas être vide.' });
    if (location !== undefined && (typeof location !== 'string' || !location.trim()))
        return res.status(400).json({ error: 'La localisation ne peut pas être vide.' });
    for (const [field, maxLength] of [['category', 100], ['city', 100], ['neighborhood', 100], ['description', 5000]]) {
        if (req.body[field] !== undefined &&
            (typeof req.body[field] !== 'string' || req.body[field].length > maxLength))
            return res.status(400).json({ error: 'Certaines informations du bien sont invalides.' });
    }
    if (type !== undefined && !['vente', 'location'].includes(type))
        return res.status(400).json({ error: 'Type invalide (vente ou location).' });
    if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) <= 0 || Number(price) > 1e15))
        return res.status(400).json({ error: 'Prix invalide.' });
    if (bedrooms !== undefined && !isValidPropertyNumber(bedrooms, 100) ||
        bathrooms !== undefined && !isValidPropertyNumber(bathrooms, 100) ||
        area !== undefined && !isValidPropertyNumber(area, 1000000))
        return res.status(400).json({ error: 'Caractéristiques numériques invalides.' });
    if (images !== undefined && !validatePropertyImages(images))
        return res.status(400).json({ error: 'Les photos doivent être des images JPEG, PNG ou WebP valides (10 maximum, 2 Mo chacune).' });
    if (featured !== undefined && typeof featured !== 'boolean' ||
        published !== undefined && typeof published !== 'boolean')
        return res.status(400).json({ error: 'Options de publication invalides.' });
    if (status !== undefined && !['disponible', 'loue', 'vendu'].includes(status))
        return res.status(400).json({ error: 'Statut de disponibilité invalide.' });
    if (videoUrl !== undefined && videoUrl !== null && videoUrl !== '' &&
        (typeof videoUrl !== 'string' || videoUrl.length > 500 || !isSafeHttpUrl(videoUrl)))
        return res.status(400).json({ error: 'URL vidéo invalide.' });
    if (title !== undefined)       property.title       = title.trim().slice(0, 200);
    if (type !== undefined)        property.type        = type;
    if (category !== undefined)    property.category    = String(category).trim().slice(0, 100);
    if (price !== undefined) {
        property.price          = Number(price);
        property.priceFormatted = formatPrice(Number(price), property.type);
    }
    if (location !== undefined)    property.location    = location.trim().slice(0, 200);
    if (city !== undefined)        property.city        = String(city).trim();
    if (neighborhood !== undefined)property.neighborhood= String(neighborhood).trim();
    if (bedrooms !== undefined)    property.bedrooms    = Number(bedrooms);
    if (bathrooms !== undefined)   property.bathrooms   = Number(bathrooms);
    if (area !== undefined)        property.area        = Number(area);
    if (description !== undefined) property.description = String(description).trim().slice(0, 5000);
    if (videoUrl !== undefined)    property.videoUrl    = typeof videoUrl === 'string' ? videoUrl.trim().slice(0, 500) : null;
    if (featured !== undefined)    property.featured    = featured === true || featured === 'true';
    if (published !== undefined)   property.published   = published === true || published === 'true';
    if (status !== undefined && ['disponible', 'loue', 'vendu'].includes(status))
        property.status = status;
    if (Array.isArray(images)) {
        property.images = images;
    }

    property.updatedAt = new Date().toISOString();
    await saveDatabase(db);
    res.json({ success: true, property });
}));

// Supprimer un bien
app.delete('/api/admin/biens/:id', requireAdmin, asyncHandler(async (req, res) => {
    const idx = db.properties.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Bien non trouvé.' });
    db.properties.splice(idx, 1);
    await saveDatabase(db);
    res.json({ success: true });
}));

// ─── ROUTES ADMIN — DEMANDES CLIENTS ─────────────────────────────────────────

app.get('/api/admin/contacts', requireAdmin, (req, res) => {
    const sorted = [...db.contactRequests].sort((a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt)
    );
    res.json(sorted);
});

app.patch('/api/admin/contacts/:id/read', requireAdmin, asyncHandler(async (req, res) => {
    const contact = db.contactRequests.find(c => c.id === req.params.id);
    if (!contact) return res.status(404).json({ error: 'Demande non trouvée.' });
    contact.read = true;
    await saveDatabase(db);
    res.json({ success: true });
}));

app.delete('/api/admin/contacts/:id', requireAdmin, asyncHandler(async (req, res) => {
    const idx = db.contactRequests.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Demande non trouvée.' });
    db.contactRequests.splice(idx, 1);
    await saveDatabase(db);
    res.json({ success: true });
}));

// ─── ROUTES ADMIN — PUBLICITÉS ────────────────────────────────────────────────

app.get('/api/admin/ads', requireAdmin, (req, res) => {
    res.json(db.ads);
});

app.post('/api/admin/ads', requireAdmin, asyncHandler(async (req, res) => {
    const { company, contact, email, phone, format, startDate, endDate, notes, imageUrl, link, active } = req.body;
    if (typeof company !== 'string' || !company.trim())
        return res.status(400).json({ error: 'Nom de l’entreprise partenaire requis.' });
    for (const field of ['contact', 'email', 'phone', 'format', 'notes']) {
        if (req.body[field] !== undefined && typeof req.body[field] !== 'string')
            return res.status(400).json({ error: 'Les informations de campagne sont invalides.' });
    }
    if (active !== undefined && typeof active !== 'boolean')
        return res.status(400).json({ error: 'État de publication invalide.' });
    if (imageUrl !== undefined && imageUrl !== null && typeof imageUrl !== 'string' ||
        link !== undefined && link !== null && typeof link !== 'string')
        return res.status(400).json({ error: 'URL de campagne invalide.' });

    const ad = {
        id:        randomUUID(),
        company:   company.trim().slice(0, 200),
        contact:   String(contact || '').trim().slice(0, 100),
        email:     String(email || '').trim().slice(0, 150),
        phone:     String(phone || '').trim().slice(0, 30),
        format:    String(format || 'bannière').trim(),
        startDate: startDate || null,
        endDate:   endDate || null,
        notes:     String(notes || '').trim().slice(0, 1000),
        imageUrl:  typeof imageUrl === 'string' ? imageUrl.trim() : null,
        link:      typeof link === 'string' ? link.trim() : null,
        active:    active === undefined ? true : active === true,
        createdAt: new Date().toISOString()
    };

    const validationError = validateAd(ad);
    if (validationError) return res.status(400).json({ error: validationError });
    db.ads.push(ad);
    await saveDatabase(db);
    res.status(201).json({ success: true, ad });
}));

app.put('/api/admin/ads/:id', requireAdmin, asyncHandler(async (req, res) => {
    const ad = db.ads.find(a => a.id === req.params.id);
    if (!ad) return res.status(404).json({ error: 'Publicité non trouvée.' });

    const fields = ['company', 'contact', 'email', 'phone', 'format', 'startDate', 'endDate', 'notes', 'imageUrl', 'link', 'active'];
    const updatedAd = { ...ad };
    fields.forEach(field => {
        if (req.body[field] !== undefined) updatedAd[field] = req.body[field];
    });
    const validationError = validateAd(updatedAd);
    if (validationError) return res.status(400).json({ error: validationError });
    if (typeof updatedAd.active !== 'boolean')
        return res.status(400).json({ error: 'État de publication invalide.' });
    fields.forEach(field => { ad[field] = updatedAd[field]; });
    ad.updatedAt = new Date().toISOString();
    await saveDatabase(db);
    res.json({ success: true, ad });
}));

app.delete('/api/admin/ads/:id', requireAdmin, asyncHandler(async (req, res) => {
    const idx = db.ads.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Publicité non trouvée.' });
    db.ads.splice(idx, 1);
    await saveDatabase(db);
    res.json({ success: true });
}));

// ─── ROUTES ADMIN — CONFIGURATION SITE ───────────────────────────────────────

app.get('/api/admin/config', requireAdmin, (req, res) => {
    res.json(db.siteConfig || DEFAULT_DB.siteConfig);
});

app.put('/api/admin/config', requireAdmin, asyncHandler(async (req, res) => {
    const allowed = ['companyName', 'tagline', 'address', 'phone', 'whatsapp', 'email', 'hours', 'facebook', 'instagram', 'linkedin', 'twitter'];
    if (!db.siteConfig) db.siteConfig = { ...DEFAULT_DB.siteConfig };
    if (req.body.email !== undefined && req.body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email))
        return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    for (const field of ['facebook', 'instagram', 'linkedin', 'twitter']) {
        if (req.body[field] && req.body[field] !== '#' && !isSafeHttpUrl(req.body[field]))
            return res.status(400).json({ error: `URL invalide pour ${field}.` });
    }
    allowed.forEach(field => {
        if (req.body[field] !== undefined) {
            const value = req.body[field] === '#' ? '' : String(req.body[field]);
            db.siteConfig[field] = value.trim().slice(0, 500);
        }
    });
    await saveDatabase(db);
    res.json({ success: true, config: db.siteConfig });
}));

// ─── ROUTES ADMIN — STATISTIQUES ─────────────────────────────────────────────

app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const properties = db.properties;
    const contacts   = db.contactRequests;

    const totalBiens     = properties.length;
    const biensPublies   = properties.filter(p => p.published !== false).length;
    const biensVente     = properties.filter(p => p.type === 'vente' && p.published !== false).length;
    const biensLocation  = properties.filter(p => p.type === 'location' && p.published !== false).length;
    const biensVedette   = properties.filter(p => p.featured && p.published !== false).length;
    const totalVues      = properties.reduce((sum, p) => sum + (p.views || 0), 0);
    const totalContacts  = contacts.length;
    const contactsNonLus = contacts.filter(c => !c.read).length;

    const statusCounts = {
        disponible: properties.filter(p => p.status === 'disponible').length,
        loue:       properties.filter(p => p.status === 'loue').length,
        vendu:      properties.filter(p => p.status === 'vendu').length
    };

    // Top 5 biens par vues
    const topBiens = [...properties]
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 5)
        .map(p => ({ id: p.id, title: p.title, views: p.views || 0, type: p.type }));

    res.json({
        totalBiens, biensPublies, biensVente, biensLocation, biensVedette,
        totalVues, totalContacts, contactsNonLus, statusCounts, topBiens,
        totalAds: db.ads.length
    });
});

// ─── MESSAGERIE SOCKET.IO ─────────────────────────────────────────────────────
app.get('/api/messages/:roomId', (req, res) => {
    const history = db.messages.filter(m => m.roomId === req.params.roomId);
    res.json(history);
});

app.post('/api/messages', asyncHandler(async (req, res) => {
    const { roomId, sender, text } = req.body;
    if (!roomId || !text) return res.status(400).json({ error: 'Données incomplètes' });

    const msg = {
        id: randomUUID(), roomId,
        sender: sender || 'Visiteur',
        text: String(text).slice(0, 2000),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toISOString()
    };
    db.messages.push(msg);
    if (db.messages.length > 500) db.messages.shift();
    await saveDatabase(db);
    if (io) io.to(roomId).emit('chat:new_message', msg);
    res.json(msg);
}));

if (io) {
    io.on('connection', socket => {
        socket.on('chat:join', roomId => socket.join(roomId));
        socket.on('chat:send_message', async data => {
            const msg = {
                id: randomUUID(), roomId: data.roomId,
                sender: data.sender || 'Visiteur',
                text: String(data.text || '').slice(0, 2000),
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                date: new Date().toISOString()
            };
            db.messages.push(msg);
            try {
                await saveDatabase(db);
                io.to(data.roomId).emit('chat:new_message', msg);
            } catch (error) {
                console.error('[CHAT] Enregistrement du message impossible:', error.message);
                socket.emit('chat:message_error', { error: 'Message non enregistré. Réessayez.' });
            }
        });
        socket.on('disconnect', () => {});
    });
}

// ─── UTILITAIRES ──────────────────────────────────────────────────────────────
function formatPrice(price, type) {
    const formatted = Number(price).toLocaleString('fr-FR');
    return type === 'location' ? `${formatted} FCFA / mois` : `${formatted} FCFA`;
}

// ─── CONFIG.JS injectée côté serveur ─────────────────────────────────────────
app.get('/config.js', (req, res) => {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send([
        `window.__API_BASE_URL__ = ${JSON.stringify(process.env.API_BASE_URL || publicUrl || '')};`,
        `window.__IMO_PHONE__ = ${JSON.stringify(db.siteConfig?.phone || IMO_PHONE)};`,
        `window.__IMO_WHATSAPP__ = ${JSON.stringify(db.siteConfig?.whatsapp || IMO_WHATSAPP)};`
    ].join('\n'));
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ─── FICHIERS STATIQUES ───────────────────────────────────────────────────────
app.use('/data', (req, res) => res.status(404).json({ error: 'Ressource non trouvée.' }));
app.use((req, res, next) => {
    const requestedPath = decodeURIComponent(req.path).toLowerCase();
    const privatePaths = [
        '/server.js', '/package.json', '/package-lock.json', '/render.yaml',
        '/.env.example', '/supabase-schema.sql', '/node_modules', '/fixnow', '/.git', '/.vscode'
    ];
    if (requestedPath.startsWith('/.') || privatePaths.some(privatePath =>
        requestedPath === privatePath || requestedPath.startsWith(`${privatePath}/`)
    ))
        return res.status(404).json({ error: 'Ressource non trouvée.' });
    next();
});
app.use(express.static(root, {
    maxAge: '1h',
    dotfiles: 'deny',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.css') || filePath.endsWith('.js'))
            res.setHeader('Cache-Control', 'no-cache');
    }
}));

// ─── FALLBACK SPA ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint non trouvé' });
    res.sendFile(path.join(root, 'index.html'));
});

app.use((error, req, res, next) => {
    console.error('Erreur serveur:', error.message);
    if (res.headersSent) return next(error);
    const status = [400, 413].includes(error.status) ? error.status : 500;
    res.status(status).json({
        error: status === 413
            ? 'La requête dépasse la taille maximale autorisée.'
            : status === 400 ? 'Requête invalide.' : 'Une erreur serveur est survenue.'
    });
});

// ─── DÉMARRAGE ────────────────────────────────────────────────────────────────
async function startServer() {
    if (JWT_SECRET.length < 32)
        throw new Error('JWT_SECRET doit contenir au moins 32 caractères.');
    if (Boolean(SUPABASE_URL) !== Boolean(SUPABASE_SECRET_KEY))
        throw new Error('Configurez ensemble SUPABASE_URL et SUPABASE_SECRET_KEY, ou laissez les deux vides pour utiliser db.json.');
    if (SUPABASE_SECRET_KEY.startsWith('sb_publishable_'))
        throw new Error('SUPABASE_SECRET_KEY doit être une clé secrète serveur, jamais une clé publishable.');
    if (SUPABASE_URL) {
        let projectUrl;
        try {
            projectUrl = new URL(SUPABASE_URL);
        } catch {
            throw new Error('SUPABASE_URL doit être une URL de projet valide.');
        }
        if ((projectUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(projectUrl.hostname)) ||
            projectUrl.username || projectUrl.password || projectUrl.pathname !== '/')
            throw new Error('SUPABASE_URL doit être l’URL HTTPS du projet, sans chemin ni identifiants.');
    }

    db = await loadDatabase();
    console.log(`\n🏠 IMO SN — Serveur démarré sur le port ${PORT}`);
    await ensureAdminAccount();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 URL publique : ${publicUrl}`);
        console.log('✅ Prêt\n');
    });
}

startServer().catch(error => {
    console.error('Démarrage impossible:', error.message);
    process.exitCode = 1;
});
