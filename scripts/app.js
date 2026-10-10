import {createGitHubClient} from "./api.js";
import {
  buildQuery,
  DEFAULT_FILTERS,
  filterChips,
  hasSearchInput,
  MAX_RESULTS,
  numericId,
  pageCount,
  pageEntries,
  paginationPages,
  readSearchState,
  validateFilters,
  writeSearchState,
} from "./search.js";

const $ = id => document.getElementById(id);
const client = createGitHubClient();
let state = readSearchState(location.search);
let currentRequest;
let requestNumber = 0;
let hasResults = false;
let retrySearch = false;

function applyConditions(keyword, filters = state.filters) {
    keyword = keyword.trim();
    const unchanged = keyword === state.keyword && JSON.stringify(filters) === JSON.stringify(state.filters);
    state = {
        ...state, keyword, filters: {...filters}, page: 1,
        query: unchanged && state.query ? state.query : hasSearchInput(keyword, filters) ? buildQuery(keyword, filters) : "",
        id: numericId(keyword),
    };
}

function canSearch() {
    return Boolean(state.query || state.id || hasSearchInput(state.keyword, state.filters));
}

function commitSearch() {
    syncSearchControls();
    updateUrl();
    if (canSearch()) runSearch();
    else resetResults();
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.append(use);
    return svg;
}

function syncSearchControls() {
    $("keyword").value = state.keyword;
    $("sort").value = state.sort;
    $("clear-keyword").hidden = !state.keyword;
    renderFilters();
}

function updateUrl() {
    const query = writeSearchState(state);
    const url = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
    if (`${location.pathname}${location.search}${location.hash}` === url) return;
    history.pushState(null, "", url);
}

function renderFilters() {
    const chips = filterChips(state.filters);
    const container = $("active-filters");
    container.replaceChildren();
    container.hidden = !chips.length;
    $("open-filters").classList.toggle("is-active", Boolean(chips.length));
    $("filter-count").hidden = !chips.length;
    $("filter-count").textContent = chips.length;
    $("open-filters").setAttribute("aria-label", chips.length ? `Advanced search, ${chips.length} active filters` : "Advanced search");
    $("search-suggestions").hidden = hasResults || Boolean(chips.length);
    for (const chip of chips) {
        const button = element("button", "filter-chip", chip.label);
        button.type = "button";
        button.append(icon("close"));
        button.setAttribute("aria-label", `Remove filter: ${chip.label}`);
        button.addEventListener("click", () => {
            const filters = {...state.filters};
            for (const key of chip.keys) filters[key] = DEFAULT_FILTERS[key];
            applyConditions($("keyword").value, filters);
            commitSearch();
            $("open-filters").focus();
        });
        container.append(button);
    }
    const clear = element("button", "clear-filters", "Clear filters");
    clear.type = "button";
    clear.addEventListener("click", () => {
        applyConditions($("keyword").value, DEFAULT_FILTERS);
        commitSearch();
        $("open-filters").focus();
    });
    container.append(clear);
}

function fillAdvancedForm(keyword, filters) {
    const form = $("advanced-form");
    form.elements.keyword.value = keyword;
    for (const [key, value] of Object.entries(filters)) {
        if (key === "sponsorable") form.elements[key].checked = value;
        else form.elements[key].value = value;
    }
    $("advanced-error").hidden = true;
}

function openAdvanced() {
    // Edits live only inside the form until the user presses Search.
    fillAdvancedForm($("keyword").value, state.filters);
    $("advanced-dialog").showModal();
}

function closeAdvanced() {
    $("advanced-dialog").close();
}

function readAdvancedForm() {
    const form = $("advanced-form");
    const filters = {};
    for (const key of Object.keys(DEFAULT_FILTERS)) {
        filters[key] = key === "sponsorable" ? form.elements[key].checked : form.elements[key].value.trim();
    }
    return {keyword: form.elements.keyword.value.trim(), filters};
}

function showNotice(message, isError = false) {
    $("notice").textContent = message;
    $("notice").hidden = !message;
    $("notice").classList.toggle("is-error", isError);
}

function showEmpty(title, description, action = "Open advanced search", retry = false) {
    $("empty-state").hidden = false;
    $("empty-title").textContent = title;
    $("empty-description").textContent = description;
    $("empty-action").firstChild.textContent = `${action} `;
    retrySearch = retry;
}

