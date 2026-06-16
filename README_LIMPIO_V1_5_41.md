# V1.5.41 - Tracking por embarque Firebase

- Al iniciar tránsito lee `embarque/{numero}` desde Firebase.
- Usa cliente, origen y destino registrados en el embarque.
- Resuelve coordenadas desde `origenes` y `destinos`.
- Guarda y usa una única geometría OSRM real azul.
- Elimina líneas rectas/fallback superpuestas.
- Tracking queda centrado en la posición GPS actual.
- Evita que el listener remoto pise la ruta local con datos vacíos.
