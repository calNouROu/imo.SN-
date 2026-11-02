/* ==========================================================
   IMO SN — JAVASCRIPT COMPLET v3.0
   - Pas d'authGate (site public)
   - Biens chargés dynamiquement depuis l'API
   - WhatsApp & appel direct IMO SN
   - Modal détail avec galerie photos
   - Formulaire de contact inline
   - Filtres & recherche
   ========================================================== */

document.addEventListener('DOMContentLoaded', () => {

    const API_BASE    = (window.__API_BASE_URL__ || '').replace(/\/+$/, '');
    const IMO_PHONE   = window.__IMO_PHONE__    || '+221789846529';
    const IMO_WA_RAW  = (window.__IMO_WHATSAPP__ || '221789846529').replace(/[^0-9]/g, '');

    /* ==========================================================
       1. THÈME SOMBRE / CLAIR
       ========================================================== */
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme  = localStorage.getItem('imoSnTheme');
    const systemDark  = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    const applyTheme = (theme, notify = false) => {
        const isDark = theme === 'dark';
        document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
        localStorage.setItem('imoSnTheme', isDark ? 'dark' : 'light');
        if (themeToggle) {
            themeToggle.setAttribute('aria-label', isDark ? 'Activer le mode clair' : 'Activer le mode sombre');
            themeToggle.innerHTML = `<i class="fas fa-${isDark ? 'sun' : 'moon'}"></i>`;
        }
        if (notify) showToast(isDark ? 'Mode sombre activé 🌙' : 'Mode clair activé ☀️');
    };

    applyTheme(savedTheme || (systemDark ? 'dark' : 'light'));
    if (themeToggle) themeToggle.addEventListener('click', () => {
        applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
    });

    /* ==========================================================
       2. NAVIGATION MOBILE
       ========================================================== */
    const navToggle   = document.getElementById('navToggle');
    const navLinks    = document.getElementById('navLinks');
    const navBackdrop = document.getElementById('navBackdrop');
    const navbar      = document.getElementById('navbar');

    const toggleMenu = (open) => {
        const isOpen = open !== undefined ? open : !navLinks?.classList.contains('active');
        navToggle?.classList.toggle('active', isOpen);
        navToggle?.setAttribute('aria-expanded', String(isOpen));
        navLinks?.classList.toggle('active', isOpen);
        navBackdrop?.classList.toggle('active', isOpen);
        document.body.style.overflow = isOpen ? 'hidden' : '';
    };

    navToggle?.addEventListener('click', () => toggleMenu());
    navBackdrop?.addEventListener('click', () => toggleMenu(false));
    navLinks?.querySelectorAll('a').forEach(l => l.addEventListener('click', () => {
        if (window.innerWidth <= 768) toggleMenu(false);
    }));

    window.addEventListener('scroll', () => {
        if (navbar) {
            navbar.classList.toggle('scrolled', window.scrollY > 40);
        }
    });

    /* ==========================================================
       3. TOAST NOTIFICATION
       ========================================================== */
    const toastEl  = document.getElementById('toastNotification');
    const toastMsg = document.getElementById('toastMessage');
    let toastTimer;

    function showToast(msg, type = 'success') {
        if (!toastEl || !toastMsg) return;
        toastMsg.textContent = msg;
        toastEl.className = `toast toast--${type} show`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3500);
    }

    /* ==========================================================
       4. CHARGEMENT CONFIG SITE DEPUIS L'API
       ========================================================== */
    function loadSiteConfig() {
        fetch(`${API_BASE}/api/config`)
            .then(r => {
                if (!r.ok) throw new Error(`Chargement des coordonnées impossible (HTTP ${r.status}).`);
                return r.json();
            })
            .then(config => {
                if (!config) return;
                // Mettre à jour les liens WhatsApp/téléphone dynamiquement
                const wa = (config.whatsapp || IMO_WA_RAW).replace(/[^0-9]/g, '');
                const phone = config.phone || IMO_PHONE;
                const waMsg = encodeURIComponent('Bonjour IMO SN, je souhaite des informations sur vos biens.');

                // Footer
                const footerAddress = document.getElementById('footerAddress');
                const footerPhone   = document.getElementById('footerPhone');
                const footerWhatsapp= document.getElementById('footerWhatsapp');
                const footerEmail   = document.getElementById('footerEmail');
                const footerHours   = document.getElementById('footerHours');

                if (footerAddress) footerAddress.textContent = config.address || '';
                if (footerPhone) { footerPhone.href = `tel:${phone.replace(/\s/g,'')}`;  footerPhone.textContent = phone; }
                if (footerWhatsapp) footerWhatsapp.href = `https://wa.me/${wa}?text=${waMsg}`;
                if (footerEmail) { footerEmail.href = `mailto:${config.email}`; footerEmail.textContent = config.email; }
                if (footerHours) footerHours.textContent = config.hours || '';

                // Réseaux sociaux
                const fbLink = document.getElementById('footerFacebook');
                const igLink = document.getElementById('footerInstagram');
                const liLink = document.getElementById('footerLinkedin');
                const twLink = document.getElementById('footerTwitter');
                if (fbLink && config.facebook) fbLink.href = config.facebook;
                if (igLink && config.instagram) igLink.href = config.instagram;
                if (liLink && config.linkedin) liLink.href = config.linkedin;
                if (twLink && config.twitter) twLink.href = config.twitter;

                // FAB Buttons
                const fabWa = document.getElementById('fabWhatsapp');
                const fabPh = document.getElementById('fabPhone');
                if (fabWa) fabWa.href = `https://wa.me/${wa}?text=${waMsg}`;
                if (fabPh) fabPh.href = `tel:${phone.replace(/\s/g,'')}`;

                // CTA section
                const ctaCall = document.getElementById('ctaCallBtn');
                const ctaWa   = document.getElementById('ctaWhatsAppBtn');
                if (ctaCall) ctaCall.href = `tel:${phone.replace(/\s/g,'')}`;
                if (ctaWa) ctaWa.href = `https://wa.me/${wa}?text=${waMsg}`;
            })
            .catch(err => console.error('Chargement de la configuration IMO SN impossible:', err));
    }
    loadSiteConfig();

    /* ==========================================================
       5. BIENS IMMOBILIERS — CHARGEMENT DYNAMIQUE
       ========================================================== */
    const propertiesGrid = document.getElementById('propertiesGrid');
    let allProperties    = [];
    let currentFilter    = 'all';

    // Formatage du prix
    function formatPrice(price, type) {
        return Number(price).toLocaleString('fr-FR') + ' FCFA' + (type === 'location' ? ' / mois' : '');
    }

    // Badge statut
    function statusBadge(status) {
        const map = {
            disponible: { label: 'Disponible', cls: 'badge-disponible' },
            loue:       { label: 'Loué',       cls: 'badge-loue' },
            vendu:      { label: 'Vendu',       cls: 'badge-vendu' }
        };
        const s = map[status] || map.disponible;
        return `<span class="property-status-chip ${s.cls}">${s.label}</span>`;
    }

    // Construire une carte propriété
    function buildPropertyCard(p) {
        const imgSrc = (p.images && p.images[0]) || 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&h=400&fit=crop&q=80';
        const typeLabel = p.type === 'vente' ? 'À vendre' : 'À louer';
        const typeCls   = p.type === 'vente' ? 'property-badge--vente' : 'property-badge--location';
        const priceStr  = p.priceFormatted || formatPrice(p.price, p.type);
        const waMsg     = encodeURIComponent(`Bonjour IMO SN, je suis intéressé(e) par le bien : "${p.title}" (réf. ${p.id}). Pouvez-vous me donner plus d'informations ?`);

        const features = [];
        if (p.bedrooms > 0) features.push(`<span><i class="fas fa-bed"></i> ${p.bedrooms} Ch.</span>`);
        if (p.bathrooms > 0) features.push(`<span><i class="fas fa-bath"></i> ${p.bathrooms} SdB</span>`);
        if (p.area > 0)      features.push(`<span><i class="fas fa-ruler-combined"></i> ${p.area} m²</span>`);

        const card = document.createElement('div');
        card.className = 'property-card';
        card.dataset.type = p.type;
        card.dataset.id   = p.id;
        card.innerHTML = `
            <div class="property-image">
                <img src="${escHtml(imgSrc)}" alt="${escHtml(p.title)}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&h=400&fit=crop&q=80'">
                <span class="property-badge ${typeCls}">${typeLabel}</span>
                ${p.featured ? '<span class="property-featured-badge"><i class="fas fa-star"></i> Vedette</span>' : ''}
                <span class="property-views-badge">
                    <i class="fas fa-eye"></i> <span class="view-count-val">${p.views || 0}</span> vues
                </span>
                <div class="property-price">${escHtml(priceStr)}</div>
            </div>
            <div class="property-info">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <h3 class="property-title">${escHtml(p.title)}</h3>
                    ${p.status !== 'disponible' ? statusBadge(p.status) : ''}
                </div>
                <p class="property-location"><i class="fas fa-location-dot"></i> ${escHtml(p.location)}</p>
                <div class="property-features">${features.join('')}</div>
                <div class="property-footer" style="flex-direction: column; gap: 8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span class="property-type"><i class="fas fa-tag"></i> ${escHtml(p.category || 'Bien')}</span>
                        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                            <button type="button" class="property-cta" data-property-id="${escHtml(p.id)}">Aperçu <i class="fas fa-expand"></i></button>
                            <a class="property-cta" href="bien.html?id=${encodeURIComponent(String(p.id))}">Fiche complète <i class="fas fa-arrow-right"></i></a>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <a href="https://wa.me/${IMO_WA_RAW}?text=${waMsg}" class="btn-wa-card" target="_blank" rel="noopener noreferrer">
                            <i class="fab fa-whatsapp"></i> WhatsApp
                        </a>
                        <a href="tel:${IMO_PHONE.replace(/\s/g,'')}" class="btn-call-card">
                            <i class="fas fa-phone"></i> Appeler
                        </a>
                    </div>
                </div>
            </div>
        `;

        // Clic sur "Voir détails"
        card.querySelector('.property-cta')?.addEventListener('click', () => openPropertyModal(p));
        return card;
    }

    // Rendre la grille
    function renderGrid(properties) {
        if (!propertiesGrid) return;
        propertiesGrid.innerHTML = '';

        if (properties.length === 0) {
            propertiesGrid.innerHTML = `
                <div class="no-results" style="grid-column:1/-1; text-align:center; padding:48px 20px;">
                    <i class="fas fa-search" style="font-size:3rem; opacity:0.3; margin-bottom:16px; display:block;"></i>
                    <h3>Aucun bien trouvé</h3>
                    <p style="color: var(--text-secondary);">Essayez d'autres critères de recherche.</p>
                    <a href="contact.html" class="btn btn-primary" style="margin-top:20px;">
                        <i class="fas fa-phone"></i> Contacter IMO SN
                    </a>
                </div>`;
            return;
        }

        properties.forEach(p => propertiesGrid.appendChild(buildPropertyCard(p)));
    }

    // Charger les biens depuis l'API
    async function loadProperties(params = {}) {
        if (!propertiesGrid) return;
        propertiesGrid.innerHTML = '<div class="property-skeleton"></div><div class="property-skeleton"></div><div class="property-skeleton"></div>';

        try {
            const url = new URL(`${API_BASE}/api/biens`);
            Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });

            const r = await fetch(url.toString());
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            allProperties = await r.json();

            // Sur la page d'accueil, montrer seulement les vedettes (max 6)
            const isHomepage = !!document.getElementById('accueil');
            let list = isHomepage ? allProperties.filter(p => p.featured).slice(0, 6) : allProperties;
            if (isHomepage && list.length === 0) list = allProperties.slice(0, 6);

            renderGrid(list);
            updateStats(allProperties);
        } catch (err) {
            if (propertiesGrid) propertiesGrid.innerHTML = `
                <div style="grid-column:1/-1; text-align:center; padding:48px; color: var(--text-secondary);">
                    <i class="fas fa-exclamation-triangle" style="font-size:2rem; margin-bottom:12px; display:block; color: #f59e0b;"></i>
                    <p>Impossible de charger les biens. <a href="javascript:loadProperties()" style="color:var(--primary);">Réessayer</a></p>
                </div>`;
        }
    }

    window.loadProperties = loadProperties;
    loadProperties();

    // Statistiques accueil
    function updateStats(properties) {
        const statBiens = document.getElementById('statBiens');
        const statVues  = document.getElementById('statVues');
        if (statBiens) statBiens.textContent = properties.length;
        if (statVues) {
            const total = properties.reduce((s, p) => s + (p.views || 0), 0);
            statVues.textContent = total.toLocaleString('fr-FR');
        }
    }

    /* ==========================================================
       6. FILTRES BIENS (ACCUEIL)
       ========================================================== */
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter || 'all';

            const isHomepage = !!document.getElementById('accueil');
            let list = currentFilter === 'all'
                ? allProperties
                : allProperties.filter(p => p.type === currentFilter);
            if (isHomepage) list = list.filter(p => p.featured).slice(0, 6);
            if (isHomepage && list.length === 0) list = allProperties.filter(p => p.type === currentFilter).slice(0, 6);
            renderGrid(list);
        });
    });

    /* ==========================================================
       7. RECHERCHE HÉRO
       ========================================================== */
    const heroSearchBtn = document.getElementById('heroSearchBtn');
    heroSearchBtn?.addEventListener('click', () => {
        const type     = document.getElementById('searchType')?.value || 'all';
        const category = document.getElementById('searchCategory')?.value || 'all';
        const location = document.getElementById('searchLocation')?.value || 'all';

        const params = new URLSearchParams();
        if (type !== 'all') params.set('type', type);
        if (category !== 'all') params.set('category', category);
        if (location !== 'all') params.set('location', location);

        window.location.href = `biens.html?${params.toString()}`;
    });

    /* ==========================================================
       8. MODAL DÉTAIL D'UN BIEN
       ========================================================== */
    const modal           = document.getElementById('propertyModal');
    const modalBackdrop   = document.getElementById('modalBackdrop');
    const modalClose      = document.getElementById('modalClose');
    const modalImg        = document.getElementById('modalPropertyImg');
    const modalGalleryThumbs = document.getElementById('modalGalleryThumbs');
    const modalBadge      = document.getElementById('modalPropertyBadge');
    const modalStatusBadge= document.getElementById('modalStatusBadge');
    const modalViews      = document.getElementById('modalViewsCount');
    const modalTitle      = document.getElementById('modalPropertyTitle');
    const modalLocation   = document.getElementById('modalPropertyLocation');
    const modalPrice      = document.getElementById('modalPropertyPrice');
    const modalFeatures   = document.getElementById('modalPropertyFeatures');
    const modalDesc       = document.getElementById('modalPropertyDesc');
    const modalWaBtn      = document.getElementById('modalWhatsAppBtn');
    const modalCallBtn    = document.getElementById('modalCallBtn');
    const modalContactFormBtn = document.getElementById('modalContactFormBtn');
    const modalVideoSection = document.getElementById('modalVideoSection');
    const modalVideoFrame = document.getElementById('modalVideoFrame');

    let currentProperty = null;

    function openPropertyModal(p) {
        if (!modal) return;
        currentProperty = p;

        // Incrémenter le compteur de vues
        fetch(`${API_BASE}/api/biens/${encodeURIComponent(p.id)}/view`, { method: 'POST' })
            .catch(err => console.warn('Comptabilisation de la vue impossible:', err));

        // Image principale + galerie
        const firstImg = (p.images && p.images[0]) || '';
        if (modalImg) { modalImg.src = firstImg; modalImg.alt = p.title; }

        // Miniatures
        if (modalGalleryThumbs && p.images && p.images.length > 1) {
            modalGalleryThumbs.innerHTML = p.images.map((img, i) => `
                <button class="gallery-thumb ${i === 0 ? 'active' : ''}" data-img="${escHtml(img)}" aria-label="Photo ${i + 1}">
                    <img src="${escHtml(img)}" alt="Photo ${i + 1}" loading="lazy">
                </button>`).join('');
            modalGalleryThumbs.style.display = 'flex';

            modalGalleryThumbs.querySelectorAll('.gallery-thumb').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (modalImg) modalImg.src = btn.dataset.img;
                    modalGalleryThumbs.querySelectorAll('.gallery-thumb').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            });
        } else if (modalGalleryThumbs) {
            modalGalleryThumbs.innerHTML = '';
            modalGalleryThumbs.style.display = 'none';
        }

        // Badge type & statut
        if (modalBadge) {
            modalBadge.textContent = p.type === 'vente' ? 'À vendre' : 'À louer';
            modalBadge.className = `modal-badge ${p.type === 'vente' ? 'badge-vente' : 'badge-location'}`;
        }
        if (modalStatusBadge) {
            const statusMap = { disponible: '', loue: 'Loué', vendu: 'Vendu' };
            modalStatusBadge.textContent = statusMap[p.status] || '';
            modalStatusBadge.style.display = p.status !== 'disponible' ? 'block' : 'none';
        }

        if (modalViews)    modalViews.textContent    = p.views || 0;
        if (modalTitle)    modalTitle.textContent     = p.title;
        if (modalLocation) modalLocation.innerHTML    = `<i class="fas fa-location-dot"></i> ${escHtml(p.location)}`;
        if (modalPrice)    modalPrice.textContent     = p.priceFormatted || formatPrice(p.price, p.type);

        // Caractéristiques
        if (modalFeatures) {
            const feats = [];
            if (p.category) feats.push(`<span><i class="fas fa-tag"></i> ${escHtml(p.category)}</span>`);
            if (p.bedrooms > 0) feats.push(`<span><i class="fas fa-bed"></i> ${p.bedrooms} Chambre${p.bedrooms > 1 ? 's' : ''}</span>`);
            if (p.bathrooms > 0) feats.push(`<span><i class="fas fa-bath"></i> ${p.bathrooms} Salle${p.bathrooms > 1 ? 's' : ''} de bain</span>`);
            if (p.area > 0) feats.push(`<span><i class="fas fa-ruler-combined"></i> ${p.area} m²</span>`);
            if (p.city) feats.push(`<span><i class="fas fa-city"></i> ${escHtml(p.city)}</span>`);
            modalFeatures.innerHTML = feats.join('');
        }

        if (modalDesc) modalDesc.textContent = p.description || '';

        // Vidéo
        if (modalVideoSection && modalVideoFrame) {
            if (p.videoUrl) {
                const videoUrl = getEmbedUrl(p.videoUrl);
                modalVideoFrame.src = videoUrl;
                modalVideoSection.style.display = 'block';
            } else {
                modalVideoSection.style.display = 'none';
                modalVideoFrame.src = '';
            }
        }

        // Boutons contact
        const waMsg = encodeURIComponent(`Bonjour IMO SN, je suis intéressé(e) par le bien : "${p.title}" (réf. ${p.id}). Merci de me contacter.`);
        if (modalWaBtn) modalWaBtn.href = `https://wa.me/${IMO_WA_RAW}?text=${waMsg}`;
        if (modalCallBtn) modalCallBtn.href = `tel:${IMO_PHONE.replace(/\s/g, '')}`;

        // Ouvrir le mini formulaire contact
        if (modalContactFormBtn) {
            modalContactFormBtn.onclick = () => {
                closeModal();
                openContactMini(p);
            };
        }

        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modal?.classList.remove('open');
        modal?.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (modalVideoFrame) modalVideoFrame.src = '';
    }

    modalClose?.addEventListener('click', closeModal);
    modalBackdrop?.addEventListener('click', closeModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    // Convertir les URLs YouTube/Vimeo en URLs embed
    function getEmbedUrl(url) {
        if (!url) return '';
        const ytMatch = url.match(/^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[&#?].*)?$/);
        if (ytMatch) return `https://www.youtube-nocookie.com/embed/${ytMatch[1]}`;
        const viMatch = url.match(/^https:\/\/(?:www\.)?vimeo\.com\/(\d+)\/?$/);
        if (viMatch) return `https://player.vimeo.com/video/${viMatch[1]}`;
        return '';
    }

    /* ==========================================================
       9. FORMULAIRE DE CONTACT MINI-MODAL
       ========================================================== */
    const contactMiniModal   = document.getElementById('contactMiniModal');
    const contactMiniBackdrop= document.getElementById('contactMiniBackdrop');
    const contactMiniClose   = document.getElementById('contactMiniClose');
    const contactMiniForm    = document.getElementById('contactMiniForm');
    const contactMiniAlert   = document.getElementById('contactMiniAlert');
    const contactMiniSubmit  = document.getElementById('contactMiniSubmit');

    function openContactMini(property = null) {
        if (!contactMiniModal) return;
        const titleEl = document.getElementById('contactPropertyTitle');
        const idEl    = document.getElementById('contactPropertyId');
        if (property) {
            if (titleEl) titleEl.value = property.title;
            if (idEl)    idEl.value    = property.id;
        }
        contactMiniModal.classList.add('open');
        contactMiniModal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => {
            if (contactMiniModal.classList.contains('open')) {
                document.getElementById('contactName')?.focus({ preventScroll: true });
            }
        });
    }

    function closeContactMini() {
        contactMiniModal?.classList.remove('open');
        contactMiniModal?.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (contactMiniForm) contactMiniForm.reset();
        if (contactMiniAlert) contactMiniAlert.style.display = 'none';
    }

    contactMiniClose?.addEventListener('click', closeContactMini);
    contactMiniBackdrop?.addEventListener('click', closeContactMini);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && contactMiniModal?.classList.contains('open')) {
            closeContactMini();
        }
    });
    contactMiniModal?.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const focusable = Array.from(contactMiniModal.querySelectorAll(
            'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )).filter(element => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });

    contactMiniForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (contactMiniAlert) contactMiniAlert.style.display = 'none';
        if (contactMiniSubmit) {
            contactMiniSubmit.disabled = true;
            contactMiniSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';
        }

        try {
            const payload = {
                name:          document.getElementById('contactName')?.value.trim(),
                email:         document.getElementById('contactEmail')?.value.trim(),
                phone:         document.getElementById('contactPhone')?.value.trim(),
                message:       document.getElementById('contactMessage')?.value.trim(),
                propertyId:    document.getElementById('contactPropertyId')?.value,
                propertyTitle: document.getElementById('contactPropertyTitle')?.value
            };

            const r = await fetch(`${API_BASE}/api/contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await r.json();

            if (!r.ok) throw new Error(result.error || 'Erreur serveur');

            if (contactMiniAlert) {
                contactMiniAlert.className = 'auth-alert success';
                contactMiniAlert.innerHTML = '<i class="fas fa-check-circle"></i><span>Message envoyé ! IMO SN vous répondra rapidement.</span>';
                contactMiniAlert.style.display = 'flex';
            }
            if (contactMiniForm) contactMiniForm.reset();
            setTimeout(closeContactMini, 2500);
        } catch (err) {
            if (contactMiniAlert) {
                contactMiniAlert.className = 'auth-alert error';
                contactMiniAlert.innerHTML = `<i class="fas fa-circle-exclamation"></i><span>${err.message}</span>`;
                contactMiniAlert.style.display = 'flex';
            }
        } finally {
            if (contactMiniSubmit) {
                contactMiniSubmit.disabled = false;
                contactMiniSubmit.innerHTML = '<i class="fas fa-paper-plane"></i> Envoyer le message';
            }
        }
    });

    /* ==========================================================
       10. RETOUR EN HAUT
       ========================================================== */
    const backToTop = document.getElementById('backToTop');
    window.addEventListener('scroll', () => {
        backToTop?.classList.toggle('visible', window.scrollY > 400);
    });
    backToTop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    /* ==========================================================
       11. ANIMATIONS SCROLL (AOS simplifié)
       ========================================================== */
    const aosEls = document.querySelectorAll('[data-aos]');
    if (aosEls.length) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting) {
                    e.target.classList.add('aos-animate');
                    observer.unobserve(e.target);
                }
            });
        }, { threshold: 0.1 });
        aosEls.forEach(el => {
            el.classList.add('aos-init');
            observer.observe(el);
        });
    }

    /* ==========================================================
       12. UTILITAIRES
       ========================================================== */
    function escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Exposer pour usage externe (page biens)
    window.imoSN = {
        openPropertyModal,
        openContactMini,
        buildPropertyCard,
        showToast,
        API_BASE,
        IMO_WA_RAW,
        IMO_PHONE,
        escHtml,
        formatPrice
    };

}); // DOMContentLoaded
