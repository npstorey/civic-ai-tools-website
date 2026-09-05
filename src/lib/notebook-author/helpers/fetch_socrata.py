"""Helper: fetch_socrata — SoQL queries against any Socrata Open Data portal.

Embedded inline in cell-3 of executed civic-ai-tools notebooks (ADR-0005 §3).
Self-contained: only requires `requests` and `pandas` (pinned in the notebook
environment). When a portal honors `X-App-Token`, the caller may pass one;
unauthenticated calls work but are rate-limited.

`query` mirrors the data-access service the original analysis ran through, so
a cell generated from that analysis reproduces what actually happened:

  * A full SoQL statement (one that starts with SELECT) is sent as the whole
    query. `select` / `where` / `group` / `order` — and `limit` / `offset` —
    are then NOT sent, exactly as the service does not send them. The number
    of rows you get back is whatever the statement's own LIMIT allows, or the
    portal's default page size when it carries none.
  * Anything else is a search phrase, sent as a full-text search across the
    dataset, with every other clause applied alongside it.

One deliberate difference from the service: this helper always requires an
explicit `dataset_id` and never derives one from `query`. See
`SocrataDatasetIdRequired`.
"""
# Type hints are not evaluated at import time, so this helper also loads on
# interpreters older than the 3.13 the notebook pins.
from __future__ import annotations

import os
import re
import requests
import pandas as pd


class SocrataDatasetIdRequired(ValueError):
    """Raised when `fetch_socrata` is called without an explicit dataset_id.

    The data-access service this helper mirrors will, for a `query` that is
    NOT a full SoQL statement, fall back to treating the query string itself
    as the dataset id. This helper deliberately does not: a dataset id
    inferred from a search phrase is a guess, and a notebook that guesses
    which dataset it read is not reproducing the analysis it claims to
    reproduce. Pass `dataset_id` explicitly.
    """


def _is_full_soql_query(query: str) -> bool:
    """True when `query` is a full SoQL statement rather than a search phrase.

    Mirrors the sniff the data-access service applies to the same field. Kept
    as one named function so a reader re-running this cell with different
    arguments can see which branch their own `query` takes.
    """
    return re.match(r"^\s*select", query, re.IGNORECASE) is not None


def fetch_socrata(
    portal: str,
    dataset_id: str | None = None,
    *,
    query: str | None = None,
    select: str | None = None,
    where: str | None = None,
    group: str | None = None,
    order: str | None = None,
    limit: int | None = 1000,
    offset: int | None = None,
    app_token: str | None = None,
    timeout_s: int = 60,
) -> pd.DataFrame:
    """Run a SoQL query against `https://<portal>/resource/<dataset_id>.json`.

    Args:
        portal: Bare hostname of the Socrata portal — the `<portal>` of the
            URL above, with no scheme and no trailing path.
        dataset_id: Dataset identifier (the 4x4 slug, e.g. `erm2-nwe9`).
            Required: never inferred from `query`.
        query: Either a full SoQL statement (starting with SELECT), which is
            sent as the whole query and supersedes `select`, `where`, `group`,
            `order`, `limit` and `offset`; or a search phrase, run as a
            full-text search across the dataset alongside the other clauses.
        select, where, group, order, limit, offset: SoQL clauses. Strings.
        app_token: Optional Socrata app token; falls back to env
            `SOCRATA_APP_TOKEN`. Anonymous access works but is throttled.
        timeout_s: Per-request timeout in seconds.

    Returns:
        A pandas DataFrame; one row per record returned by the portal.

    Raises:
        SocrataDatasetIdRequired: when `dataset_id` is missing or empty.
    """
    if not dataset_id:
        raise SocrataDatasetIdRequired(
            "fetch_socrata requires an explicit dataset_id; it is never "
            "inferred from the query field."
        )
    url = f"https://{portal}/resource/{dataset_id}.json"
    params: dict[str, str] = {}
    if query is not None and _is_full_soql_query(query):
        # The full statement IS the query: no $select/$where/$group/$order and
        # no $limit/$offset travel with it, so nothing here silently narrows
        # what the statement asked for.
        params["$query"] = query
    else:
        if query is not None:
            params["$q"] = query
        if select is not None:
            params["$select"] = select
        if where is not None:
            params["$where"] = where
        if group is not None:
            params["$group"] = group
        if order is not None:
            params["$order"] = order
        if limit is not None:
            params["$limit"] = str(limit)
        if offset is not None:
            params["$offset"] = str(offset)
    headers: dict[str, str] = {}
    token = app_token or os.environ.get("SOCRATA_APP_TOKEN")
    if token:
        headers["X-App-Token"] = token
    response = requests.get(url, params=params, headers=headers, timeout=timeout_s)
    response.raise_for_status()
    return pd.DataFrame(response.json())
