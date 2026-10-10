import {apiSearchParams, buildQuery, DEFAULT_FILTERS, MAX_RESULTS, PAGE_SIZE} from "./search.js";

export class GitHubError extends Error {
    constructor(message, status = 0) {
        super(message);
        this.name = "GitHubError";
        this.status = status;
    }
}

export function createGitHubClient({fetchImpl = globalThis.fetch, now = Date.now} = {}) {
    const cache = new Map();

    async function request(path, signal) {
        signal?.throwIfAborted();
        const saved = cache.get(path);
        if (saved && saved.expires > now()) return saved.data;

        const controller = new AbortController();
        const cancel = () => controller.abort(signal.reason);
        signal?.addEventListener("abort", cancel, {once: true});
        const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 15000);
        try {
            const response = await fetchImpl(`https://api.github.com${path}`, {
                headers: {Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
                credentials: "omit",
                signal: controller.signal,
            });
            if (!response.ok) {
                if (response.status === 403 || response.status === 429) {
                    const reset = Number(response.headers.get("x-ratelimit-reset"));
                    const retry = Number(response.headers.get("retry-after"));
                    const seconds = retry || (reset ? Math.max(0, reset - now() / 1000) : 0);
                    const wait = seconds ? `Try again in about ${Math.max(1, Math.ceil(seconds / 60))} minute(s).` : "Please try again later.";
                    throw new GitHubError(`GitHub is temporarily rate limiting requests. ${wait}`, response.status);
                }
                if (response.status === 404) throw new GitHubError("User not found.", 404);
                if (response.status === 422) throw new GitHubError("GitHub could not process this search. Shorten the keyword or adjust the filters.", 422);
                throw new GitHubError(`GitHub could not complete the request (${response.status}). Please try again later.`, response.status);
            }
            const data = await response.json();
            if (cache.size >= 100) cache.delete(cache.keys().next().value);
            cache.set(path, {data, expires: now() + (path.startsWith("/user/") ? 300000 : 60000)});
            return data;
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            if (controller.signal.reason?.name === "TimeoutError") throw new GitHubError("The connection to GitHub timed out. Check your connection and try again.");
            if (error instanceof GitHubError || error.name === "AbortError") throw error;
            throw new GitHubError("Could not connect to GitHub. Check your connection and try again.");
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", cancel);
        }
    }

    async function search(query, {page = 1, sort = "best", signal, perPage = PAGE_SIZE} = {}) {
        // GitHub exposes only the first 1,000 results, including a partial last page.
        const lastPage = Math.ceil(MAX_RESULTS / perPage);
        // Request the partial last page without crossing GitHub's 1,000-result cap.
        const partialSize = MAX_RESULTS % perPage;
        const finalPartialPage = partialSize && page === lastPage;
        const offset = (page - 1) * perPage;
        const exactSlice = finalPartialPage && offset % partialSize === 0;
        const requestSize = finalPartialPage ? (exactSlice ? partialSize : 100) : perPage;
        const requestPage = finalPartialPage ? (exactSlice ? offset / partialSize + 1 : 10) : page;
        const params = apiSearchParams({query, sort, perPage: requestSize, page: requestPage});
        const data = await request(`/search/users?${params}`, signal);
        if (finalPartialPage && !exactSlice) {
            return {...data, items: data.items.slice(offset - 900)};
        }
        return data;
    }

    async function lookupId(id, filters, signal) {
        if (!id) return null;
        let user;
        try {
            user = await request(`/user/${encodeURIComponent(id)}`, signal);
        } catch (error) {
            if (error.status === 404) return null;
            throw error;
        }
        if (filters.type === "user" && user.type !== "User") return null;
        if (filters.type === "org" && user.type !== "Organization") return null;

        // An exact ID match must also satisfy applied filters. Let GitHub evaluate
        // its location/language indexing rather than guessing from profile fields.
        const extraFilters = Object.keys(DEFAULT_FILTERS).some(key =>
            key !== "type" && filters[key] !== DEFAULT_FILTERS[key]);
        if (extraFilters) {
            const result = await search(buildQuery("", filters, user.login), {perPage: 1, signal});
            if (!result.items.some(item => item.id === user.id)) return null;
        }
        return user;
    }

    return {search, lookupId};
}
