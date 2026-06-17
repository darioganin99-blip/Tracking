# V1.5.55 - Refresh fix final

- Reemplaza show/render sin llamar wrappers anteriores.
- Cloud listener ya no pisa el tránsito local activo.
- Inicio/Fin toma destino sólo del estado activo o embarque validado.
- Tracking calcula desde GPS de inicio hasta destino, arranca en 0%.
- Embarques renderiza desde estado activo y no usa HTML cache viejo.
- Cierre limpia estado, habilita campos y vuelve a estado inicial.
