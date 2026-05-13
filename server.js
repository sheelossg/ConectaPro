// server.js
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const csv = require('csv-parser');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'conectapro.db');
const CSV_PATH = path.join(__dirname, 'datos.csv');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('No se pudo abrir la base de datos:', err);
        process.exit(1);
    }
});

function createSchema() {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            profile_type TEXT NOT NULL,
            rut TEXT NOT NULL,
            professional_title TEXT,
            background TEXT,
            company_name TEXT,
            company_type TEXT,
            created_at TEXT NOT NULL
        )
    `);
}

function generateSalt() {
    return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');
}

function normalizeChileanRut(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let s = raw
        .trim()
        .replace(/\./g, '')
        .replace(/\s/g, '')
        .replace(/[−–—]/g, '-')
        .toUpperCase();
    if (!/^\d{7,8}-[\dK]$/.test(s)) return null;
    return s;
}

function findUserByRUT(rut) {
    const target = normalizeChileanRut(rut) || String(rut).trim().toUpperCase();
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(CSV_PATH)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => {
                const user = results.find((row) => {
                    const rowRut = normalizeChileanRut(row.RUT) || String(row.RUT || '').trim().toUpperCase();
                    return rowRut === target;
                });
                resolve(user);
            })
            .on('error', reject);
    });
}

function slugFromNombre(nombre) {
    if (!nombre || typeof nombre !== 'string') return 'usuario';
    const base = nombre
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 24);
    return base.length >= 3 ? base : 'usuario';
}

function inferCategoryFromTitle(title) {
    const t = String(title || '').toLowerCase();
    if (/abogad|derecho|legal/.test(t)) return 'Derecho';
    if (/medic|salud|enfermer|kine|nutric|psicolog|veterin/.test(t)) return 'Salud';
    if (/ingenier|inform|desarroll|software|telecom|datos|analista|devops/.test(t)) return 'Informática';
    if (/contad|auditor/.test(t)) return 'Contabilidad';
    if (/arquitect/.test(t)) return 'Arquitectura';
    if (/electric/.test(t)) return 'Electricidad';
    if (/traduc/.test(t)) return 'Traducción';
    return 'Informática';
}

createSchema();

const sessions = new Map();
const SESSION_MS = 1000 * 60 * 60 * 24 * 7;

function isAdminProfile(profileType) {
    return profileType === 'administrador' || profileType === 'admin';
}

function createSession(userId, username, profileType) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
        userId,
        username,
        profileType,
        expires: Date.now() + SESSION_MS
    });
    return token;
}

function getSessionFromRequest(req) {
    const raw = req.headers.authorization;
    if (!raw || typeof raw !== 'string' || !raw.startsWith('Bearer ')) {
        return null;
    }
    const token = raw.slice(7).trim();
    if (!token) return null;
    const s = sessions.get(token);
    if (!s || s.expires < Date.now()) {
        if (s) sessions.delete(token);
        return null;
    }
    return s;
}

function requireAdmin(req, res, next) {
    const s = getSessionFromRequest(req);
    if (!s) {
        return res.status(401).json({ error: 'Sesión requerida.' });
    }
    if (!isAdminProfile(s.profileType)) {
        return res.status(403).json({ error: 'Solo administradores.' });
    }
    req.adminSession = s;
    next();
}

function ensureAdminUser() {
    const preferredUser = (process.env.CONECTAPRO_ADMIN_USER || 'administrador').trim().toLowerCase();
    const adminPass = process.env.CONECTAPRO_ADMIN_PASSWORD || 'admin123';
    const adminRut = (process.env.CONECTAPRO_ADMIN_RUT || '99999999-9').trim().toUpperCase();

    db.get("SELECT id FROM users WHERE profile_type IN ('administrador', 'admin')", [], (err, existingAdmin) => {
        if (err) {
            console.error('ensureAdminUser:', err);
            return;
        }
        if (existingAdmin) {
            return;
        }

        function tryInsertAdmin(adminUser) {
            db.get('SELECT id FROM users WHERE username = ?', [adminUser], (err2, row) => {
                if (err2) {
                    console.error('ensureAdminUser:', err2);
                    return;
                }
                if (row) {
                    if (adminUser === preferredUser && preferredUser !== 'conectapro_admin') {
                        console.warn(`El nombre "${preferredUser}" ya está en uso; se creará el administrador como "conectapro_admin".`);
                        return tryInsertAdmin('conectapro_admin');
                    }
                    console.warn(`No se pudo crear administrador: "${adminUser}" ya existe. Definí CONECTAPRO_ADMIN_USER con otro nombre.`);
                    return;
                }
                const salt = generateSalt();
                const passwordHash = hashPassword(adminPass, salt);
                const createdAt = new Date().toISOString();
                const emailForRow = `${adminUser}@conectapro.admin`;
                db.run(
                    `INSERT INTO users (username, email, password_hash, salt, profile_type, rut, professional_title, background, company_name, company_type, created_at)
                     VALUES (?, ?, ?, ?, 'administrador', ?, NULL, NULL, NULL, NULL, ?)`,
                    [adminUser, emailForRow, passwordHash, salt, adminRut, createdAt],
                    (e) => {
                        if (e) {
                            console.error('No se pudo crear el usuario administrador:', e);
                            return;
                        }
                        console.log(
                            `Usuario administrador "${adminUser}" creado (contraseña inicial vía CONECTAPRO_ADMIN_PASSWORD; cambiala en producción).`
                        );
                    }
                );
            });
        }

        tryInsertAdmin(preferredUser);
    });
}

ensureAdminUser();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
    const payload = {
        ok: true,
        version: 2,
        register: 'rut-only',
        message: 'API ConectaPro activa. Abrí http://127.0.0.1:3000/ para la app.'
    };
    const accept = req.get('Accept') || '';
    if (accept.includes('text/html')) {
        return res.type('html').send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>ConectaPro — API OK</title></head>
<body style="font-family:system-ui;padding:2rem;background:#0a0a0b;color:#eee">
<h1 style="color:#34d399">API en funcionamiento</h1>
<p>Esto no es un error: es la comprobación de salud del servidor.</p>
<pre style="background:#18181b;padding:1rem;border-radius:8px;overflow:auto">${JSON.stringify(
            payload,
            null,
            2
        )}</pre>
<p><a href="/" style="color:#60a5fa">Ir a la aplicación</a></p>
</body></html>`);
    }
    res.json(payload);
});

