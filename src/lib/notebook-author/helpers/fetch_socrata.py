"""Helper: fetch_socrata — SoQL queries against any Socrata Open Data portal.

Embedded inline in cell-3 of executed civic-ai-tools notebooks (ADR-0005 §3).
Self-contained: only requires `requests` and `pandas` (pinned in the notebook
environment). When a portal honors `X-App-Token`, the caller may pass one;
unauthenticated calls work but are rate-limited.
"""
import os
import requests
import pandas as pd


def fetch_socrata(
    portal: str,
    dataset_id: str,
    *,
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
        portal: Hostname of the Socrata portal (e.g. `data.cityofnewyork.us`).
        dataset_id: Dataset identifier (the 4x4 slug, e.g. `erm2-nwe9`).
        select, where, group, order, limit, offset: SoQL clauses. Strings.
        app_token: Optional Socrata app token; falls back to env
            `SOCRATA_APP_TOKEN`. Anonymous access works but is throttled.
        timeout_s: Per-request timeout in seconds.

    Returns:
        A pandas DataFrame; one row per record returned by the portal.
    """
    url = f"https://{portal}/resource/{dataset_id}.json"
    params: dict[str, str] = {}
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
