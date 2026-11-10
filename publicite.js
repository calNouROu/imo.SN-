document.addEventListener('DOMContentLoaded', async () => {
    const apiBase = (window.__API_BASE_URL__ || '').replace(/\/+$/, '');
    const section = document.getElementById('campagnes-actives');
    const grid = document.getElementById('activeAdsGrid');
    document.getElementById('currentYear').textContent = String(new Date().getFullYear());

    try {
        const response = await fetch(`${apiBase}/api/ads`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const ads = await response.json();
        if (!ads.length) return;
        grid.replaceChildren();
        for (const ad of ads) {
            const card = document.createElement('article');
            card.className = 'page-card offer-card';
            const heading = document.createElement('h3');
            heading.textContent = ad.company || 'Partenaire IMO SN';
            card.appendChild(heading);
            if (ad.imageUrl && isHttpUrl(ad.imageUrl)) {
                const image = document.createElement('img');
                image.src = ad.imageUrl;
                image.alt = `Campagne de ${ad.company || 'notre partenaire'}`;
                image.loading = 'lazy';
                image.referrerPolicy = 'no-referrer';
                card.appendChild(image);
            }
            if (ad.notes) {
                const description = document.createElement('p');
                description.textContent = ad.notes;
                card.appendChild(description);
            }
            if (ad.link && isHttpUrl(ad.link)) {
                const link = document.createElement('a');
                link.className = 'btn btn-outline-primary';
                link.href = ad.link;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = 'Découvrir le partenaire';
                card.appendChild(link);
            }
            grid.appendChild(card);
        }
        section.hidden = grid.childElementCount === 0;
    } catch (error) {
        console.error('Chargement des campagnes publicitaires impossible:', error);
    }

    function isHttpUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
            return false;
        }
    }
});
