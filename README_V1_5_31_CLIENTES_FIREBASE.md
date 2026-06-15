# V1.5.31 - Clientes desde Firebase

- La APP carga los clientes desde la colección `clientes` de Firebase.
- Toma todos los documentos con `activo != false`.
- Usa el ID del documento como nombre si no hay campo `nombre`.
- Aplica la lista al combo de clientes, evitando la lista fija anterior.
- No se modificó Check List, WhatsApp, alertas ni otras lógicas.
