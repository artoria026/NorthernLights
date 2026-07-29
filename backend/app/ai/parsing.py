import json


def extract_json(text: str):
    """Los prompts de generate_insights/review_insight piden JSON puro, pero
    los modelos a veces lo envuelven en fences de markdown (```json ... ```)."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    return json.loads(cleaned.strip())
