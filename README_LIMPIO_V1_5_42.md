# V1.5.42 - Tracking estable corregido

- Inicio/Fin calcula distancia con origen/destino reales del embarque Firebase.
- Corrige NaN en distancia.
- Tracking usa routeGeometry OSRM real y no dibuja líneas rectas fallback.
- Limpia todas las capas vectoriales viejas antes de redibujar.
- Zoom del mapa queda centrado en GPS actual y evita fitBounds repetidos.
- Evita que el listener remoto pise ruta/geometría válidas con datos incompletos.
