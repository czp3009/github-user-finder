export const PAGE_SIZE = 30;
export const MAX_RESULTS = 1000;
export const DEFAULT_FILTERS = Object.freeze({
    type: "",
    location: "",
    language: "",
    followersMin: "",
    followersMax: "",
    reposMin: "",
    reposMax: "",
    createdFrom: "",
    createdTo: "",
    sponsorable: false,
});

const RANGE_FIELDS = {
    followers: ["followersMin", "followersMax"],
    repos: ["reposMin", "reposMax"],
    created: ["createdFrom", "createdTo"],
};

// Treat form inputs as literal text, rather than asking people to learn search syntax.
function quote(value) {
    return `"${String(value).replace(/["\\]/g, " ").trim().replace(/\s+/g, " ")}"`;
}

function range(min, max) {
    if (min !== "" && max !== "") return `${min}..${max}`;
    if (min !== "") return `>=${min}`;
    if (max !== "") return `<=${max}`;
    return "";
}

export function buildQuery(keyword, filters, login = "") {
    const parts = [];
    if (login) parts.push(`user:${login}`);
    else if (keyword.trim()) parts.push(quote(keyword), "in:login,name");
    if (filters.type) parts.push(`type:${filters.type}`);
    if (filters.location) parts.push(`location:${quote(filters.location)}`);
    if (filters.language) parts.push(`language:${quote(filters.language)}`);
    for (const [qualifier, [minKey, maxKey]] of Object.entries(RANGE_FIELDS)) {
        const value = range(filters[minKey], filters[maxKey]);
        if (value) parts.push(`${qualifier}:${value}`);
    }
    if (filters.sponsorable) parts.push("is:sponsorable");
    return parts.join(" ");
}

export function numericId(keyword) {
    const text = keyword.trim();
    return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, "") : null;
}

export function validateFilters(filters) {
    for (const [name, minKey, maxKey] of [
        ["Follower count", "followersMin", "followersMax"],
        ["Repository count", "reposMin", "reposMax"],
    ]) {
        for (const key of [minKey, maxKey]) {
            if (filters[key] !== "" && (!/^\d+$/.test(filters[key]) || Number(filters[key]) > 999999999)) {
                return `${name} must be an integer between 0 and 999999999.`;
            }
        }
        if (filters[minKey] !== "" && filters[maxKey] !== "" && Number(filters[minKey]) > Number(filters[maxKey])) {
            return `${name}: the minimum cannot exceed the maximum.`;
        }
    }
    for (const key of ["createdFrom", "createdTo"]) {
        const value = filters[key];
        if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value ||
            value < "2007-01-01")) {
            return "Enter a valid join date (2007 or later).";
        }
    }
    if (filters.createdFrom && filters.createdTo && filters.createdFrom > filters.createdTo) {
        return "The start date cannot be later than the end date.";
    }
    return "";
}

export function filterChips(filters) {
    const chips = [];
    if (filters.type !== DEFAULT_FILTERS.type) {
        chips.push({
            label: `Account: ${filters.type === "org" ? "Organizations" : "Personal accounts"}`,
            keys: ["type"]
        });
    }
    if (filters.location) chips.push({label: `Location: ${filters.location}`, keys: ["location"]});
    if (filters.language) chips.push({label: `Language: ${filters.language}`, keys: ["language"]});
    for (const [label, minKey, maxKey] of [
        ["Followers", "followersMin", "followersMax"], ["Repositories", "reposMin", "reposMax"],
    ]) {
        const min = filters[minKey];
        const max = filters[maxKey];
        if (min !== "" || max !== "") {
            chips.push({
                label: `${label}: ${min !== "" && max !== "" ? `${min}-${max}` : min !== "" ? `>= ${min}` : `<= ${max}`}`,
                keys: [minKey, maxKey]
            });
        }
    }
    const from = filters.createdFrom;
    const to = filters.createdTo;
    if (from || to) {
        chips.push({
            label: `Joined: ${from && to ? `${from} to ${to}` : from ? `${from} onward` : `${to} or earlier`}`,
            keys: ["createdFrom", "createdTo"]
        });
    }
    if (filters.sponsorable) chips.push({label: "Sponsorable", keys: ["sponsorable"]});
    return chips;
}

