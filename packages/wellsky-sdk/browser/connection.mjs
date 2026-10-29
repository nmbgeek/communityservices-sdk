const moduleSuffix = '/com.bowmansystems.sp5.core.ServicePoint/';
const defaultOrigin = 'https://wscs.wellsky.com';
const defaultApi = 'https://csclientapi.wellsky.com/client-api-prod';
const pages = new WeakMap();

export function validateTenant(tenant) {
    if (typeof tenant !== 'string' || !/^[A-Za-z0-9_-]+$/.test(tenant)) throw new TypeError('A valid tenant is required');
    return tenant;
}

/** The tenant selects the deployment; live and training use identical operations. */
export function resolveUiConnection({tenant, moduleBaseUrl} = {}) {
    validateTenant(tenant);
    const url = new URL(moduleBaseUrl ?? `${defaultOrigin}/${tenant}${moduleSuffix}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== `/${tenant}${moduleSuffix}`) throw new TypeError('Module URL must match the configured tenant');
    return Object.freeze({tenant, moduleBaseUrl: url.href, scope: url.origin === defaultOrigin ? tenant : JSON.stringify([url.origin, tenant])});
}

/** Pin a page once. A helper must never follow a later navigation into another tenant. */
export function pageConnection(page) {
    let connection = pages.get(page);
    if (!connection) {
        const url = new URL(page.url());
        const match = url.pathname.match(/^\/([A-Za-z0-9_-]+)\/com\.bowmansystems\.sp5\.core\.ServicePoint\/index\.html$/);
        if (!match) throw new TypeError('A Community Services application page is required');
        connection = resolveUiConnection({tenant: match[1], moduleBaseUrl: url.origin + url.pathname.slice(0, -'index.html'.length)});
        pages.set(page, connection);
    }
    return connection;
}

export function apiScope(api, ...adapters) {
    const tenant = validateTenant(api?.tenant);
    for (const adapter of adapters) {
        const adapterTenant = adapter?.connection?.tenant ?? adapter?.tenant;
        if (adapterTenant !== undefined && adapterTenant !== tenant) throw new TypeError('REST and UI tenants must match');
    }
    const base = (api.baseUrl ?? defaultApi).replace(/\/$/, '');
    // Preserve existing journals on the default deployment, including uncertain writes.
    return base === defaultApi ? tenant : JSON.stringify([base, tenant]);
}
