import assert from "node:assert/strict";
import test from "node:test";
import {createGitHubClient} from "../scripts/api.js";
import {DEFAULT_FILTERS} from "../scripts/search.js";

const user = {login: "octocat", id: 583231, type: "User"};
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers});

test("a missing ID is independent from a successful name search", async () => {
    const client = createGitHubClient({
        fetchImpl: async url => url.includes("/user/")
            ? json({}, 404) : json({total_count: 1, items: [user]})
    });
    const [search, id] = await Promise.all([
        client.search("\"583231\" in:login,name type:user"),
        client.lookupId("583231", DEFAULT_FILTERS),
    ]);
    assert.equal(search.items.length, 1);
    assert.equal(id, null);
});

test("revisiting page one reuses cached ID and search results; entries expire", async () => {
    let clock = 0;
    const calls = [];
    const client = createGitHubClient({
        now: () => clock, fetchImpl: async (url, options) => {
            calls.push(url);
            assert.equal(options.credentials, "omit");
            assert.equal(options.headers.Authorization, undefined);
            return json(url.includes("/user/") ? user : {total_count: 60, items: [user]});
        }
    });
    await client.lookupId("583231", DEFAULT_FILTERS);
    await client.lookupId("583231", DEFAULT_FILTERS);
    await client.search("query");
    await client.search("query");
    await client.search("query", {page: 2});
    assert.equal(calls.length, 3);
    clock = 61000;
    await client.search("query");
    await client.lookupId("583231", DEFAULT_FILTERS);
    assert.equal(calls.length, 4);
    clock = 301000;
    await client.lookupId("583231", DEFAULT_FILTERS);
    assert.equal(calls.length, 5);
});

test("an exact ID does not bypass account type or advanced filters", async () => {
    const queries = [];
    const client = createGitHubClient({
        fetchImpl: async url => {
            if (url.includes("/user/")) return json(user);
            queries.push(new URL(url).searchParams.get("q"));
            return json({total_count: 0, items: []});
        }
    });
    assert.equal(await client.lookupId("583231", {...DEFAULT_FILTERS, type: "org"}), null);
    assert.equal(queries.length, 0);
    assert.equal(await client.lookupId("583231", {...DEFAULT_FILTERS, location: "Shanghai"}), null);
    assert.equal(queries[0], "user:octocat location:\"Shanghai\"");
    assert.equal(await client.lookupId("", DEFAULT_FILTERS), null);
});

test("the partial last page requests results 991-1000 without crossing the cap", async () => {
    const urls = [];
    const client = createGitHubClient({
        fetchImpl: async url => {
            urls.push(new URL(url));
            return json({total_count: 5000, items: []});
        }
    });
    await client.search("query", {page: 33, sort: "followers-desc"});
    await client.search("query", {page: 34, sort: "followers-desc"});
    assert.equal(urls[0].searchParams.get("page"), "33");
    assert.equal(urls[0].searchParams.get("per_page"), "30");
    assert.equal(urls[1].searchParams.get("page"), "100");
    assert.equal(urls[1].searchParams.get("per_page"), "10");
    assert.equal(urls[1].searchParams.get("sort"), "followers");
});

test("rate limits and network failures are visible, and failed requests are not cached", async () => {
    let count = 0;
    const client = createGitHubClient({
        now: () => 0, fetchImpl: async () => {
            count++;
            return count === 1 ? json({}, 429, {"retry-after": "120"}) : json({items: [], total_count: 0});
        }
    });
    await assert.rejects(client.search("query"), /about 2 minute/);
    await client.search("query");
    assert.equal(count, 2);
    const offline = createGitHubClient({
        fetchImpl: async () => {
            throw new TypeError("Failed to fetch");
        }
    });
    await assert.rejects(offline.search("query"), /Could not connect to GitHub/);
});

test("aborting an old search cancels its request instead of turning it into a network error", async () => {
    const client = createGitHubClient({
        fetchImpl: async (url, {signal}) => new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {once: true});
        })
    });
    const controller = new AbortController();
    const pending = client.search("query", {signal: controller.signal});
    controller.abort();
    await assert.rejects(pending, {name: "AbortError"});
});
