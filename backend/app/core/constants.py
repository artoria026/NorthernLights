# Account subtypes where "count what you physically have" makes sense --
# used both by engine_service (liquidity calculation) and by
# account_service (balance reconciliation validation). Lives in app/core
# instead of in either service so both can import it
# without creating a cycle (engine_service already imports account_service).
LIQUID_SUBTYPES = ("cash", "checking", "savings")
