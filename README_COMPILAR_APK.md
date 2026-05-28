# ELTA Registro de Entregas - Estilo MANATIL

Aplicación Android WebView con estética basada en la app MANATIL adjunta.

## Funciones incluidas

- Pantalla principal con logo ELTA, título y versión.
- Vistas: Confirmar Entrega, Usuario, Último Registro.
- Registro de flota, chofer y teléfono WhatsApp.
- Flujo de entrega en 5 pasos.
- GPS, fecha y hora.
- Cálculo de destino más cercano por coordenadas.
- Selección de destinos cercanos.
- Lote/Carga.
- VIN opcionales.
- Generación de mensaje para WhatsApp.
- Último registro y reenvío.

## GitHub Actions

El workflow está en:

`.github/workflows/build-apk.yml`

Para compilar:

1. Subir todos los archivos a la raíz del repositorio.
2. Entrar a GitHub > Actions.
3. Ejecutar `Build ELTA APK`.
4. Descargar el artifact APK.
