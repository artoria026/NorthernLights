import json


def extract_json(text: str):
    """The generate_insights/review_insight prompts ask for pure JSON, but
    models sometimes wrap it in markdown fences (```json ... ```)."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    return json.loads(cleaned.strip())
