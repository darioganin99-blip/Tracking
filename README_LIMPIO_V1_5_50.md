# V1.5.50

- Bloquea la ruta del embarque en localStorage con clave propia.
- Inicio/Fin siempre repinta destino desde esa ruta bloqueada.
- Tracking calcula Total desde origen-destino fijo y Restan/ETA desde GPS-destino.
- No reemplaza la geometría origen-destino por GPS-destino.
- Usa cache de métricas para evitar parpadeos durante actualización GPS.
