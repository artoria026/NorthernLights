import json
from typing import Any


def json_safe(value: Any) -> Any:
    """Converts Decimal/UUID/date/etc. (not natively serializable) to text
    via a json roundtrip, so they can be stored in JSONB columns."""
    return json.loads(json.dumps(value, default=str))