app.use(express.static(path.join(__dirname, 'public')));

// 3. BASE DE DATOS SIMULADA (Con precios, ratings y nuevos usuarios)
let postsDb = [
    // Ofertas de empleo publicadas por empresas (type: 'offer')
    { id: 1, type: 'offer', title: 'Desarrollador Frontend React', description: 'Buscamos talento para maquetación de interfaces. Se requiere portafolio.', category: 'Informática', user: 'empresa1', price: 850000, rating: 5, date: new Date().toISOString() },
    { id: 2, type: 'offer', title: 'Ingeniero DevOps', description: 'Experiencia en AWS y Docker requerida.', category: 'Informática', user: 'empresa2', price: 1200000, rating: 4, date: new Date().toISOString() },
    { id: 3, type: 'offer', title: 'Analista de Datos', description: 'Manejo de Python, SQL y Power BI.', category: 'Informática', user: 'empresa3', price: 700000, rating: 5, date: new Date().toISOString() },
    
    // Perfiles de trabajadores ofreciendo servicios (type: 'service')
    { id: 4, type: 'service', title: 'Juan Pérez - Ingeniero', description: 'Experiencia en desarrollo web. 30 años.', category: 'Informática', user: 'juanperez', price: null, rating: 5, date: new Date().toISOString() },
    { id: 5, type: 'service', title: 'María González - Abogada', description: 'Especialista en derecho laboral. 28 años.', category: 'Derecho', user: 'mariagonzalez', price: null, rating: 4, date: new Date().toISOString() },
    { id: 6, type: 'service', title: 'Carlos Rodríguez - Analista', description: 'Python, Pandas, visualización de datos.', category: 'Informática', user: 'carlosrodriguez', price: null, rating: 5, date: new Date().toISOString() }
];

