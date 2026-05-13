// public/js/app.js

// Categorías ampliadas
const CATEGORIES = [
    'Informática', 'Telecomunicaciones', 'Salud', 'Veterinaria', 
    'Derecho', 'Arquitectura', 'Contabilidad', 'Psicología', 
    'Kinesiología', 'Nutrición', 'Electricidad', 'Traducción'
];

const state = {
    posts: [], 
    searchQuery: '',
    activeFilters: new Set(),
    currentUser: null,
    currentUserProfile: null,
    currentUserRut: null,
    currentView: 'home',
    sessionToken: null
};

function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const t = state.sessionToken || localStorage.getItem('conectaproSessionToken');
    if (t) {
        headers.Authorization = `Bearer ${t}`;
    }
    return headers;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getApiBase() {
    const meta = document.querySelector('meta[name="conectapro-api"]');
    const fromMeta = meta && meta.getAttribute('content');
    if (fromMeta && String(fromMeta).trim()) {
        return String(fromMeta).trim().replace(/\/$/, '');
    }
    const port = window.location.port;
    const staticPorts = ['5500', '5501', '5173', '4173', '8080'];
    if (staticPorts.includes(port)) {
        return `http://${window.location.hostname}:3000`;
    }
    return '';
}

function apiUrl(path) {
    const base = getApiBase();
    const p = path.startsWith('/') ? path : `/${path}`;
    return base ? `${base}${p}` : p;
}