export function hasSearchInput(keyword, filters) {
    return Boolean(keyword.trim() || (filterChips(filters).length && buildQuery("", filters)));
}

// The extra ID card never changes the API page size, order, count, or duplicates.
export function pageEntries(items, idUser, page) {
    const entries = items.map(user => ({user, pinned: false}));
    if (page === 1 && idUser) entries.unshift({user: idUser, pinned: true});
    return entries;
}

export function pageCount(totalCount, perPage = PAGE_SIZE) {
    return Math.ceil(Math.min(totalCount, MAX_RESULTS) / perPage);
}

export function paginationPages(current, total) {
    const pages = [...new Set([1, current - 1, current, current + 1, total])]
        .filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
    const result = [];
    for (const page of pages) {
        const previous = result.at(-1);
        if (typeof previous === "number" && page - previous === 2) result.push(previous + 1);
        else if (typeof previous === "number" && page - previous > 2) result.push("...");
        result.push(page);
    }
    return result;
}

// Decode the qualifiers produced by our form. Keep the original q separately,
// so opening a URL never changes GitHub's query semantics or unknown qualifiers.
export function parseQuery(query) {
    const filters = {...DEFAULT_FILTERS};
    const keywords = [];
    const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const unquote = value => value.replace(/^"|"$/g, "");
    for (const token of tokens) {
        if (token.startsWith("\"") || !token.includes(":")) {
            keywords.push(unquote(token));
            continue;
        }
        const separator = token.indexOf(":");
        const key = token.slice(0, separator);
        const value = unquote(token.slice(separator + 1));
        if (key === "type") filters.type = value;
        else if (key === "location" || key === "language") filters[key] = value;
        else if (key === "is" && value === "sponsorable") filters.sponsorable = true;
        else if (Object.hasOwn(RANGE_FIELDS, key)) {
            const [minKey, maxKey] = RANGE_FIELDS[key];
            if (value.includes("..")) [filters[minKey], filters[maxKey]] = value.split("..");
            else if (value.startsWith(">=")) filters[minKey] = value.slice(2);
            else if (value.startsWith("<=")) filters[maxKey] = value.slice(2);
            else if (!/^[<>]/.test(value)) filters[minKey] = filters[maxKey] = value;
        }
    }
    return {keyword: keywords.join(" "), filters};
}

export function readSearchState(search) {
    const params = new URLSearchParams(search);
    const query = params.get("q") || "";
    const parsed = parseQuery(query);
    const id = params.get("id");
    const sortField = params.get("sort");
    const order = params.get("order") ?? "desc";
    const sort = sortField === null ? "best" : `${sortField}-${order}`;
    const perPage = Number(params.get("per_page") ?? PAGE_SIZE);
    const page = Number(params.get("page") ?? 1);
    const keyword = query ? parsed.keyword : id || "";
    return {keyword, filters: parsed.filters, query, id, sort, page, perPage};
}

export function apiSearchParams({query, sort = "best", page = 1, perPage = PAGE_SIZE}) {
    const params = new URLSearchParams();
    if (query) {
        params.set("q", query);
        if (sort !== "best") {
            const [field, order] = sort.split("-");
            params.set("sort", field);
            params.set("order", order);
        }
        params.set("per_page", String(perPage));
        params.set("page", String(page));
    }
    return params;
}

export function writeSearchState(state) {
    const query = state.query || (hasSearchInput(state.keyword, state.filters) ? buildQuery(state.keyword, state.filters) : "");
    const params = apiSearchParams({...state, query});
    if (state.id) params.set("id", state.id);
    return params.toString();
}
