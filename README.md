# GitHub User Finder

A lightweight tool for finding public GitHub users by username, display name, numeric ID, and profile filters.

## Usage

- Enter a username, display name, or numeric ID and click **Search**.
- Open **Advanced search** to filter by account type, location, repository language, follower count, repository count,
  join date, or sponsorship availability.
- Filters default to no restriction. Account type defaults to **All accounts**, including both personal accounts and
  organizations.
- Click **Search** in the dialog to apply filters. Closing or canceling the dialog discards unsubmitted changes. Applied
  filters remain active until removed.
- Change the sort order or use pagination to browse results. Click a result to open its GitHub profile.
- Numeric ID matches appear first on page one as an extra result. They do not replace, reorder, or remove ordinary
  search results, and must satisfy the applied filters.
- Copy the URL to share a search. Refreshing the page restores the same filters, sorting, and page, then runs the search
  again.

Search URLs use GitHub API parameters: `q`, `sort`, `order`, `per_page`, and `page`. The additional `id` parameter
enables exact ID lookup. The form generates these parameters for you.

No sign-in is required. Searches use GitHub's public API and are subject to its rate limits. GitHub provides only the
first 1,000 results for each search.

## Run locally

Run this command in the project directory:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000>. Use an HTTP server instead of opening the HTML file directly.

## Host on GitHub Pages

In the repository's **Settings > Pages**, select **Deploy from a branch**, choose the branch and **/ (root)** directory,
then save. No build step is required.
