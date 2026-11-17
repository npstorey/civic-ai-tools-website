"""Helper: fetch_ckan — CKAN DataStore queries against the portal a call named.

Embedded inline in cell-3 of executed civic-ai-tools notebooks (ADR-0005 §3).
Re-runs a CKAN pack's datastore call (router 0.11.0, CKAN-1 P3) against the
`server_url` that call carried, through the portal's own CKAN action API
(`<server_url>/api/3/action/`). Two query modes: `datastore_search` (a
resource's records, with optional field-equality filters) and
`datastore_search_sql` (one SELECT or WITH statement; the resource id
is double-quoted in the FROM clause).
"""
import json
import requests
import pandas as pd


def fetch_ckan(
    server_url: str,
    resource_id: str | None = None,
    *,
    filters: dict | None = None,
    sql: str | None = None,
    limit: int = 1000,
    timeout_s: int = 60,
) -> pd.DataFrame:
    """Fetch rows from a CKAN portal's DataStore; return a tidy DataFrame.

    Use ONE of two modes:
      1. Resource mode: pass `resource_id` and (optionally) `filters`, a dict
         of `{field_name: value}`. `limit` caps row count.
      2. SQL mode: pass `sql`, one SELECT or WITH statement.

    Args:
        server_url: The portal's address, as the original call named it.
        resource_id: CKAN resource id (required unless using `sql`).
        filters: Optional field-equality filters as `{field: value, ...}`.
        sql: Optional SELECT or WITH statement. Mutually exclusive with `filters`/`limit`.
        limit: Max rows in resource mode (default 1000).
        timeout_s: Per-request timeout in seconds.

    Returns:
        DataFrame with one row per record; column names match CKAN field names.
    """
    base = server_url.rstrip("/") + "/api/3/action/"
    if sql:
        url = base + "datastore_search_sql"
        params = {"sql": sql}
    elif resource_id:
        url = base + "datastore_search"
        params = {"resource_id": resource_id, "limit": str(limit)}
        if filters:
            params["filters"] = json.dumps(filters)
    else:
        raise ValueError("fetch_ckan requires either resource_id or sql")
    response = requests.get(url, params=params, timeout=timeout_s)
    response.raise_for_status()
    body = response.json()
    if not body.get("success"):
        raise RuntimeError(f"CKAN error: {body.get('error')}")
    records = body.get("result", {}).get("records") or []
    return pd.DataFrame(records)