app.get('/api/posts', (req, res) => {
    const profileType = req.query.profileType;
    const view = req.query.view;

    if (profileType === 'administrador' || profileType === 'admin') {
        const s = getSessionFromRequest(req);
        if (!s || !isAdminProfile(s.profileType)) {
            return res.status(403).json({ error: 'No autorizado.' });
        }
        return res.json(postsDb.slice());
    }

    if (!profileType) {
        return res.json([]);
    }

    if (profileType === 'empresa' && view === 'professionals') {
        const fromPosts = postsDb.filter((post) => post.type === 'service');
        db.all(
            "SELECT id, username, rut, professional_title, background, created_at FROM users WHERE LOWER(profile_type) = 'trabajador'",
            [],
            (err, rows) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: 'Error al cargar perfiles.' });
                }
                const byUser = new Set(fromPosts.map((p) => p.user.toLowerCase()));
                const extras = (rows || [])
                    .filter((r) => r.username && !byUser.has(String(r.username).toLowerCase()))
                    .map((r) => ({
                        id: 1_000_000 + r.id,
                        type: 'service',
                        title: `${r.username} — ${r.professional_title || 'Profesional'}`,
                        description: r.background || 'Perfil registrado y verificado con datos del padrón.',
                        category: inferCategoryFromTitle(r.professional_title),
                        user: r.username,
                        price: null,
                        rating: 5,
                        date: r.created_at || new Date().toISOString(),
                        verified: true
                    }));
                return res.json([...extras, ...fromPosts]);
            }
        );
        return;
    }

    let filteredPosts = [];

    if (profileType === 'trabajador') {
        filteredPosts = postsDb.filter((post) => post.type === 'offer');
    } else if (profileType === 'empresa') {
        if (view === 'offers') {
            filteredPosts = postsDb.filter((post) => post.type === 'offer');
        } else {
            filteredPosts = [];
        }
    }

    res.json(filteredPosts);
});

app.post('/api/posts', (req, res) => {
    const s = getSessionFromRequest(req);
    if (!s) {
        return res.status(401).json({ error: 'Debes iniciar sesión.' });
    }
    if (isAdminProfile(s.profileType)) {
        return res.status(403).json({ error: 'Los administradores no publican desde este formulario.' });
    }
    const { type, title, description, category, price } = req.body;
    if (!type || !title || !description || !category) {
        return res.status(400).json({ error: 'Faltan datos de la publicación.' });
    }
    if (type !== 'offer' && type !== 'service') {
        return res.status(400).json({ error: 'Tipo de publicación no válido.' });
    }
    if (s.profileType === 'empresa' && type !== 'offer') {
        return res.status(403).json({ error: 'Las empresas solo publican ofertas de empleo.' });
    }
    if (s.profileType === 'trabajador' && type !== 'service') {
        return res.status(403).json({ error: 'Los trabajadores solo publican su perfil/servicio.' });
    }
    const nextId = postsDb.reduce((max, p) => Math.max(max, p.id), 0) + 1;
    const priceNum = price === undefined || price === null || price === '' ? null : parseInt(String(price), 10);
    const post = {
        id: nextId,
        type,
        title: String(title).trim(),
        description: String(description).trim(),
        category: String(category).trim(),
        user: s.username,
        price: Number.isFinite(priceNum) ? priceNum : null,
        rating: 5,
        date: new Date().toISOString(),
        verified: true
    };
    postsDb.push(post);
    res.json(post);
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
    db.all(
        'SELECT id, username, email, profile_type, rut, created_at FROM users ORDER BY id ASC',
        [],
        (err, rows) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Error en la base de datos.' });
            }
            res.json(rows || []);
        }
    );
});

app.delete('/api/admin/posts/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'ID inválido.' });
    }
    const idx = postsDb.findIndex((p) => p.id === id);
    if (idx === -1) {
        return res.status(404).json({ error: 'Publicación no encontrada.' });
    }
    postsDb.splice(idx, 1);
    res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'ID inválido.' });
    }
    if (id === req.adminSession.userId) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
    }

    db.get('SELECT username FROM users WHERE id = ?', [id], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Error en la base de datos.' });
        }
        if (!row) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }
        const username = row.username;
        db.run('DELETE FROM users WHERE id = ?', [id], function (delErr) {
            if (delErr) {
                console.error(delErr);
                return res.status(500).json({ error: 'No se pudo eliminar el usuario.' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Usuario no encontrado.' });
            }
            for (let i = postsDb.length - 1; i >= 0; i--) {
                if (postsDb[i].user === username) {
                    postsDb.splice(i, 1);
                }
            }
            for (const [tok, sess] of sessions) {
                if (sess.userId === id) {
                    sessions.delete(tok);
                }
            }
            res.json({ ok: true });
        });
    });
});