function resetResults() {
    currentRequest?.abort();
    requestNumber++;
    hasResults = false;
    $("results-list").replaceChildren();
    $("results-list").removeAttribute("aria-busy");
    $("results-toolbar").hidden = true;
    $("pagination").hidden = true;
    showNotice("");
    showEmpty("Your next discovery starts here", "Find a familiar name, or someone who shares your interests.");
    renderFilters();
    $("result-status").textContent = "";
}

function userCard({user, pinned}) {
    const card = element("a", `user-card${pinned ? " is-pinned" : ""}`);
    card.href = `https://github.com/${encodeURIComponent(user.login)}`;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.setAttribute("aria-label", `${user.login}, ID ${user.id}${pinned ? ", exact ID match" : ""}, open GitHub profile in a new tab`);
    const avatar = element("img", "user-avatar");
    const avatarUrl = new URL(user.avatar_url);
    if (avatarUrl.protocol === "https:") {
        avatarUrl.searchParams.set("s", "96");
        avatar.src = avatarUrl.href;
    }
    avatar.alt = "";
    avatar.width = 44;
    avatar.height = 44;
    avatar.loading = "lazy";
    avatar.decoding = "async";
    avatar.addEventListener("error", () => avatar.removeAttribute("src"), {once: true});
    const info = element("div", "user-info");
    const login = element("span", "user-login", user.login);
    login.title = user.login;
    const meta = element("span", "user-meta");
    meta.append(element("span", "", `ID ${user.id}`));
    meta.append(element("span", pinned ? "id-badge" : "", pinned ? "Exact ID match" : user.type === "Organization" ? "Organizations" : "User"));
    info.append(login, meta);
    card.append(avatar, info, icon("external"));
    return card;
}

function renderPagination(totalCount) {
    const nav = $("pagination");
    nav.replaceChildren();
    const total = pageCount(totalCount, state.perPage);
    nav.hidden = total <= 1;
    if (total <= 1) return;

    function pageButton(page, label, className = "") {
        const button = element("button", `page-button ${className}`, label);
        button.type = "button";
        button.disabled = page < 1 || page > total;
        button.setAttribute("aria-label", className === "previous" ? "Previous page" : className === "next" ? "Next page" : `Page ${page}`);
        if (className) button.replaceChildren(icon("arrow"));
        if (page === state.page && !className) button.setAttribute("aria-current", "page");
        button.addEventListener("click", () => {
            if (page === state.page) return;
            state.page = page;
            updateUrl();
            runSearch(true);
        });
        return button;
    }

    nav.append(pageButton(state.page - 1, "", "previous"));
    for (const page of paginationPages(state.page, total)) {
        nav.append(page === "..." ? element("span", "page-gap", "...") : pageButton(page, String(page)));
    }
    nav.append(pageButton(state.page + 1, "", "next"));
}

