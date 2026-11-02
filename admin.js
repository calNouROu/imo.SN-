document.addEventListener('DOMContentLoaded', () => {
    const API_BASE = (window.__API_BASE_URL__ || '').replace(/\/+$/, '');
    const TOKEN_KEY = 'imoSnAdminToken';
    const authView = document.getElementById('authView');
    const adminApp = document.getElementById('adminApp');
    const authNotice = document.getElementById('authNotice');
    const appNotice = document.getElementById('appNotice');
    let properties = [];
    let contacts = [];
    let ads = [];
    let config = {};
    let selectedImages = [];
    let noticeTimer;

    document.getElementById('loginForm').addEventListener('submit', login);
    document.getElementById('forgotToggle').addEventListener('click', () => {
        const form = document.getElementById('forgotForm');
        form.hidden = !form.hidden;
        if (!form.hidden) document.getElementById('forgotIdentifier').value = document.getElementById('loginIdentifier').value;
    });
    document.getElementById('forgotForm').addEventListener('submit', requestPasswordReset);
    document.getElementById('resetForm').addEventListener('submit', resetPassword);
    document.getElementById('logoutButton').addEventListener('click', logout);
    document.getElementById('propertyForm').addEventListener('submit', saveProperty);
    document.getElementById('propertyImages').addEventListener('change', readSelectedImages);
    document.getElementById('newPropertyButton').addEventListener('click', resetPropertyForm);
    document.getElementById('cancelPropertyEdit').addEventListener('click', resetPropertyForm);
    document.getElementById('adForm').addEventListener('submit', saveAd);
    document.getElementById('cancelAdEdit').addEventListener('click', resetAdForm);
    document.getElementById('settingsForm').addEventListener('submit', saveSettings);
    document.getElementById('passwordForm').addEventListener('submit', changePassword);

    document.querySelectorAll('.admin-nav-item').forEach(button => button.addEventListener('click', () => navigate(button.dataset.panel)));
    document.querySelectorAll('[data-goto]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.goto)));
    document.getElementById('propertiesTable').addEventListener('click', handlePropertyAction);
    document.getElementById('contactsTable').addEventListener('click', handleContactAction);
    document.getElementById('adsTable').addEventListener('click', handleAdAction);

    const resetToken = new URLSearchParams(window.location.search).get('resetToken');
    if (resetToken) {
        document.getElementById('loginPanel').hidden = true;
        document.getElementById('resetPanel').hidden = false;
        document.getElementById('resetForm').dataset.token = resetToken;
        history.replaceState({}, '', window.location.pathname);
        return;
    }

    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) openAdmin();

    async function request(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        const authToken = sessionStorage.getItem(TOKEN_KEY);
        if (authToken) headers.Authorization = `Bearer ${authToken}`;
        if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
        const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                sessionStorage.removeItem(TOKEN_KEY);
                adminApp.hidden = true;
                authView.hidden = false;
            }
            throw new Error(result.error || `La requête a échoué (HTTP ${response.status}).`);
        }
        return result;
    }

    async function login(event) {
        event.preventDefault();
        clearNotice(authNotice);
        const form = event.currentTarget;
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            const result = await request('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    identifier: document.getElementById('loginIdentifier').value.trim(),
                    password: document.getElementById('loginPassword').value
                })
            });
            sessionStorage.setItem(TOKEN_KEY, result.token);
            await openAdmin();
        } catch (error) {
            showNotice(authNotice, error.message, 'error');
        } finally {
            submit.disabled = false;
        }
    }

    async function openAdmin() {
        authView.hidden = true;
        adminApp.hidden = false;
        try {
            const result = await request('/api/auth/me');
            if (!result.user || result.user.role !== 'admin') throw new Error('Cet espace est réservé à l’administrateur IMO SN.');
            document.getElementById('adminUserName').textContent = result.user.name || result.user.identifier;
            await refreshDashboard();
        } catch (error) {
            sessionStorage.removeItem(TOKEN_KEY);
            adminApp.hidden = true;
            authView.hidden = false;
            showNotice(authNotice, error.message, 'error');
        }
    }

    async function requestPasswordReset(event) {
        event.preventDefault();
        try {
            const result = await request('/api/auth/forgot-password', {
                method: 'POST',
                body: JSON.stringify({ identifier: document.getElementById('forgotIdentifier').value.trim() })
            });
            showNotice(authNotice, result.message || 'Si ce compte existe, un lien sera envoyé.', 'success');
        } catch (error) {
            showNotice(authNotice, error.message, 'error');
        }
    }

    async function resetPassword(event) {
        event.preventDefault();
        const password = document.getElementById('resetPassword').value;
        const passwordConfirm = document.getElementById('resetPasswordConfirm').value;
        if (password.length < 12 || password !== passwordConfirm) {
            showNotice(authNotice, 'Utilisez au moins 12 caractères et confirmez le même mot de passe.', 'error');
            return;
        }
        try {
            const result = await request('/api/auth/reset-password', {
                method: 'POST',
                body: JSON.stringify({ resetToken: event.currentTarget.dataset.token, password, passwordConfirm })
            });
            document.getElementById('resetPanel').hidden = true;
            document.getElementById('loginPanel').hidden = false;
            showNotice(authNotice, result.message || 'Mot de passe mis à jour.', 'success');
        } catch (error) {
            showNotice(authNotice, error.message, 'error');
        }
    }

    function logout() {
        sessionStorage.removeItem(TOKEN_KEY);
        adminApp.hidden = true;
        authView.hidden = false;
        document.getElementById('loginForm').reset();
        showNotice(authNotice, 'Vous êtes déconnecté(e).', 'success');
    }

    function navigate(panel) {
        const titles = {
            dashboard: 'Vue d’ensemble',
            properties: 'Biens immobiliers',
            contacts: 'Demandes clients',
            ads: 'Publicités & partenaires',
            settings: 'Informations agence'
        };
        document.querySelectorAll('.admin-nav-item').forEach(button => button.classList.toggle('active', button.dataset.panel === panel));
        document.querySelectorAll('.admin-panel').forEach(section => section.classList.toggle('active', section.id === `panel-${panel}`));
        document.getElementById('panelTitle').textContent = titles[panel] || titles.dashboard;
    }

    async function refreshDashboard() {
        const [stats, propertyList, contactList, adList, siteConfig] = await Promise.all([
            request('/api/admin/stats'),
            request('/api/admin/biens'),
            request('/api/admin/contacts'),
            request('/api/admin/ads'),
            request('/api/admin/config')
        ]);
        properties = propertyList;
        contacts = contactList;
        ads = adList;
        config = siteConfig;
        renderStats(stats);
        renderProperties();
        renderContacts();
        renderAds();
        fillSettings();
        navigate(document.querySelector('.admin-nav-item.active')?.dataset.panel || 'dashboard');
    }

    function renderStats(stats) {
        const cards = [
            ['Biens publiés', stats.biensPublies, 'fa-building'],
            ['À vendre', stats.biensVente, 'fa-key'],
            ['À louer', stats.biensLocation, 'fa-house'],
            ['Vues cumulées', stats.totalVues, 'fa-eye'],
            ['Demandes reçues', stats.totalContacts, 'fa-inbox'],
            ['Campagnes publicitaires', stats.totalAds, 'fa-rectangle-ad']
        ];
        const grid = document.getElementById('statsGrid');
        grid.replaceChildren(...cards.map(([label, value, icon]) => {
            const card = element('article', 'admin-stat-card');
            const symbol = element('span', 'admin-stat-icon');
            symbol.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
            card.append(symbol, element('span', 'admin-stat-label', label), element('strong', 'admin-stat-value', Number(value || 0).toLocaleString('fr-FR')));
            return card;
        }));
        const top = document.getElementById('topProperties');
        top.replaceChildren(...(stats.topBiens || []).map(property => {
            const row = document.createElement('tr');
            row.append(cell(property.title), cell(property.type === 'location' ? 'Location' : 'Vente'), cell(Number(property.views || 0).toLocaleString('fr-FR')));
            return row;
        }));
        document.getElementById('unreadCount').textContent = contacts.filter(item => !item.read).length || '';
    }

    function renderProperties() {
        const body = document.getElementById('propertiesTable');
        body.replaceChildren(...properties.map(property => {
            const row = document.createElement('tr');
            const heading = element('strong', '', property.title);
            const location = element('small', '', property.location);
            const titleCell = document.createElement('td');
            titleCell.append(heading, document.createElement('br'), location);
            row.append(titleCell, cell(property.priceFormatted || `${Number(property.price).toLocaleString('fr-FR')} FCFA`));
            row.append(cell(({ disponible: 'Disponible', loue: 'Loué', vendu: 'Vendu' })[property.status] || property.status));
            row.append(cell(property.published === false ? 'Dépublié' : 'Publié'));
            row.append(cell(Number(property.views || 0).toLocaleString('fr-FR')));
            const actions = document.createElement('td');
            actions.className = 'admin-row-actions';
            actions.append(
                actionButton('edit-property', property.id, 'Modifier', 'fa-pen'),
                actionButton('toggle-property', property.id, property.published === false ? 'Publier' : 'Dépublier', property.published === false ? 'fa-eye' : 'fa-eye-slash'),
                actionButton('delete-property', property.id, 'Supprimer', 'fa-trash')
            );
            row.appendChild(actions);
            return row;
        }));
    }

    function renderContacts() {
        const body = document.getElementById('contactsTable');
        body.replaceChildren(...contacts.map(contact => {
            const row = document.createElement('tr');
            const client = document.createElement('td');
            const name = element('strong', '', contact.name || 'Client');
            const email = document.createElement('a');
            email.href = `mailto:${contact.email || ''}`;
            email.textContent = contact.email || contact.phone || 'Coordonnées non fournies';
            client.append(name, document.createElement('br'), email);
            const message = document.createElement('td');
            const details = document.createElement('details');
            const summary = element('summary', '', contact.subject || contact.propertyTitle || 'Lire la demande');
            details.append(summary, element('p', 'admin-contact-message', contact.message));
            message.appendChild(details);
            const actions = document.createElement('td');
            actions.className = 'admin-row-actions';
            if (!contact.read) actions.appendChild(actionButton('read-contact', contact.id, 'Marquer comme lu', 'fa-check'));
            actions.appendChild(actionButton('delete-contact', contact.id, 'Supprimer', 'fa-trash'));
            row.append(client, message, cell(new Date(contact.createdAt).toLocaleString('fr-FR')), cell(contact.read ? 'Lu' : 'Nouveau'), actions);
            row.classList.toggle('admin-row-unread', !contact.read);
            return row;
        }));
        document.getElementById('unreadCount').textContent = contacts.filter(item => !item.read).length || '';
    }

    function renderAds() {
        const body = document.getElementById('adsTable');
        body.replaceChildren(...ads.map(ad => {
            const row = document.createElement('tr');
            const period = [ad.startDate, ad.endDate].filter(Boolean).join(' → ') || 'Non défini';
            row.append(cell(ad.company), cell(ad.format || 'Bannière'), cell(period), cell(ad.active === false ? 'Dépubliée' : 'Validée / publiée'));
            const actions = document.createElement('td');
            actions.className = 'admin-row-actions';
            actions.append(
                actionButton('edit-ad', ad.id, 'Modifier', 'fa-pen'),
                actionButton('toggle-ad', ad.id, ad.active === false ? 'Publier' : 'Dépublier', ad.active === false ? 'fa-eye' : 'fa-eye-slash'),
                actionButton('delete-ad', ad.id, 'Supprimer', 'fa-trash')
            );
            row.appendChild(actions);
            return row;
        }));
    }

    function editProperty(id) {
        const property = properties.find(item => item.id === id);
        if (!property) return;
        document.getElementById('propertyId').value = property.id;
        document.getElementById('propertyTitle').value = property.title || '';
        document.getElementById('propertyType').value = property.type || 'vente';
        document.getElementById('propertyCategory').value = property.category || 'Autre';
        document.getElementById('propertyPrice').value = property.price || '';
        document.getElementById('propertyLocation').value = property.location || '';
        document.getElementById('propertyCity').value = property.city || '';
        document.getElementById('propertyNeighborhood').value = property.neighborhood || '';
        document.getElementById('propertyBedrooms').value = property.bedrooms || 0;
        document.getElementById('propertyBathrooms').value = property.bathrooms || 0;
        document.getElementById('propertyArea').value = property.area || 0;
        document.getElementById('propertyStatus').value = property.status || 'disponible';
        document.getElementById('propertyVideo').value = property.videoUrl || '';
        document.getElementById('propertyDescription').value = property.description || '';
        document.getElementById('propertyFeatured').checked = Boolean(property.featured);
        document.getElementById('propertyPublished').checked = property.published !== false;
        selectedImages = [...(property.images || [])];
        document.getElementById('propertyFormTitle').textContent = 'Modifier un bien';
        document.getElementById('cancelPropertyEdit').hidden = false;
        renderImagePreview();
        navigate('properties');
        document.getElementById('propertyFormTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function saveProperty(event) {
        event.preventDefault();
        try {
            const id = document.getElementById('propertyId').value;
            const property = {
                title: document.getElementById('propertyTitle').value.trim(),
                type: document.getElementById('propertyType').value,
                category: document.getElementById('propertyCategory').value,
                price: Number(document.getElementById('propertyPrice').value),
                location: document.getElementById('propertyLocation').value.trim(),
                city: document.getElementById('propertyCity').value.trim(),
                neighborhood: document.getElementById('propertyNeighborhood').value.trim(),
                bedrooms: Number(document.getElementById('propertyBedrooms').value || 0),
                bathrooms: Number(document.getElementById('propertyBathrooms').value || 0),
                area: Number(document.getElementById('propertyArea').value || 0),
                description: document.getElementById('propertyDescription').value.trim(),
                videoUrl: document.getElementById('propertyVideo').value.trim(),
                featured: document.getElementById('propertyFeatured').checked,
                published: document.getElementById('propertyPublished').checked,
                status: document.getElementById('propertyStatus').value,
                images: selectedImages
            };
            await request(id ? `/api/admin/biens/${encodeURIComponent(id)}` : '/api/admin/biens', {
                method: id ? 'PUT' : 'POST',
                body: JSON.stringify(property)
            });
            showNotice(appNotice, id ? 'Le bien a été mis à jour.' : 'Le bien a été ajouté.', 'success');
            resetPropertyForm();
            await refreshDashboard();
        } catch (error) {
            showNotice(appNotice, error.message, 'error');
        }
    }

    async function readSelectedImages(event) {
        const files = [...event.currentTarget.files];
        if (selectedImages.length + files.length > 10) {
            showNotice(appNotice, '10 photos maximum par bien.', 'error');
            event.currentTarget.value = '';
            return;
        }
        if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)) {
            showNotice(appNotice, 'Chaque photo doit être au format JPEG, PNG ou WebP et ne pas dépasser 2 Mo.', 'error');
            event.currentTarget.value = '';
            return;
        }
        try {
            const encoded = await Promise.all(files.map(readAsDataUrl));
            selectedImages.push(...encoded);
            renderImagePreview();
        } catch (error) {
            showNotice(appNotice, error.message, 'error');
        } finally {
            event.currentTarget.value = '';
        }
    }

    function readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(`Lecture impossible : ${file.name}`));
            reader.readAsDataURL(file);
        });
    }

    function renderImagePreview() {
        const container = document.getElementById('propertyImagePreview');
        container.replaceChildren(...selectedImages.map((source, index) => {
            const item = document.createElement('div');
            const image = document.createElement('img');
            image.src = source;
            image.alt = `Photo ${index + 1}`;
            const remove = actionButton('remove-image', String(index), 'Retirer cette photo', 'fa-xmark');
            item.append(image, remove);
            return item;
        }));
    }

    function resetPropertyForm() {
        document.getElementById('propertyForm').reset();
        document.getElementById('propertyId').value = '';
        document.getElementById('propertyPublished').checked = true;
        document.getElementById('propertyFormTitle').textContent = 'Ajouter un bien';
        document.getElementById('cancelPropertyEdit').hidden = true;
        document.getElementById('propertyImagePreview').replaceChildren();
        selectedImages = [];
    }

    async function handlePropertyAction(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const { action, id } = button.dataset;
        try {
            if (action === 'edit-property') return editProperty(id);
            if (action === 'remove-image') {
                selectedImages.splice(Number(id), 1);
                renderImagePreview();
                return;
            }
            if (action === 'delete-property') {
                if (!window.confirm('Supprimer définitivement cette annonce ?')) return;
                await request(`/api/admin/biens/${encodeURIComponent(id)}`, { method: 'DELETE' });
            } else if (action === 'toggle-property') {
                const property = properties.find(item => item.id === id);
                await request(`/api/admin/biens/${encodeURIComponent(id)}`, {
                    method: 'PUT',
                    body: JSON.stringify({ published: property.published === false })
                });
            }
            showNotice(appNotice, 'La liste des biens a été mise à jour.', 'success');
            await refreshDashboard();
        } catch (error) {
            showNotice(appNotice, error.message, 'error');
        }
    }

    async function handleContactAction(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        try {
            if (button.dataset.action === 'delete-contact') {
                if (!window.confirm('Supprimer cette demande client ?')) return;
                await request(`/api/admin/contacts/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
            } else if (button.dataset.action === 'read-contact') {
                await request(`/api/admin/contacts/${encodeURIComponent(button.dataset.id)}/read`, { method: 'PATCH' });
            }
            await refreshDashboard();
        } catch (error) {
            showNotice(appNotice, error.message, 'error');
        }
    }

    async function saveAd(event) {
        event.preventDefault();
        const id = document.getElementById('adId').value;
        const campaign = {
            company: document.getElementById('adCompany').value.trim(),
            contact: document.getElementById('adContact').value.trim(),
            email: document.getElementById('adEmail').value.trim(),
            phone: document.getElementById('adPhone').value.trim(),
            format: document.getElementById('adFormat').value.trim(),
            startDate: document.getElementById('adStartDate').value || null,
            endDate: document.getElementById('adEndDate').value || null,
            imageUrl: document.getElementById('adImage').value.trim(),
            link: document.getElementById('adLink').value.trim(),
            notes: document.getElementById('adNotes').value.trim(),
            active: document.getElementById('adActive').checked
        };
        try {
            await request(id ? `/api/admin/ads/${encodeURIComponent(id)}` : '/api/admin/ads', {
                method: id ? 'PUT' : 'POST',
                body: JSON.stringify(campaign)
            });
            resetAdForm();
            await refreshDashboard();
            showNotice(appNotice, 'La campagne publicitaire a été enregistrée.', 'success');
        } catch (error) {
            showNotice(appNotice, error.message, 'error');
        }
    }

    function editAd(id) {
        const ad = ads.find(item => item.id === id);
        if (!ad) return;
        document.getElementById('adId').value = ad.id;
        document.getElementById('adCompany').value = ad.company || '';
        document.getElementById('adContact').value = ad.contact || '';
        document.getElementById('adEmail').value = ad.email || '';
        document.getElementById('adPhone').value = ad.phone || '';
        document.getElementById('adFormat').value = ad.format || '';
        document.getElementById('adStartDate').value = ad.startDate || '';
        document.getElementById('adEndDate').value = ad.endDate || '';
        document.getElementById('adImage').value = ad.imageUrl || '';
        document.getElementById('adLink').value = ad.link || '';
        document.getElementById('adNotes').value = ad.notes || '';
        document.getElementById('adActive').checked = ad.active !== false;
        document.getElementById('adFormTitle').textContent = 'Modifier la campagne';
        document.getElementById('cancelAdEdit').hidden = false;
        document.getElementById('adFormTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function resetAdForm() {
        document.getElementById('adForm').reset();
        document.getElementById('adId').value = '';
        document.getElementById('adActive').checked = true;
        document.getElementById('adFormat').value = 'Bannière';
        document.getElementById('adFormTitle').textContent = 'Ajouter une campagne';
        document.getElementById('cancelAdEdit').hidden = true;
    }

    async function handleAdAction(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const { action, id } = button.dataset;
        try {
            if (action === 'edit-ad') return editAd(id);
            if (action === 'delete-ad') {
                if (!window.confirm('Supprimer cette campagne publicitaire ?')) return;
                await request(`/api/admin/ads/${encodeURIComponent(id)}`, { method: 'DELETE' });
            } else if (action === 'toggle-ad') {
                const ad = ads.find(item => item.id === id);
                await request(`/api/admin/ads/${encodeURIComponent(id)}`, {
                    method: 'PUT',
                    body: JSON.stringify({ active: ad.active === false })
                });
            }
            await refreshDashboard();
        } catch (error) {
            showNotice(appNotice, error.message, 'error');
        }
    }

    function fillSettings() {
        const fields = {
            configCompanyName: 'companyName', configTagline: 'tagline', configAddress: 'address',
            configPhone: 'phone', configWhatsapp: 'whatsapp', configEmail: 'email',
            configHours: 'hours', configFacebook: 'facebook', configInstagram: 'instagram',
            configLinkedin: 'linkedin', configTwitter: 'twitter'
        };
        for (const [id, key] of Object.entries(fields)) {
            const value = config[key] || '';
            document.getElementById(id).value = value === '#' ? '' : value;
        }
    }

    async function saveSettings(event) {
        event.preventDefault();
        const settings = {
            companyName: document.getElementById('configCompanyName').value.trim(),
            tagline: document.getElementById('configTagline').value.trim(),
            address: document.getElementById('configAddress').value.trim(),
            phone: document.getElementById('configPhone').value.trim(),
            whatsapp: document.getElementById('configWhatsapp').value.trim(),
            email: document.getElementById('configEmail').value.trim(),
            hours: document.getElementById('configHours').value.trim(),
            facebook: document.getElementById('configFacebook').value.trim(),
            instagram: document.getElementById('configInstagram').value.trim(),
            linkedin: document.getElementById('configLinkedin').value.trim(),
            twitter: document.getElementById('configTwitter').value.trim()
        };
        try {
            const result = await request('/api/admin/config', { method: 'PUT', body: JSON.stringify(settings) });
            config = result.config;
            showNotice(appNotice, 'Les informations publiques de l’agence ont été mises à jour.', 'success');
        } catch (error) {
            showNotice(appNotice, error.message, 'error');
        }
    }

    async function changePassword(event) {
        event.preventDefault();
        try {
            const result = await request('/api/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({
                    currentPassword: document.getElementById('currentPassword').value,
                    newPassword: document.getElementById('newPassword').value
                })
            });
            event.currentTarget.reset();
            showNotice(appNotice, result.message || 'Mot de passe modifié.', 'success');
        } catch (error) {
            showNotice(appNotice, error.message, 'error');
        }
    }

    function actionButton(action, id, label, icon) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'admin-icon-button';
        button.dataset.action = action;
        button.dataset.id = id;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
        return button;
    }

    function cell(text) {
        return element('td', '', text == null ? '' : String(text));
    }

    function element(tag, className = '', text = '') {
        const node = document.createElement(tag);
        if (className) node.className = className;
        node.textContent = text;
        return node;
    }

    function showNotice(node, text, state) {
        clearNotice(node);
        node.textContent = text;
        node.dataset.state = state;
        if (node === appNotice) noticeTimer = window.setTimeout(() => clearNotice(node), 6000);
    }

    function clearNotice(node) {
        if (node === appNotice) window.clearTimeout(noticeTimer);
        node.textContent = '';
        delete node.dataset.state;
    }
});
