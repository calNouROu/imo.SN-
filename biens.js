document.addEventListener('DOMContentLoaded', async () => {
    const api = window.imoSN;
    const grid = document.getElementById('biensGrid');
    if (!api || !grid) return;

    const searchInput = document.getElementById('biensSearchInput');
    const typeInput = document.getElementById('biensType');
    const categoryInput = document.getElementById('biensCategory');
    const locationInput = document.getElementById('biensLocation');
    const budgetInput = document.getElementById('biensBudget');
    const sortInput = document.getElementById('biensSort');
    const count = document.getElementById('biensResultsCount');
    const params = new URLSearchParams(window.location.search);
    const properties = [];

    for (const [key, element] of [
        ['type', typeInput],
        ['category', categoryInput],
        ['location', locationInput]
    ]) {
        const value = params.get(key);
        if (value && element && [...element.options].some(option => option.value.toLowerCase() === value.toLowerCase()))
            element.value = [...element.options].find(option => option.value.toLowerCase() === value.toLowerCase()).value;
    }

    async function load() {
        grid.setAttribute('aria-busy', 'true');
        try {
            const response = await fetch(`${api.API_BASE}/api/biens`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            properties.splice(0, properties.length, ...result);
            render();
        } catch {
            grid.replaceChildren();
            const message = document.createElement('p');
            message.className = 'catalogue-error';
            message.textContent = 'Impossible de charger le catalogue. Vérifiez votre connexion puis réessayez.';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'btn btn-primary';
            retry.textContent = 'Réessayer';
            retry.addEventListener('click', load);
            grid.append(message, retry);
            if (count) count.textContent = 'Catalogue indisponible';
        } finally {
            grid.removeAttribute('aria-busy');
        }
    }

    function render() {
        const query = (searchInput?.value || '').trim().toLocaleLowerCase('fr');
        const location = (locationInput?.value || 'all').toLocaleLowerCase('fr');
        const type = typeInput?.value || 'all';
        const category = (categoryInput?.value || 'all').toLocaleLowerCase('fr');
        const maxPrice = Number(budgetInput?.value || 0);
        const sort = sortInput?.value || 'featured';

        const matches = properties.filter(property => {
            const searchable = `${property.title || ''} ${property.description || ''} ${property.location || ''} ${property.category || ''}`.toLocaleLowerCase('fr');
            const propertyLocation = `${property.location || ''} ${property.city || ''} ${property.neighborhood || ''}`.toLocaleLowerCase('fr');
            return (type === 'all' || property.type === type) &&
                (category === 'all' || (property.category || '').toLocaleLowerCase('fr') === category) &&
                (location === 'all' || propertyLocation.includes(location)) &&
                (!maxPrice || Number(property.price) <= maxPrice) &&
                (!query || searchable.includes(query));
        });

        matches.sort((a, b) => {
            if (sort === 'price-asc') return Number(a.price) - Number(b.price);
            if (sort === 'price-desc') return Number(b.price) - Number(a.price);
            if (sort === 'views') return Number(b.views || 0) - Number(a.views || 0);
            if (sort === 'recent') return Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
            return Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
                Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0);
        });

        grid.replaceChildren();
        if (!matches.length) {
            const empty = document.createElement('div');
            empty.className = 'no-results';
            empty.innerHTML = '<i class="fas fa-magnifying-glass" aria-hidden="true"></i><h2>Aucun bien ne correspond à ces critères</h2><p>Modifiez les filtres ou contactez IMO SN pour nous parler de votre recherche.</p><a class="btn btn-primary" href="contact.html">Contacter IMO SN</a>';
            grid.appendChild(empty);
        } else {
            matches.forEach(property => grid.appendChild(api.buildPropertyCard(property)));
        }
        if (count) count.textContent = `${matches.length} bien${matches.length > 1 ? 's' : ''} proposé${matches.length > 1 ? 's' : ''} par IMO SN`;
    }

    document.getElementById('biensSearchBtn')?.addEventListener('click', render);
    document.getElementById('biensResetBtn')?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        if (typeInput) typeInput.value = 'all';
        if (categoryInput) categoryInput.value = 'all';
        if (locationInput) locationInput.value = 'all';
        if (budgetInput) budgetInput.value = '';
        if (sortInput) sortInput.value = 'featured';
        window.history.replaceState({}, '', window.location.pathname);
        render();
    });
    for (const element of [searchInput, typeInput, categoryInput, locationInput, budgetInput, sortInput])
        element?.addEventListener(element === searchInput ? 'input' : 'change', render);
    searchInput?.addEventListener('keydown', event => {
        if (event.key === 'Enter') render();
    });

    await load();
});