async function runSearch(scroll = false) {
    if (!canSearch()) {
        resetResults();
        showNotice("Enter a name or numeric ID, or add a filter.");
        $("keyword").focus();
        return;
    }

    currentRequest?.abort();
    const controller = new AbortController();
    currentRequest = controller;
    const number = ++requestNumber;
    const snapshot = {...state, filters: {...state.filters}};
    hasResults = true;
    renderFilters();
    $("results-toolbar").hidden = false;
    $("result-count").textContent = "Searching";
    $("result-description").textContent = "Finding matching users...";
    $("empty-state").hidden = true;
    $("pagination").hidden = true;
    showNotice("");
    $("result-status").textContent = "Searching GitHub users";
    const list = $("results-list");
    list.setAttribute("aria-busy", "true");
    list.replaceChildren(...Array.from({length: 6}, () => {
        const skeleton = element("div", "skeleton");
        skeleton.setAttribute("aria-hidden", "true");
        return skeleton;
    }));
    if (scroll) $("results-section").scrollIntoView({behavior: "auto", block: "start"});

    const [searchResult, idResult] = await Promise.allSettled([
        client.search(snapshot.query || buildQuery(snapshot.keyword, snapshot.filters), {
            page: snapshot.page, sort: snapshot.sort, perPage: snapshot.perPage, signal: controller.signal,
        }),
        snapshot.page === 1
            ? client.lookupId(snapshot.id || "", snapshot.filters, controller.signal)
            : Promise.resolve(null),
    ]);
    if (number !== requestNumber || controller.signal.aborted) return;

    const notices = [];
    const searchOk = searchResult.status === "fulfilled";
    const data = searchOk ? searchResult.value : {items: [], total_count: 0};
    const idUser = idResult.status === "fulfilled" ? idResult.value : null;

    const entries = pageEntries(data.items, idUser, snapshot.page);
    list.replaceChildren(...entries.map(userCard));
    list.removeAttribute("aria-busy");
    $("result-count").textContent = searchOk ? data.total_count.toLocaleString("en-US") : "Unavailable";
    let description = searchOk ? `Page ${snapshot.page} / ${data.items.length} search results` : "Name search could not be completed";
    if (idUser) description += " / 1 extra exact ID match";
    else if (snapshot.page === 1 && snapshot.id && idResult.status === "fulfilled") {
        description += " / No exact ID match for these filters";
    }
    $("result-description").textContent = description;
    if (!searchOk) notices.push(searchResult.reason.message);
    if (idResult.status === "rejected") notices.push(`Exact ID lookup could not be completed: ${idResult.reason.message}`);
    if (data.incomplete_results) notices.push("GitHub returned potentially incomplete results. Add filters and try again.");
    if (data.total_count > MAX_RESULTS) notices.push("GitHub provides only the first 1,000 search results. Add filters to narrow your search.");
    showNotice(notices.join(" "), !searchOk);
    if (searchOk) renderPagination(data.total_count);
    if (!entries.length) {
        if (searchOk) showEmpty("No matching users found", "Try another keyword or remove a few filters.", "Adjust filters");
        else showEmpty("Search could not be completed", "Check your connection or try again in a moment.", "Try again", true);
    }
    $("result-status").textContent = searchOk
        ? `Found ${data.total_count} search results. Page ${snapshot.page} shows ${entries.length} users${idUser ? ", including one exact ID match" : ""}.`
        : "Search could not be completed. See the error message.";
}

$("search-form").addEventListener("submit", event => {
    event.preventDefault();
    applyConditions($("keyword").value);
    commitSearch();
});
$("keyword").addEventListener("input", () => {
    $("clear-keyword").hidden = !$("keyword").value;
});
$("clear-keyword").addEventListener("click", () => {
    $("keyword").value = "";
    $("clear-keyword").hidden = true;
    $("keyword").focus();
});
$("open-filters").addEventListener("click", openAdvanced);
$("close-filters").addEventListener("click", closeAdvanced);
$("cancel-filters").addEventListener("click", closeAdvanced);
$("empty-action").addEventListener("click", () => retrySearch ? runSearch() : openAdvanced());
$("reset-filters").addEventListener("click", () => fillAdvancedForm("", DEFAULT_FILTERS));
$("advanced-form").addEventListener("submit", event => {
    event.preventDefault();
    const draft = readAdvancedForm();
    const error = validateFilters(draft.filters);
    if (error || !hasSearchInput(draft.keyword, draft.filters)) {
        $("advanced-error").textContent = error || "Enter a name or numeric ID, or select at least one filter.";
        $("advanced-error").hidden = false;
        return;
    }
    applyConditions(draft.keyword, draft.filters);
    closeAdvanced();
    commitSearch();
});
// Clicks that begin and end on the backdrop dismiss the unsubmitted draft.
let backdropPointerDown = false;
$("advanced-dialog").addEventListener("pointerdown", event => {
    backdropPointerDown = event.target === $("advanced-dialog");
});
$("advanced-dialog").addEventListener("click", event => {
    if (backdropPointerDown && event.target === $("advanced-dialog")) closeAdvanced();
    backdropPointerDown = false;
});
$("sort").addEventListener("change", () => {
    state.sort = $("sort").value;
    state.page = 1;
    updateUrl();
    runSearch();
});
document.querySelectorAll("[data-example]").forEach(button => {
    button.addEventListener("click", () => {
        const filters = {...DEFAULT_FILTERS};
        const keyword = button.dataset.example === "developers" ? "" : button.dataset.example;
        if (button.dataset.example === "developers") {
            filters.location = "Shanghai";
            filters.language = "JavaScript";
        }
        applyConditions(keyword, filters);
        state.sort = "best";
        commitSearch();
    });
});
window.addEventListener("popstate", () => {
    state = readSearchState(location.search);
    syncSearchControls();
    if (canSearch()) runSearch();
    else resetResults();
});

syncSearchControls();
if (canSearch()) runSearch();
