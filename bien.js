document.addEventListener('DOMContentLoaded', async () => {
    const api = window.imoSN;
    const id = new URLSearchParams(window.location.search).get('id');
    const message = document.getElementById('detailMessage');
    document.getElementById('currentYear').textContent = String(new Date().getFullYear());

    if (!api || !id) {
        showError('Cette annonce n’est pas disponible. Revenez au catalogue pour choisir un bien.');
        return;
    }

    try {
        const response = await fetch(`${api.API_BASE}/api/biens/${encodeURIComponent(id)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Bien non trouvé.');
        render(data);
        document.getElementById('detailLayout').hidden = false;
        message.hidden = true;
        document.title = `${data.title} | IMO SN`;
        document.querySelector('meta[name="description"]').content = `${data.category || 'Bien immobilier'} proposé par IMO SN à ${data.location}.`;
        fetch(`${api.API_BASE}/api/biens/${encodeURIComponent(id)}/view`, { method: 'POST' })
            .then(result => result.ok ? result.json() : Promise.reject(new Error(`HTTP ${result.status}`)))
            .then(result => { document.getElementById('detailViews').textContent = Number(result.views).toLocaleString('fr-FR'); })
            .catch(error => console.warn('Comptabilisation de la vue impossible:', error));
    } catch (error) {
        showError(error.message || 'Impossible de charger ce bien. Réessayez plus tard.');
    }

    function render(property) {
        const title = property.title || 'Bien immobilier';
        document.getElementById('detailTitle').textContent = title;
        document.getElementById('detailHeading').textContent = title;
        document.getElementById('detailLocation').textContent = property.location || '';
        document.getElementById('detailType').textContent = `${property.category || 'Bien'} · ${property.type === 'location' ? 'Location' : 'Vente'}`;
        document.getElementById('detailPrice').textContent = property.priceFormatted || api.formatPrice(property.price, property.type);
        document.getElementById('detailDescription').textContent = property.description || 'Pour en savoir plus sur ce bien, contactez directement IMO SN.';
        document.getElementById('detailViews').textContent = Number(property.views || 0).toLocaleString('fr-FR');

        const statusLabels = { disponible: 'Disponible', loue: 'Loué', vendu: 'Vendu' };
        document.getElementById('detailStatus').textContent = statusLabels[property.status] || 'Statut à confirmer auprès de l’agence';
        const features = [];
        if (Number(property.bedrooms) > 0) features.push(`${property.bedrooms} chambre${Number(property.bedrooms) > 1 ? 's' : ''}`);
        if (Number(property.bathrooms) > 0) features.push(`${property.bathrooms} salle${Number(property.bathrooms) > 1 ? 's' : ''} de bain`);
        if (Number(property.area) > 0) features.push(`${property.area} m²`);
        if (property.city) features.push(property.city);
        document.getElementById('detailFeatures').replaceChildren(...features.map(text => {
            const item = document.createElement('span');
            item.textContent = text;
            return item;
        }));

        const photos = Array.isArray(property.images) ? property.images.filter(isSafeImage).slice(0, 10) : [];
        const mainImage = document.getElementById('detailMainImage');
        const thumbnails = document.getElementById('detailThumbnails');
        if (photos.length) {
            mainImage.src = photos[0];
            mainImage.alt = `Photo de ${title}`;
            photos.forEach((source, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.setAttribute('aria-label', `Afficher la photo ${index + 1}`);
                button.setAttribute('aria-pressed', String(index === 0));
                const image = document.createElement('img');
                image.src = source;
                image.alt = '';
                image.loading = 'lazy';
                button.appendChild(image);
                button.addEventListener('click', () => {
                    mainImage.src = source;
                    thumbnails.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
                });
                thumbnails.appendChild(button);
            });
        } else {
            mainImage.hidden = true;
            thumbnails.hidden = true;
        }

        const phone = window.__IMO_PHONE__ || '+221789846529';
        const whatsapp = String(window.__IMO_WHATSAPP__ || '221789846529').replace(/\D/g, '');
        const whatsAppMessage = `Bonjour IMO SN, je souhaite des informations sur « ${title} » (réf. ${property.id}).`;
        document.getElementById('detailWhatsapp').href = `https://wa.me/${whatsapp}?text=${encodeURIComponent(whatsAppMessage)}`;
        document.getElementById('detailCall').href = `tel:${phone.replace(/[^\d+]/g, '')}`;
        document.getElementById('detailContact').href = `contact.html?subject=visite&propertyId=${encodeURIComponent(property.id)}&propertyTitle=${encodeURIComponent(title)}`;

        const videoUrl = getEmbedUrl(property.videoUrl);
        if (videoUrl) {
            document.getElementById('detailVideo').src = videoUrl;
            document.getElementById('detailVideoSection').hidden = false;
        }
    }

    function showError(text) {
        message.textContent = text;
        message.dataset.state = 'error';
        const back = document.createElement('a');
        back.className = 'btn btn-primary';
        back.href = 'biens.html';
        back.textContent = 'Retour aux biens';
        message.appendChild(document.createElement('br'));
        message.appendChild(back);
    }

    function isSafeImage(value) {
        if (typeof value !== 'string') return false;
        try {
            const url = new URL(value);
            if (url.protocol === 'https:') return !url.username && !url.password;
        } catch { }
        return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value);
    }

    function getEmbedUrl(value) {
        if (typeof value !== 'string') return '';
        const youtube = value.match(/^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[&#?].*)?$/);
        if (youtube) return `https://www.youtube-nocookie.com/embed/${youtube[1]}`;
        const vimeo = value.match(/^https:\/\/(?:www\.)?vimeo\.com\/(\d+)\/?$/);
        return vimeo ? `https://player.vimeo.com/video/${vimeo[1]}` : '';
    }
});