app.get('/api/profile', async (req, res) => {
    const { rut } = req.query;

    if (!rut) {
        return res.status(400).json({ error: 'RUT es requerido.' });
    }

    const rutNorm = normalizeChileanRut(rut) || String(rut).trim().toUpperCase();

    try {
        const csvData = await findUserByRUT(rutNorm);
        if (!csvData) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        db.get('SELECT username, email, created_at FROM users WHERE rut = ?', [rutNorm], (err, userRow) => {
            if (err) {
                console.error('Error al consultar usuario:', err);
                return res.status(500).json({ error: 'Error interno del servidor.' });
            }

            const profileData = {
                username: userRow ? userRow.username : null,
                email: userRow ? userRow.email : null,
                rut: csvData.RUT,
                nombre: csvData.Nombre,
                titulo: csvData.TITULO,
                edad: csvData.EDAD,
                antecedentes: csvData.ANTECEDENTES,
                tipo: csvData.Tipo,
                createdAt: userRow ? userRow.created_at : null,
                verified: Boolean(userRow)
            };

            res.json(profileData);
        });
    } catch (error) {
        console.error('Error al obtener perfil:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

app.post('/api/register', async (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const rutRaw = String(b.rut ?? '').trim();
    const password = String(b.password ?? '');
    const confirmPassword = String(b.confirmPassword ?? b.confirm_password ?? '');
    const legacyUser = String(b.username ?? '').trim().toLowerCase();
    const legacyEmail = String(b.email ?? '').trim().toLowerCase();

    const useLegacyForm = Boolean(legacyUser && legacyEmail);

    if (useLegacyForm) {
        if (!rutRaw || !password || !confirmPassword) {
            return res.status(400).json({ error: 'Faltan RUT o contraseñas.' });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
        }
        if (legacyUser.length < 3) {
            return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
        }
        const normalizedRut = normalizeChileanRut(rutRaw);
        if (!normalizedRut) {
            return res.status(400).json({ error: 'RUT inválido. Usa el formato 12345678-9 (con o sin puntos).' });
        }

        try {
            const csvData = await findUserByRUT(normalizedRut);
            if (!csvData) {
                return res.status(400).json({ error: 'RUT no encontrado en el registro autorizado (datos.csv).' });
            }

            const tipoRaw = String(csvData.Tipo || '').trim().toLowerCase();
            const profileType = tipoRaw === 'empresa' ? 'empresa' : 'trabajador';
            const salt = generateSalt();
            const passwordHash = hashPassword(password, salt);
            const createdAt = new Date().toISOString();

            let professionalTitle = null;
            let background = null;
            let companyName = null;
            let companyType = null;

            if (profileType === 'trabajador') {
                professionalTitle = csvData.TITULO;
                background = csvData.ANTECEDENTES;
            } else if (profileType === 'empresa') {
                companyName = csvData.Nombre;
                companyType = csvData.TITULO;
            }

            db.get(
                'SELECT id FROM users WHERE rut = ? OR LOWER(username) = ? OR LOWER(email) = ?',
                [normalizedRut, legacyUser, legacyEmail],
                (err, existing) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: 'Error en la base de datos.' });
                    }
                    if (existing) {
                        return res.status(409).json({ error: 'RUT, usuario o correo ya registrados.' });
                    }

                    db.run(
                        'INSERT INTO users (username, email, password_hash, salt, profile_type, rut, professional_title, background, company_name, company_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            legacyUser,
                            legacyEmail,
                            passwordHash,
                            salt,
                            profileType,
                            normalizedRut,
                            professionalTitle,
                            background,
                            companyName,
                            companyType,
                            createdAt
                        ],
                        function (insErr) {
                            if (insErr) {
                                if (insErr.message.includes('UNIQUE')) {
                                    return res.status(409).json({ error: 'El nombre de usuario o el correo ya están registrados.' });
                                }
                                console.error(insErr);
                                return res.status(500).json({ error: 'Error en la base de datos.' });
                            }
                            const newId = this.lastID;
                            const token = createSession(newId, legacyUser, profileType);
                            res.json({
                                id: newId,
                                username: legacyUser,
                                email: legacyEmail,
                                profileType,
                                rut: normalizedRut,
                                token
                            });
                        }
                    );
                }
            );
        } catch (error) {
            console.error('Error al procesar registro:', error);
            res.status(500).json({ error: 'Error interno del servidor.' });
        }
        return;
    }

    if (!rutRaw || !password || !confirmPassword) {
        return res.status(400).json({
            error:
                'Completá RUT, contraseña y confirmación. Si ves un mensaje de "campos obligatorios" de una versión vieja, detené el servidor (Ctrl+C) y ejecutá de nuevo: node server.js'
        });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    const normalizedRut = normalizeChileanRut(rutRaw);
    if (!normalizedRut) {
        return res.status(400).json({ error: 'RUT inválido. Usa el formato 12345678-9 (con o sin puntos).' });
    }

    try {
        const csvData = await findUserByRUT(normalizedRut);
        if (!csvData) {
            return res.status(400).json({ error: 'RUT no encontrado en el registro autorizado (datos.csv).' });
        }

        db.get('SELECT id FROM users WHERE rut = ?', [normalizedRut], (err, existing) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Error en la base de datos.' });
            }
            if (existing) {
                return res.status(409).json({ error: 'Este RUT ya está registrado.' });
            }

            const tipoRaw = String(csvData.Tipo || '').trim().toLowerCase();
            const profileType = tipoRaw === 'empresa' ? 'empresa' : 'trabajador';
            const salt = generateSalt();
            const passwordHash = hashPassword(password, salt);
            const createdAt = new Date().toISOString();

            let professionalTitle = null;
            let background = null;
            let companyName = null;
            let companyType = null;

            if (profileType === 'trabajador') {
                professionalTitle = csvData.TITULO;
                background = csvData.ANTECEDENTES;
            } else if (profileType === 'empresa') {
                companyName = csvData.Nombre;
                companyType = csvData.TITULO;
            }

            const emailVerified = `verificado${normalizedRut.replace(/-/g, '')}@conectapro.local`.toLowerCase();
            const rutDigits = normalizedRut.replace(/-/g, '');
            const slug = slugFromNombre(String(csvData.Nombre || 'user'));
            let attempt = 0;

            function tryUsername() {
                const suffix = attempt === 0 ? '' : `_${attempt}`;
                const finalUsername = `${slug}_${rutDigits.slice(-4)}${suffix}`.toLowerCase().slice(0, 48);

                db.get('SELECT id FROM users WHERE LOWER(username) = ?', [finalUsername], (e2, urow) => {
                    if (e2) {
                        console.error(e2);
                        return res.status(500).json({ error: 'Error en la base de datos.' });
                    }
                    if (urow) {
                        attempt += 1;
                        if (attempt > 40) {
                            return res.status(500).json({ error: 'No se pudo generar un nombre de usuario único.' });
                        }
                        return tryUsername();
                    }

                    db.run(
                        'INSERT INTO users (username, email, password_hash, salt, profile_type, rut, professional_title, background, company_name, company_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            finalUsername,
                            emailVerified,
                            passwordHash,
                            salt,
                            profileType,
                            normalizedRut,
                            professionalTitle,
                            background,
                            companyName,
                            companyType,
                            createdAt
                        ],
                        function (insErr) {
                            if (insErr) {
                                if (insErr.message.includes('UNIQUE')) {
                                    attempt += 1;
                                    return tryUsername();
                                }
                                console.error(insErr);
                                return res.status(500).json({ error: 'Error en la base de datos.' });
                            }

                            const newId = this.lastID;
                            const token = createSession(newId, finalUsername, profileType);
                            res.json({
                                id: newId,
                                username: finalUsername,
                                email: emailVerified,
                                profileType,
                                rut: normalizedRut,
                                token
                            });
                        }
                    );
                });
            }

            tryUsername();
        });
    } catch (error) {
        console.error('Error al procesar registro:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario (o RUT) y contraseña son obligatorios.' });
    }

    const input = String(username).trim();
    const normalizedUsername = input.toLowerCase();
    const rutNorm = normalizeChileanRut(input);

    const finishLogin = (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Error en la base de datos.' });
        }
        if (!row) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        }
        const incomingHash = hashPassword(password, row.salt);
        if (incomingHash !== row.password_hash) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
        }
        const token = createSession(row.id, row.username, row.profile_type);
        res.json({
            id: row.id,
            username: row.username,
            email: row.email,
            profileType: row.profile_type,
            rut: row.rut,
            token
        });
    };

    if (rutNorm) {
        db.get('SELECT * FROM users WHERE rut = ?', [rutNorm], (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Error en la base de datos.' });
            }
            if (row) {
                return finishLogin(null, row);
            }
            db.get('SELECT * FROM users WHERE LOWER(TRIM(username)) = ?', [normalizedUsername], finishLogin);
        });
    } else {
        db.get('SELECT * FROM users WHERE LOWER(TRIM(username)) = ?', [normalizedUsername], finishLogin);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor de ConectaPRO corriendo en http://localhost:${PORT}`);
    console.log(`   Registro actual: solo RUT + contraseña. Comprobación: http://localhost:${PORT}/api/health`);
    console.log('');
    console.log('   ► Dejá ESTA ventana de terminal ABIERTA mientras uses la app.');
    console.log('     Si la cerrás o pulsás Ctrl+C, el sitio dejará de responder.');
    console.log('');
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ El puerto ${PORT} ya está en uso (¿otro node server.js?).`);
        console.error(`   Cerrá el otro proceso o usá otro puerto, por ejemplo:`);
        console.error(`   set PORT=3001 && node server.js   (CMD)`);
        console.error(`   $env:PORT=3001; node server.js     (PowerShell)\n`);
    } else {
        console.error(err);
    }
    process.exit(1);
});