document.addEventListener('DOMContentLoaded', () => {
    const DOM = {
        views: document.querySelectorAll('.view'),
        authSection: document.getElementById('authSection'),
        offersContainer: document.getElementById('offersContainer'),
        servicesContainer: document.getElementById('servicesContainer'),
        profileContainer: document.getElementById('profileContainer'),
        filtersOffers: document.getElementById('filtersOffers'),
        filtersProfessionals: document.getElementById('filtersProfessionals'),
        loginForm: document.getElementById('loginForm'),
        loginError: document.getElementById('loginError'),
        registerForm: document.getElementById('registerForm'),
        registerError: document.getElementById('registerError'),
        registerSuccess: document.getElementById('registerSuccess'),
        authTabs: document.querySelectorAll('.auth-tabs button'),
        loginTab: document.getElementById('loginTab'),
        registerTab: document.getElementById('registerTab'),
        modal: document.getElementById('postModal'),
        postForm: document.getElementById('postForm'),
        modalTitle: document.getElementById('modalTitle'),
        postType: document.getElementById('postType'),
        postCategory: document.getElementById('postCategory'),
        searchInput: document.getElementById('searchInput'), // Buscador
        profileLink: document.getElementById('profileLink'),
        btnPublishOffer: document.getElementById('btnPublishOffer'),
        btnOfferService: document.getElementById('btnOfferService'),
        btnCloseModal: document.getElementById('btnCloseModal'),
        adminUsersTable: document.getElementById('adminUsersTable'),
        adminPostsTable: document.getElementById('adminPostsTable')
    };

    function profileIsAdmin() {
        return state.currentUserProfile === 'administrador' || state.currentUserProfile === 'admin';
    }

    async function init() {
        state.currentUser = localStorage.getItem('conectaproCurrentUser');
        state.currentUserProfile = localStorage.getItem('conectaproCurrentUserProfile');
        state.currentUserRut = localStorage.getItem('conectaproCurrentUserRut');
        state.sessionToken = localStorage.getItem('conectaproSessionToken');
        renderAuthUI();
        populateCategories();
        renderFilters();
        setupEventListeners();
        await fetchPostsFromAPI();
        updateViewHeaders(state.currentView);
        try {
            const h = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
            if (!h.ok) {
                console.warn(
                    `ConectaPro: /api/health respondió ${h.status}. ¿Hay otro programa en el puerto 3000 o el servidor no es ConectaPro?`
                );
            }
        } catch (e) {
            console.warn(
                'ConectaPro: no se pudo contactar la API. En una terminal ejecutá "npm start" en la carpeta del proyecto y dejá esa terminal abierta; luego recargá esta página.'
            );
        }
    }

    async function fetchPostsFromAPI() {
        try {
            const params = new URLSearchParams();
            if (state.currentUserProfile) {
                params.append('profileType', state.currentUserProfile);
            }
            params.append('view', state.currentView);
            const response = await fetch(apiUrl(`/api/posts?${params.toString()}`), {
                headers: authHeaders()
            });
            const data = await response.json();
            state.posts = data; 
            renderData(); 
        } catch (error) {
            console.error("Error al cargar los datos:", error);
            DOM.offersContainer.innerHTML = '<p class="error-msg">Error al conectar con el servidor.</p>';
            DOM.servicesContainer.innerHTML = '<p class="error-msg">Error al conectar con el servidor.</p>';
        }
    }

    function navigateTo(route) {
        state.currentView = route;
        
        DOM.views.forEach(view => {
            view.classList.remove('active');
            void view.offsetWidth; 
            if (view.id === `view-${route}`) {
                view.classList.add('active');
            }
        });

        document.querySelectorAll('.nav-links a').forEach(link => {
            link.classList.toggle('active-link', link.dataset.route === route);
        });

        state.activeFilters.clear();
        state.searchQuery = ''; // Limpiar búsqueda al cambiar de página
        DOM.searchInput.value = '';
        
        // Actualizar encabezados según perfil y vista
        updateViewHeaders(route);
        
        renderFilters();
        if (route === 'profile') {
            loadProfileData();
        } else if (route === 'admin') {
            loadAdminPanel();
        } else {
            fetchPostsFromAPI(); // Recargar posts con nuevos parámetros
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderAuthUI() {
        if (state.currentUser) {
            DOM.authSection.innerHTML = `
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span style="font-size: 0.9rem; color: var(--text-muted);">@${state.currentUser}</span>
                    <button id="btnLogout" class="btn btn-glass" style="padding: 0.4rem 1rem; font-size: 0.8rem;">Salir</button>
                </div>
            `;
            document.getElementById('btnLogout').addEventListener('click', logout);
            
            // Controlar visibilidad de pestañas de navegación
            const navLinks = document.querySelectorAll('.nav-links a');
            navLinks.forEach(link => {
                const route = link.dataset.route;
                if (state.currentUserProfile === 'trabajador') {
                    // Trabajadores ven "Empleos" y "Perfil"
                    link.style.display = (route === 'offers' || route === 'profile') ? 'block' : 'none';
                } else if (state.currentUserProfile === 'empresa') {
                    link.style.display =
                        route === 'professionals' || route === 'offers' || route === 'profile' || route === 'home'
                            ? 'block'
                            : 'none';
                } else if (profileIsAdmin()) {
                    link.style.display = (route === 'home' || route === 'admin' || route === 'profile') ? 'block' : 'none';
                } else {
                    link.style.display = 'block'; // Usuario sin perfil definido
                }
            });

            if (DOM.profileLink) {
                DOM.profileLink.style.display = state.currentUser ? 'block' : 'none';
            }
            
            // Mostrar botones según el perfil
            if (state.currentUserProfile === 'trabajador') {
                DOM.btnPublishOffer.style.display = 'none'; // Trabajadores no publican ofertas de empleo
                DOM.btnOfferService.style.display = 'inline-flex'; // Trabajadores ofrecen servicios
            } else if (state.currentUserProfile === 'empresa') {
                DOM.btnPublishOffer.style.display = 'inline-flex'; // Empresas publican ofertas de empleo
                DOM.btnOfferService.style.display = 'none'; // Empresas no ofrecen servicios
            } else if (profileIsAdmin()) {
                DOM.btnPublishOffer.style.display = 'none';
                DOM.btnOfferService.style.display = 'none';
            } else {
                DOM.btnPublishOffer.style.display = 'none';
                DOM.btnOfferService.style.display = 'none';
            }
        } else {
            DOM.authSection.innerHTML = `<button class="btn btn-primary" data-route="login">Acceso Interno</button>`;
            DOM.btnPublishOffer.style.display = 'none';
            DOM.btnOfferService.style.display = 'none';
            
            // Mostrar todas las pestañas cuando no hay usuario logueado
            const navLinks = document.querySelectorAll('.nav-links a');
            navLinks.forEach(link => {
                const route = link.dataset.route;
                link.style.display = route === 'profile' || route === 'admin' ? 'none' : 'block';
            });
        }
    }

    async function handleLogin(e) {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        DOM.loginError.style.display = 'none';

        try {
            const response = await fetch(apiUrl('/api/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const rawLogin = await response.text();
            let result = {};
            try {
                result = rawLogin ? JSON.parse(rawLogin) : {};
            } catch {
                DOM.loginError.textContent =
                    'Respuesta inválida del servidor. Abrí http://127.0.0.1:3000 o configurá <meta name="conectapro-api" content="http://127.0.0.1:3000">.';
                DOM.loginError.style.display = 'block';
                return;
            }
            if (!response.ok) {
                DOM.loginError.textContent = result.error || 'Error al iniciar sesión.';
                DOM.loginError.style.display = 'block';
                return;
            }

            state.currentUser = result.username;
            state.currentUserProfile = result.profileType;
            state.currentUserRut = result.rut;
            state.sessionToken = result.token || null;
            localStorage.setItem('conectaproCurrentUser', result.username);
            localStorage.setItem('conectaproCurrentUserProfile', result.profileType);
            localStorage.setItem('conectaproCurrentUserRut', result.rut || '');
            if (result.token) {
                localStorage.setItem('conectaproSessionToken', result.token);
            }
            DOM.loginForm.reset();
            renderAuthUI();
            navigateTo('home');
        } catch (error) {
            DOM.loginError.textContent = 'No se pudo conectar con el servidor.';
            DOM.loginError.style.display = 'block';
            console.error(error);
        }
    }

    async function handleRegister(e) {
        e.preventDefault();
        const rut = document.getElementById('registerRut').value.trim();
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('registerConfirmPassword').value;

        DOM.registerError.style.display = 'none';
        DOM.registerSuccess.style.display = 'none';

        const payload = { rut, password, confirmPassword };

        try {
            await showVerificationProcess();

            const response = await fetch(apiUrl('/api/register'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const raw = await response.text();
            let result = {};
            try {
                result = raw ? JSON.parse(raw) : {};
            } catch {
                hideVerification();
                DOM.registerError.textContent =
                    'El servidor no devolvió JSON (suele pasar si la página no apunta al API de ConectaPro). Abrí http://127.0.0.1:3000 o poné en index.html: <meta name="conectapro-api" content="http://127.0.0.1:3000">.';
                DOM.registerError.style.display = 'block';
                return;
            }

            hideVerification();

            if (!response.ok) {
                let msg = result.error || 'Error al registrar la cuenta.';
                if (/campos obligatorios|faltan campos/i.test(msg)) {
                    msg +=
                        ' — Parece un servidor Node desactualizado: en la terminal donde corre ConectaPro pulsá Ctrl+C, ejecutá de nuevo "npm start" en la carpeta del proyecto y dejá esa terminal abierta; recargá con Ctrl+F5.';
                }
                DOM.registerError.textContent = msg;
                DOM.registerError.style.display = 'block';
                return;
            }

            state.currentUser = result.username;
            state.currentUserProfile = result.profileType;
            state.currentUserRut = result.rut;
            state.sessionToken = result.token || null;
            localStorage.setItem('conectaproCurrentUser', result.username);
            localStorage.setItem('conectaproCurrentUserProfile', result.profileType);
            localStorage.setItem('conectaproCurrentUserRut', result.rut || '');
            if (result.token) {
                localStorage.setItem('conectaproSessionToken', result.token);
            }
            DOM.registerForm.reset();
            DOM.registerSuccess.textContent = `Cuenta creada. Tu usuario para ingresar es: @${result.username} (también podés usar tu RUT).`;
            DOM.registerSuccess.style.display = 'block';
            renderAuthUI();
            setTimeout(() => navigateTo('home'), 1500);
        } catch (error) {
            hideVerification();
            DOM.registerError.textContent = 'No se pudo conectar con el servidor.';
            DOM.registerError.style.display = 'block';
            console.error(error);
        }
    }

    function showVerificationProcess() {
        const overlay = document.getElementById('verificationOverlay');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        const steps = document.querySelectorAll('.step');

        overlay.style.display = 'flex';
        steps.forEach(step => {
            step.classList.remove('active', 'completed');
        });

        let progress = 0;
        let currentStep = 0;

        return new Promise((resolve) => {
            const interval = setInterval(() => {
                // Incrementar progreso
                progress += Math.random() * 30;
                if (progress > 100) progress = 100;

                progressBar.style.width = progress + '%';
                progressText.textContent = `Procesando: ${Math.floor(progress)}%`;

                // Activar pasos según el progreso
                if (progress >= 20 && currentStep < 1) {
                    steps[0].classList.add('active');
                }
                if (progress >= 50 && currentStep < 2) {
                    steps[0].classList.remove('active');
                    steps[0].classList.add('completed');
                    steps[1].classList.add('active');
                    currentStep = 1;
                }
                if (progress >= 80 && currentStep < 3) {
                    steps[1].classList.remove('active');
                    steps[1].classList.add('completed');
                    steps[2].classList.add('active');
                    currentStep = 2;
                }

                // Cuando llegue al 100%
                if (progress >= 100) {
                    clearInterval(interval);
                    steps[2].classList.remove('active');
                    steps[2].classList.add('completed');
                    progressBar.style.width = '100%';
                    progressText.textContent = 'Procesando: 100%';
                    
                    setTimeout(() => {
                        resolve();
                    }, 800);
                }
            }, 150);
        });
    }

    function hideVerification() {
        const overlay = document.getElementById('verificationOverlay');
        overlay.style.display = 'none';
    }

    function updateViewHeaders(route) {
        const offersHeader = document.querySelector('#view-offers .view-header h2');
        const professionalsHeader = document.querySelector('#view-professionals .view-header h2');
        
        if (state.currentUserProfile === 'trabajador') {
            if (route === 'offers') {
                offersHeader.textContent = 'Ofertas de Empleo';
            }
        } else if (state.currentUserProfile === 'empresa') {
            if (route === 'professionals') {
                professionalsHeader.textContent = 'Perfiles de Trabajadores';
            }
            if (route === 'offers') {
                offersHeader.textContent = 'Ofertas de empleo';
            }
        } else {
            // Valores por defecto para usuarios no logueados
            offersHeader.textContent = 'Ofertas Laborales';
            professionalsHeader.textContent = 'Talento Disponible';
        }
    }

    function logout() {
        state.currentUser = null;
        state.currentUserProfile = null;
        state.currentUserRut = null;
        state.sessionToken = null;
        localStorage.removeItem('conectaproCurrentUser');
        localStorage.removeItem('conectaproCurrentUserProfile');
        localStorage.removeItem('conectaproCurrentUserRut');
        localStorage.removeItem('conectaproSessionToken');
        renderAuthUI();
        navigateTo('home');
    }

    async function loadAdminPanel() {
        if (!DOM.adminUsersTable || !DOM.adminPostsTable) return;
        DOM.adminUsersTable.innerHTML = '<p class="text-muted">Cargando…</p>';
        DOM.adminPostsTable.innerHTML = '<p class="text-muted">Cargando…</p>';
        try {
            const headers = authHeaders();
            const [usersRes, postsRes] = await Promise.all([
                fetch(apiUrl('/api/admin/users'), { headers }),
                fetch(
                    apiUrl(
                        `/api/posts?profileType=${encodeURIComponent(state.currentUserProfile)}&view=admin`
                    ),
                    { headers }
                )
            ]);
            if (usersRes.status === 401 || usersRes.status === 403 || postsRes.status === 401 || postsRes.status === 403) {
                DOM.adminUsersTable.innerHTML = '<p class="error-msg">No autorizado. Cierra sesión y vuelve a entrar como administrador.</p>';
                DOM.adminPostsTable.innerHTML = '';
                return;
            }
            const users = await usersRes.json();
            const posts = await postsRes.json();
            if (!usersRes.ok) {
                DOM.adminUsersTable.innerHTML = `<p class="error-msg">${escapeHtml(users.error || 'Error al cargar cuentas.')}</p>`;
            } else {
                DOM.adminUsersTable.innerHTML = renderAdminUsersTable(Array.isArray(users) ? users : []);
            }
            if (!postsRes.ok) {
                DOM.adminPostsTable.innerHTML = `<p class="error-msg">${escapeHtml(posts.error || 'Error al cargar publicaciones.')}</p>`;
            } else {
                DOM.adminPostsTable.innerHTML = renderAdminPostsTable(Array.isArray(posts) ? posts : []);
            }
        } catch (e) {
            console.error(e);
            DOM.adminUsersTable.innerHTML = '<p class="error-msg">Error de conexión.</p>';
            DOM.adminPostsTable.innerHTML = '';
        }
    }

    function renderAdminUsersTable(users) {
        if (!users.length) {
            return '<p class="text-muted">No hay cuentas registradas.</p>';
        }
        const rows = users.map((u) => `
            <tr>
                <td>${escapeHtml(u.username)}</td>
                <td>${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.profile_type)}</td>
                <td>${escapeHtml(u.rut || '')}</td>
                <td class="cell-actions">
                    <button type="button" class="btn btn-glass btn-sm" data-admin-delete-user="${u.id}">Eliminar</button>
                </td>
            </tr>
        `).join('');
        return `
            <table class="admin-table">
                <thead><tr><th>Usuario</th><th>Correo</th><th>Perfil</th><th>RUT</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    function renderAdminPostsTable(posts) {
        if (!posts.length) {
            return '<p class="text-muted">No hay publicaciones.</p>';
        }
        const rows = posts.map((p) => {
            const typeLabel = p.type === 'offer' ? 'Oferta' : 'Trabajador';
            const typeClass = p.type === 'offer' ? 'badge-type-offer' : 'badge-type-service';
            return `
            <tr>
                <td><span class="${typeClass}">${typeLabel}</span></td>
                <td>${escapeHtml(p.title)}</td>
                <td>${escapeHtml(p.user)}</td>
                <td class="cell-actions">
                    <button type="button" class="btn btn-glass btn-sm" data-admin-delete-post="${p.id}">Eliminar</button>
                </td>
            </tr>`;
        }).join('');
        return `
            <table class="admin-table">
                <thead><tr><th>Tipo</th><th>Título</th><th>Autor</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    async function loadProfileData() {
        if (!DOM.profileContainer) return;
        if (!state.currentUserRut) {
            DOM.profileContainer.innerHTML = '<p class="text-muted">No hay RUT asociado a la sesión.</p>';
            return;
        }
        DOM.profileContainer.innerHTML = '<p class="text-muted">Cargando perfil…</p>';
        try {
            const rutEnc = encodeURIComponent(state.currentUserRut);
            const res = await fetch(apiUrl(`/api/profile?rut=${rutEnc}`));
            const data = await res.json();
            if (!res.ok) {
                DOM.profileContainer.innerHTML = `<p class="error-msg">${escapeHtml(data.error || 'No se pudo cargar el perfil.')}</p>`;
                return;
            }
            const verifiedBlock = data.verified
                ? `<div class="verified-banner"><span class="verified-check" aria-hidden="true">✓</span> <strong>Verificado</strong> — datos comprobados contra el registro autorizado (CSV).</div>`
                : `<div class="profile-note text-muted">Tu cuenta aún no está vinculada al registro verificado.</div>`;
            const tipoLabel = String(data.tipo || '').toLowerCase() === 'empresa' ? 'Empresa' : 'Trabajador';
            DOM.profileContainer.innerHTML = `
                <div class="glass-card profile-card">
                    ${verifiedBlock}
                    <h3 class="profile-name">${escapeHtml(data.nombre || '')}</h3>
                    <p class="profile-rut">RUT: <strong>${escapeHtml(data.rut || '')}</strong></p>
                    <p class="profile-meta"><span class="badge">${escapeHtml(tipoLabel)}</span></p>
                    <dl class="profile-dl">
                        <dt>Título / rubro</dt><dd>${escapeHtml(data.titulo || '—')}</dd>
                        ${data.edad ? `<dt>Edad</dt><dd>${escapeHtml(String(data.edad))}</dd>` : ''}
                        <dt>Antecedentes</dt><dd>${escapeHtml(data.antecedentes || '—')}</dd>
                        ${data.username ? `<dt>Usuario en la plataforma</dt><dd>@${escapeHtml(data.username)}</dd>` : ''}
                        ${data.email ? `<dt>Correo</dt><dd>${escapeHtml(data.email)}</dd>` : ''}
                    </dl>
                </div>`;
        } catch (e) {
            console.error(e);
            DOM.profileContainer.innerHTML = '<p class="error-msg">Error de conexión al cargar el perfil.</p>';
        }
    }

    function switchAuthTab(tab) {
        DOM.authTabs.forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tab);
        });
        DOM.loginTab.classList.toggle('active', tab === 'login');
        DOM.registerTab.classList.toggle('active', tab === 'register');
        DOM.loginError.style.display = 'none';
        DOM.registerError.style.display = 'none';
        DOM.registerSuccess.style.display = 'none';
    }

    function renderData() {
        // Doble filtro: Categorías + Texto (Buscador)
        const filtered = state.posts.filter(post => {
            const matchCategory = state.activeFilters.size === 0 || state.activeFilters.has(post.category);
            
            const searchLower = state.searchQuery.toLowerCase();
            const matchSearch = post.title.toLowerCase().includes(searchLower) || 
                                post.description.toLowerCase().includes(searchLower) ||
                                post.category.toLowerCase().includes(searchLower) ||
                                post.user.toLowerCase().includes(searchLower);

            return matchCategory && matchSearch;
        });

        if (state.currentView === 'offers') {
            DOM.offersContainer.innerHTML = filtered.length ? filtered.map(generateCard).join('') : '<p class="text-muted">No hay vacantes que coincidan con tu búsqueda.</p>';
        } else if (state.currentView === 'professionals') {
            DOM.servicesContainer.innerHTML = filtered.length ? filtered.map(generateCard).join('') : '<p class="text-muted">No hay perfiles que coincidan con tu búsqueda.</p>';
        }
    }

    function generateCard(post) {
        const date = new Date(post.date).toLocaleDateString('es-CL');

        const priceText = post.price ? `$${post.price.toLocaleString('es-CL')}` : 'Conversable';

        const rating = post.rating || 5;
        const starsHTML = '★'.repeat(rating) + '☆'.repeat(5 - rating);

        const verifiedChip = post.verified
            ? '<span class="verified-pill" title="Perfil verificado con registro autorizado">✓ Verificado</span>'
            : '';

        let contactLabel = 'Contactar';
        if (state.currentUserProfile === 'empresa' && state.currentView === 'professionals') {
            contactLabel = 'Contactar para trabajo';
        } else if (state.currentUserProfile === 'trabajador' && state.currentView === 'offers') {
            contactLabel = 'Postular / Contactar';
        }

        const safeUser = escapeHtml(post.user);

        return `
            <article class="glass-card card">
                <div class="card-header">
                    <span class="badge">${escapeHtml(post.category)}</span>
                    <span class="price-tag">${priceText}</span>
                </div>
                ${verifiedChip ? `<div class="card-verified-row">${verifiedChip}</div>` : ''}
                <h3 class="card-title">${escapeHtml(post.title)}</h3>
                <p class="card-desc">${escapeHtml(post.description)}</p>

                <div class="card-rating">
                    ${starsHTML} <span class="rating-number">(${rating}.0)</span>
                </div>

                <div class="card-footer">
                    <span style="color: var(--text-main); font-weight: 500;">@${safeUser}</span>
                    <span>${date}</span>
                </div>

                <button type="button" class="btn btn-primary btn-block" data-contact-user="${safeUser}">${contactLabel}</button>
            </article>
        `;
    }

    function renderFilters() {
        const createTags = () => CATEGORIES.map(cat => 
            `<button class="filter-tag ${state.activeFilters.has(cat) ? 'active' : ''}" data-cat="${cat}">${cat}</button>`
        ).join('');

        DOM.filtersOffers.innerHTML = createTags();
        DOM.filtersProfessionals.innerHTML = createTags();
    }

    function populateCategories() {
        DOM.postCategory.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    function openModal(type) {
        DOM.postType.value = type;
        DOM.modalTitle.textContent = type === 'offer' ? 'Nueva Oferta' : 'Nuevo Servicio';
        DOM.modal.showModal();
    }

    function setupEventListeners() {
        // BUSCADOR EN TIEMPO REAL
        DOM.searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            renderData(); // Filtra instantáneamente mientras escribes
        });

        document.addEventListener('click', (e) => {
            const routeBtn = e.target.closest('[data-route]');
            if (routeBtn) {
                e.preventDefault();
                navigateTo(routeBtn.dataset.route);
            }
        });

        document.addEventListener('click', (e) => {
            const filterBtn = e.target.closest('.filter-tag');
            if (filterBtn) {
                const cat = filterBtn.dataset.cat;
                state.activeFilters.has(cat) ? state.activeFilters.delete(cat) : state.activeFilters.add(cat);
                renderFilters();
                renderData();
            }
        });

        document.addEventListener('click', (e) => {
            const contactBtn = e.target.closest('[data-contact-user]');
            if (contactBtn) {
                const u = contactBtn.getAttribute('data-contact-user');
                if (!u) return;
                if (state.currentUserProfile === 'empresa' && state.currentView === 'professionals') {
                    alert(
                        `Solicitud de contacto laboral a @${u}.\n\nEn una versión conectada esto abriría mensajería o correo; por ahora coordiná el siguiente paso con tu equipo de selección.`
                    );
                } else if (state.currentUserProfile === 'trabajador' && state.currentView === 'offers') {
                    alert(`Postulación / contacto con la oferta asociada a @${u} (demo).`);
                } else {
                    alert(`Iniciando contacto con @${u} (demo).`);
                }
            }
        });

        document.addEventListener('click', async (e) => {
            const delUserBtn = e.target.closest('[data-admin-delete-user]');
            if (delUserBtn) {
                const id = delUserBtn.getAttribute('data-admin-delete-user');
                if (!id || !confirm('¿Eliminar esta cuenta de forma permanente? Las publicaciones de ese usuario también se eliminarán.')) {
                    return;
                }
                try {
                    const res = await fetch(apiUrl(`/api/admin/users/${encodeURIComponent(id)}`), {
                        method: 'DELETE',
                        headers: authHeaders()
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        alert(data.error || 'No se pudo eliminar la cuenta.');
                        return;
                    }
                    await loadAdminPanel();
                } catch (err) {
                    console.error(err);
                    alert('Error de conexión.');
                }
                return;
            }
            const delPostBtn = e.target.closest('[data-admin-delete-post]');
            if (delPostBtn) {
                const id = delPostBtn.getAttribute('data-admin-delete-post');
                if (!id || !confirm('¿Eliminar esta publicación?')) {
                    return;
                }
                try {
                    const res = await fetch(apiUrl(`/api/admin/posts/${encodeURIComponent(id)}`), {
                        method: 'DELETE',
                        headers: authHeaders()
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        alert(data.error || 'No se pudo eliminar la publicación.');
                        return;
                    }
                    await loadAdminPanel();
                    if (state.currentView !== 'admin') {
                        await fetchPostsFromAPI();
                    }
                } catch (err) {
                    console.error(err);
                    alert('Error de conexión.');
                }
            }
        });

        DOM.authTabs.forEach(button => {
            button.addEventListener('click', () => switchAuthTab(button.dataset.tab));
        });

        DOM.loginForm.addEventListener('submit', handleLogin);
        DOM.registerForm.addEventListener('submit', handleRegister);
        DOM.btnPublishOffer.addEventListener('click', () => openModal('offer'));
        DOM.btnOfferService.addEventListener('click', () => openModal('service'));
        DOM.btnCloseModal.addEventListener('click', () => DOM.modal.close());

        DOM.postForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const priceInputValue = document.getElementById('postPrice').value;
            const payload = {
                type: DOM.postType.value,
                title: document.getElementById('postTitle').value.trim(),
                category: document.getElementById('postCategory').value,
                description: document.getElementById('postDesc').value.trim(),
                price: priceInputValue ? parseInt(priceInputValue, 10) : null
            };
            try {
                const response = await fetch(apiUrl('/api/posts'), {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify(payload)
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    alert(result.error || 'No se pudo publicar.');
                    return;
                }
                DOM.modal.close();
                DOM.postForm.reset();
                await fetchPostsFromAPI();
            } catch (err) {
                console.error(err);
                alert('No se pudo conectar con el servidor.');
            }
        });
    }

    init();
});