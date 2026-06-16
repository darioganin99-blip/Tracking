# V1.5.34 - Fix Tracking ruta

- Resuelve cliente, origen y destino desde los selects.
- Busca coordenadas en Firebase: colecciones origenes y destinos, campo ubicacion.
- Guarda route con origenLat/origenLng/destinoLat/destinoLng.
- Calcula routeMetrics: total, restante, avance y ETA.
- Dibuja linea origen-destino en Tracking si Leaflet esta disponible.
