# Subtipos de cuenta donde tiene sentido "contar lo que tienes fisicamente" --
# usado tanto por engine_service (calculo de liquidez) como por
# account_service (validacion de conciliacion de saldo). Vive en app/core en
# vez de en cualquiera de los dos services para que ambos puedan importarlo
# sin crear un ciclo (engine_service ya importa account_service).
LIQUID_SUBTYPES = ("cash", "checking", "savings")
