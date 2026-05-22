"""Helper: fetch_opencontext — Boston CKAN DataStore queries.

Embedded inline in cell-3 of executed civic-ai-tools notebooks (ADR-0005 §3).
Wraps the CKAN DataStore API at `https://data.boston.gov/api/3/action/`.
Two query modes: `datastore_search` (simple field equality + pagination)
and `datastore_search_sql` (raw SELECT; double-quote the resource UUID in
the FROM clause).
"""
import json
import requests
import pandas as pd


def fetch_opencontext(
    resource_id: str | None = None,
    *,
    filters: dict | None = None,
    sql: str | None = None,
    limit: int = 1000,
    timeout_s: int = 60,
) -> pd.DataFrame:
    """Fetch rows from Boston's CKAN DataStore; return a tidy DataFrame.

    Use ONE of two modes:
      1. Equality filter mode: pass `resource_id` and (optionally) `filters`,
         a dict of `{field_name: value}`. Server applies WHERE field = value
         AND ... server-side. `limit` caps row count.
      2. SQL mode: pass `sql` containing a raw SELECT. The CKAN DataStore
         requires the resource UUID to be double-quoted in the FROM clause,
         e.g. `SELECT * FROM "8048697b-ad64-4bfc-b090-ee00169f2323" LIMIT 5`.
         Only SELECT is permitted server-side.

    Args:
        resource_id: CKAN resource UUID (required unless using `sql`).
        filters: Optional field-equality filters as `{field: value, ...}`.
        sql: Optional raw SELECT. Mutually exclusive with `filters`/`limit`.
        limit: Max rows for equality-filter mode (default 1000).
        timeout_s: Per-request timeout in seconds.

    Returns:
        DataFrame with one row per record; column names match CKAN field names.
    """
    if sql:
        url = "https://data.boston.gov/api/3/action/datastore_search_sql"
        params = {"sql": sql}
    elif resource_id:
        url = "https://data.boston.gov/api/3/action/datastore_search"
        params = {"resource_id": resource_id, "limit": str(limit)}
        if filters:
            params["filters"] = json.dumps(filters)
    else:
        raise ValueError("fetch_opencontext requires either resource_id or sql")
    response = requests.get(url, params=params, timeout=timeout_s)
    response.raise_for_status()
    body = response.json()
    if not body.get("success"):
        raise RuntimeError(f"OpenContext CKAN error: {body.get('error')}")
    records = body.get("result", {}).get("records") or []
    return pd.DataFrame(records)
