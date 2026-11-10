document.addEventListener('DOMContentLoaded', () => {
    const apiBase = (window.__API_BASE_URL__ || '').replace(/\/+$/, '');
    const form = document.getElementById('contactPageForm');
    const status = document.getElementById('contactPageStatus');
    document.getElementById('currentYear').textContent = String(new Date().getFullYear());
    const query = new URLSearchParams(window.location.search);
    const subject = document.getElementById('contactPageSubject');
    const propertyId = query.get('propertyId') || '';
    const propertyTitle = query.get('propertyTitle') || '';
    if (subject && query.get('subject') === 'publicite') subject.value = 'Offre publicitaire';
    if (subject && query.get('subject') === 'visite') subject.value = 'Demande de visite';
    document.getElementById('contactPropertyId').value = propertyId.slice(0, 100);
    document.getElementById('contactPropertyTitle').value = propertyTitle.slice(0, 200);
    if (propertyTitle) {
        const message = document.getElementById('contactPageMessage');
        message.value = `Bonjour IMO SN, je souhaite des informations sur « ${propertyTitle} » (réf. ${propertyId}).`;
    }

    fetch(`${apiBase}/api/config`)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(config => {
            const phone = config.phone || '+221 78 984 65 29';
            const whatsapp = String(config.whatsapp || '+221789846529').replace(/\D/g, '');
            const email = config.email || 'contact@imo-sn.com';
            const phoneLink = document.getElementById('contactPhoneLink');
            const whatsappLink = document.getElementById('contactWhatsappLink');
            const emailLink = document.getElementById('contactEmailLink');
            if (phoneLink) {
                phoneLink.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
                phoneLink.textContent = phone;
            }
            if (whatsappLink) whatsappLink.href = `https://wa.me/${whatsapp}?text=${encodeURIComponent('Bonjour IMO SN, je souhaite vous contacter.')}`;
            if (emailLink) {
                emailLink.href = `mailto:${email}`;
                emailLink.textContent = email;
            }
            document.getElementById('contactAddress').textContent = config.address || '';
            document.getElementById('contactHours').textContent = config.hours || '';
        })
        .catch(error => console.error('Chargement des coordonnées IMO SN impossible:', error));

    form?.addEventListener('submit', async event => {
        event.preventDefault();
        status.textContent = '';
        status.dataset.state = '';
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
            const payload = Object.fromEntries(new FormData(form).entries());
            const response = await fetch(`${apiBase}/api/contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Le message n’a pas pu être envoyé.');
            status.dataset.state = 'success';
            status.textContent = result.message || 'Votre message a bien été transmis à IMO SN.';
            form.reset();
        } catch (error) {
            status.dataset.state = 'error';
            status.textContent = error.message || 'Erreur réseau. Réessayez ou contactez-nous par téléphone.';
        } finally {
            submit.disabled = false;
        }
    });
});
