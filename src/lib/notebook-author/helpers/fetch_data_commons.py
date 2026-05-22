"""Helper: fetch_data_commons — Google Data Commons V2 observations API.

Embedded inline in cell-3 of executed civic-ai-tools notebooks (ADR-0005 §3).
Wraps `POST https://api.datacommons.org/v2/observation`. Use the chat-flow's
`search_indicators` MCP tool (or Data Commons' web UI) to discover the
`variable_dcid` you need; this helper handles the observation fetch and
flattens the response into a tidy DataFrame.
"""
import os
import requests
import pandas as pd


def fetch_data_commons(
    variable_dcid: str | list[str],
    place_dcid: str | list[str],
    *,
    date: str = "LATEST",
    child_place_type: str | None = None,
    api_key: str | None = None,
    timeout_s: int = 60,
) -> pd.DataFrame:
    """Fetch observations from Data Commons; return one row per observation.

    Args:
        variable_dcid: One or more variable DCIDs (e.g. `Median_Income_Household`).
        place_dcid: Either (a) one or more place DCIDs (e.g. `geoId/36061`),
            or (b) a single parent place DCID when `child_place_type` is set
            (e.g. `geoId/36061` + `child_place_type="CensusTract"`).
        date: ISO date (`2023`, `2023-06`, etc.) or the literal `"LATEST"`.
        child_place_type: When set, fetch observations for every child of
            `place_dcid` at this geography level (`State`, `County`,
            `CensusTract`, etc.).
        api_key: Optional Data Commons API key; falls back to env `DC_API_KEY`.
            Anonymous access works for moderate volumes.
        timeout_s: Per-request timeout in seconds.

    Returns:
        DataFrame columns: `variable`, `entity`, `date`, `value`, plus any
        `unit` / `scaling_factor` / `measurement_method` the API returns.
    """
    url = "https://api.datacommons.org/v2/observation"
    variables = [variable_dcid] if isinstance(variable_dcid, str) else list(variable_dcid)
    if child_place_type:
        if not isinstance(place_dcid, str):
            raise ValueError("place_dcid must be a single DCID when child_place_type is set")
        entity = {"expression": f"{place_dcid}<-containedInPlace+{{typeOf:{child_place_type}}}"}
    else:
        places = [place_dcid] if isinstance(place_dcid, str) else list(place_dcid)
        entity = {"dcids": places}
    payload = {
        "select": ["date", "entity", "variable", "value"],
        "variable": {"dcids": variables},
        "entity": entity,
        "date": date,
    }
    headers = {"Content-Type": "application/json"}
    key = api_key or os.environ.get("DC_API_KEY")
    if key:
        headers["X-API-Key"] = key
    response = requests.post(url, json=payload, headers=headers, timeout=timeout_s)
    response.raise_for_status()
    payload_json = response.json()
    rows: list[dict] = []
    for var, var_block in (payload_json.get("byVariable") or {}).items():
        for ent, ent_block in (var_block.get("byEntity") or {}).items():
            for obs in (ent_block.get("orderedFacets") or []):
                for point in (obs.get("observations") or []):
                    rows.append({
                        "variable": var,
                        "entity": ent,
                        "date": point.get("date"),
                        "value": point.get("value"),
                        "unit": obs.get("unit"),
                        "scaling_factor": obs.get("scalingFactor"),
                        "measurement_method": obs.get("measurementMethod"),
                    })
    return pd.DataFrame(rows)
