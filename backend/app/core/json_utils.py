import json
from typing import Any


def json_safe(value: Any) -> Any:
    """Convierte Decimal/UUID/date/etc. (no serializables nativamente) a texto
    via un roundtrip de json, para poder guardarlos en columnas JSONB."""
    return json.loads(json.dumps(value, default=str))
