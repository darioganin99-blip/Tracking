# V1.5.38 - Ruta real por caminos en Tracking

- Reemplaza la línea recta Origen-Destino por ruta real usando OSRM.
- Dibuja la ruta real en color azul.
- Mantiene Origen verde, GPS azul, Destino rojo.
- Calcula Total, Avance, Restan y ETA sobre la ruta real.
- Guarda en Firebase routeGeometry, routeDistanceKm, routeDurationMin y routeMetrics.
- Si OSRM no responde, usa la ruta cacheada en el tránsito.
