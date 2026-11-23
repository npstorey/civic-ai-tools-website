"""Helper: fetch_ckan — CKAN DataStore queries against the portal a call named.

Embedded inline in cell-3 of executed civic-ai-tools notebooks (ADR-0005 §3).
Re-runs a call of the hosted CKAN server's two datastore tools (router 0.12.0)
against the `server_url` that call carried, through the portal's own CKAN
action API (`<server_url>/api/3/action/`). Two query modes:
`datastore_search` (a resource's records, with the arguments the server sends
the same action) and `datastore_search_sql` (one SELECT or WITH statement;
the resource id is double-quoted in the FROM clause).
"""
import json
import requests
import pandas as pd


def fetch_ckan(
    server_url: str,
    resource_id: str | None = None,
    *,
    q: str | dict | None = None,
    filters: dict | None = None,
    limit: int = 100,
    offset: int = 0,
    fields: list | None = None,
    sort: str | None = None,
    distinct: bool = False,
    sql: str | None = None,
    timeout_s: int = 60,
) -> pd.DataFrame:
    """Fetch rows from a CKAN portal's DataStore; return a tidy DataFrame.

    Use ONE of two modes:
      1. Resource mode: pass `resource_id` and the call's other arguments.
         They are sent as the server sends them: `limit`, `offset` and
         `distinct` always (defaults 100, 0 and false, the server's), `q` and
         `sort` when non-empty (a dict `q` as compact JSON), and `filters` (as
         JSON) and `fields` (joined with commas) when given.
      2. SQL mode: pass `sql`, one SELECT or WITH statement.

    Args:
        server_url: The portal's address, as the original call named it.
        resource_id: CKAN resource id (required unless using `sql`).
        q: Optional full-text search. A string searches all fields; a dict
            such as `{"column": "word"}` searches only the columns it names.
        filters: Optional field-equality filters as `{field: value, ...}`.
        limit: Max rows in resource mode (default 100; 0 returns no rows).
        offset: Rows to skip in resource mode (default 0).
        fields: Optional field names to return.
        sort: Optional sort expression, such as "field desc".
        distinct: Return only distinct rows (default False).
        sql: Optional SELECT or WITH statement. Mutually exclusive with the
            resource-mode arguments.
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
        params = {
            "resource_id": resource_id,
            "limit": str(limit),
            "offset": str(offset),
            "distinct": "true" if distinct else "false",
        }
        if isinstance(q, dict):
            # Compact JSON, keys in the call's order and non-ASCII unescaped:
            # the server's JSON.stringify, byte for byte.
            if q:
                params["q"] = json.dumps(q, separators=(",", ":"), ensure_ascii=False)
        elif q:
            params["q"] = q
        if filters is not None:
            params["filters"] = json.dumps(filters, separators=(",", ":"))
        if fields is not None:
            params["fields"] = ",".join(fields)
        if sort:
            params["sort"] = sort
    else:
        raise ValueError("fetch_ckan requires either resource_id or sql")
    response = requests.get(url, params=params, timeout=timeout_s)
    response.raise_for_status()
    body = response.json()
    if not body.get("success"):
        raise RuntimeError(f"CKAN error: {body.get('error')}")
    records = body.get("result", {}).get("records") or []
    return pd.DataFrame(records)
