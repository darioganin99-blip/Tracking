# V1.5.52

- Agrega final-fix-1552.js cargado despues de app.js para anular parches viejos.
- Embarque Firebase es la unica fuente de verdad para Cliente/Origen/Destino.
- Si embarque no existe, limpia combos y resumen.
- Tracking calcula avance desde start->GPS, por lo tanto arranca en 0%.
- Lote y Embarque se bloquean con transito abierto y se liberan al cerrar.
