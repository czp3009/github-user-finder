import assert from "node:assert/strict";
import test from "node:test";
import {
    apiSearchParams,
    buildQuery,
    DEFAULT_FILTERS,
    filterChips,
    hasSearchInput,
    numericId,
    pageCount,
    pageEntries,
    paginationPages,
    readSearchState,
    validateFilters,
    writeSearchState,
} from "../scripts/search.js";

test("form fields become literal qualifiers and inclusive ranges", () => {
    const filters = {
        ...DEFAULT_FILTERS, type: "user", location: "San Francisco", language: "C++",
        followersMin: "0", followersMax: "100", reposMax: "20",
        createdFrom: "2020-01-01", sponsorable: true,
    };
    const query = buildQuery("Nat Friedman", filters);
    assert.match(query, /^"Nat Friedman" in:login,name type:user/);
    assert.match(query, /location:"San Francisco" language:"C\+\+"/);
    assert.match(query, /followers:0\.\.100 repos:<=20 created:>=2020-01-01 is:sponsorable$/);
    assert.match(buildQuery("type:org", DEFAULT_FILTERS), /^"type:org" in:login,name$/);
});

test("ID insertion preserves ordinary results, duplicates, count and later pages", () => {
    const items = Array.from({length: 30}, (_, id) => ({id, login: `user${id}`}));
    const original = structuredClone(items);
    const idUser = items[5];
    const first = pageEntries(items, idUser, 1);
    assert.equal(first.length, 31);
    assert.deepEqual(first[0], {user: idUser, pinned: true});
    assert.deepEqual(first.slice(1).map(entry => entry.user), original);
    assert.equal(first.filter(entry => entry.user.id === 5).length, 2);
    assert.deepEqual(pageEntries(items, idUser, 2).map(entry => entry.user), original);
    assert.equal(pageEntries(items, null, 1).length, 30);
    assert.deepEqual(items, original);
    assert.equal(pageCount(30), 1);
    assert.equal(pageCount(31), 2);
    assert.equal(pageCount(5000), 34);
});

test("numeric IDs stay strings, including large values and leading zeroes", () => {
    assert.equal(numericId(" 000583231 "), "583231");
    assert.equal(numericId("99999999999999999999"), "99999999999999999999");
    assert.equal(numericId("0"), "0");
    for (const value of ["octocat", "-1", "1e3", "12.3", ""]) assert.equal(numericId(value), null);
});

test("empty default search is rejected but zero counts and filter-only searches work", () => {
    assert.equal(hasSearchInput("", DEFAULT_FILTERS), false);
    assert.equal(hasSearchInput("", {...DEFAULT_FILTERS, type: ""}), false);
    assert.equal(hasSearchInput("", {...DEFAULT_FILTERS, followersMax: "0"}), true);
    assert.equal(hasSearchInput("", {...DEFAULT_FILTERS, type: "org"}), true);
    assert.equal(hasSearchInput("", {...DEFAULT_FILTERS, type: "user"}), true);
    assert.equal(buildQuery("octocat", DEFAULT_FILTERS), "\"octocat\" in:login,name");
    assert.deepEqual(filterChips(DEFAULT_FILTERS), []);
    assert.equal(filterChips({...DEFAULT_FILTERS, type: "user"})[0].label, "Account: Personal accounts");
    assert.match(buildQuery("", {...DEFAULT_FILTERS, followersMax: "0"}), /followers:<=0/);
    assert.equal(filterChips({...DEFAULT_FILTERS, followersMin: "0"}).length, 1);
});

test("invalid numerical and date ranges cannot silently reach the API", () => {
    assert.match(validateFilters({...DEFAULT_FILTERS, followersMin: "10", followersMax: "2"}), /cannot exceed/);
    assert.match(validateFilters({...DEFAULT_FILTERS, reposMin: "-1"}), /integer/);
    assert.match(validateFilters({...DEFAULT_FILTERS, createdFrom: "2023-02-29"}), /valid/);
    assert.match(validateFilters({
        ...DEFAULT_FILTERS,
        createdFrom: "2024-03-01",
        createdTo: "2024-02-29"
    }), /cannot be later/);
    assert.equal(validateFilters({...DEFAULT_FILTERS, createdFrom: "2024-02-29"}), "");
});

test("GitHub-style parameters restore all form fields, sorting and pagination", () => {
    const state = {
        keyword: "Nat Friedman", filters: {
            ...DEFAULT_FILTERS, type: "", location: "Shanghai San Francisco", language: "C++",
            followersMin: "0", followersMax: "100", reposMin: "0", reposMax: "50",
            createdFrom: "2020-01-01", createdTo: "2024-12-31", sponsorable: true,
        },
        id: null, sort: "joined-asc", page: 3, perPage: 25,
    };
    state.query = buildQuery(state.keyword, state.filters);
    assert.deepEqual(readSearchState(writeSearchState(state)), state);
    const params = new URLSearchParams(writeSearchState(state));
    assert.equal(params.get("q"), state.query);
    assert.equal(params.get("sort"), "joined");
    assert.equal(params.get("order"), "asc");
    assert.equal(params.get("per_page"), "25");
    assert.equal(params.get("page"), "3");
    assert.deepEqual([...params.keys()], ["q", "sort", "order", "per_page", "page"]);
    assert.equal(readSearchState("?q=tom").filters.type, "");
    assert.equal(readSearchState("").filters.type, "");
});

test("the page URL and API use the same standard parameters, with a separate tool ID", () => {
    const state = {
        keyword: "583231", filters: {...DEFAULT_FILTERS}, id: "583231",
        query: buildQuery("583231", DEFAULT_FILTERS), sort: "followers-desc", page: 1, perPage: 30,
    };
    const params = new URLSearchParams(writeSearchState(state));
    assert.equal(params.get("id"), "583231");
    params.delete("id");
    assert.equal(params.toString(), apiSearchParams(state).toString());
    assert.deepEqual(readSearchState(writeSearchState(state)), state);
    assert.equal(readSearchState("?q=583231").id, null);
});

test("a raw GitHub query keeps its original meaning through URL serialization", () => {
    const query = "tom in:email followers:>42 created:<2020-01-01 is:sponsorable";
    const params = new URLSearchParams({q: query, sort: "followers", order: "asc", per_page: "100", page: "2"});
    const state = readSearchState(params.toString());
    assert.equal(state.query, query);
    assert.equal(state.sort, "followers-asc");
    assert.equal(state.perPage, 100);
    assert.equal(new URLSearchParams(writeSearchState(state)).get("q"), query);
});

test("unknown parameter names are ignored", () => {
    const state = readSearchState("?q=octocat&location=Shanghai&unused=value");
    assert.equal(state.filters.location, "");
    assert.equal(state.query, "octocat");
    const params = new URLSearchParams(writeSearchState(state));
    assert.equal(params.has("location"), false);
    assert.equal(params.has("unused"), false);
});

test("pagination stays bounded and includes the active page and both endpoints", () => {
    assert.deepEqual(paginationPages(1, 1), [1]);
    assert.deepEqual(paginationPages(1, 34), [1, 2, "...", 34]);
    assert.deepEqual(paginationPages(17, 34), [1, "...", 16, 17, 18, "...", 34]);
    assert.deepEqual(paginationPages(34, 34), [1, "...", 33, 34]);
});
