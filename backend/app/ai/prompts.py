import json

from app.models.insight import INSIGHT_CATEGORIES
from app.models.report import REPORT_INSIGHT_FLOW_TYPES


def generate_insights_prompt(snapshot: dict) -> str:
    return (
        "Analiza este snapshot financiero y genera hasta 3 insights accionables. "
        "Responde UNICAMENTE con una lista JSON de objetos con las llaves "
        "title, description, category (una de "
        f"{list(INSIGHT_CATEGORIES)}) y priority (high/medium/low).\n\n"
        f"Snapshot:\n{json.dumps(snapshot, default=str)}"
    )


def review_insight_prompt(insight: dict, snapshot: dict) -> str:
    return (
        "Evalua si este insight financiero mejoro, empeoro o se mantuvo estable dado el "
        "snapshot actual. Responde UNICAMENTE con un objeto JSON con las llaves "
        "trend (improved/worsened/stable) y ai_assessment (texto breve en espanol).\n\n"
        f"Insight:\n{json.dumps(insight, default=str)}\n\n"
        f"Snapshot actual:\n{json.dumps(snapshot, default=str)}"
    )


def generate_report_insights_prompt(summary: dict, period_label: str) -> str:
    return (
        f"Este es el resumen financiero de {period_label} (periodo ya cerrado). Genera "
        "hasta 5 puntos breves en espanol sobre como estuvo ese periodo en terminos de "
        "ingresos y gastos. Responde UNICAMENTE con una lista JSON de objetos con las "
        "llaves title, description, flow_type (una de "
        f"{list(REPORT_INSIGHT_FLOW_TYPES)} -- 'income' si el punto es sobre ingresos, "
        "'expense' si es sobre gastos, 'general' si es sobre salud financiera global sin "
        "ser claramente uno u otro) y category_name (nombre exacto de la categoria de "
        "ingreso/gasto si el punto es sobre una en particular, o null si no aplica).\n\n"
        f"Resumen del periodo:\n{json.dumps(summary, default=str)}"
    )
