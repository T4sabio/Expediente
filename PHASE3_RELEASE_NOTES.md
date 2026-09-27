# Fase 3 — Producto clínico premium

## Alcance 22–30

22. **Ronda de hoy** — tablero inicial de pacientes activos con servicio, cama, última actividad e indicadores de revisión.

23. **Línea temporal clínica** — nueva sección consolidada a partir de las siete fuentes clínicas.

24. **Centro de novedades** — botón por expediente, contador de eventos posteriores a la última revisión y acción "Marcar como revisado".

25. **Última modificación** — actor clínico y momento de actualización visibles desde la cabecera del expediente.

26. **Estado del expediente** — estado Realtime visible y timestamp de última sincronización.

27. **Densidad configurable** — compacta, normal y cómoda; preferencia persistente sin guardar datos clínicos.

28. **Command palette** — `Ctrl/Cmd + K`, navegación con teclado y comandos contextuales.

29. **Accesibilidad visual** — alto contraste persistente y compatibilidad con `prefers-reduced-motion`.

30. **Impresión profesional** — cabecera identificable, confidencialidad, usuario de impresión y pie repetido por página.

## Backend

Se añadió `supabase/008_phase3_product.sql`, con RPCs de mínimo privilegio:

- `ronda_hoy(text,int)`
- `timeline_paciente(text,int)`
- `ultima_actividad_paciente(text)`

También se agregaron índices específicos de actividad y navegación.

## Validación

- Unitarias/regresión: 72 pruebas pasan localmente en esta entrega.
- Syntax check: módulos JS de Fase 3 verificados.
- pgTAP: suite agregada en `supabase/tests/database/phase3_test.sql` para ejecutarse con Supabase local/CI.
- E2E/Axe/performance: configurados; su ejecución completa requiere las dependencias de navegador y un entorno Supabase de pruebas.

## Nota de privacidad

Las preferencias y la marca de revisión de novedades no guardan HC ni contenido clínico en localStorage; la clave del expediente se utiliza únicamente como hash no reversible para separar preferencias locales.


### Hotfix Vercel / Vite 8 (27-09-2026)

Vercel está resolviendo Vite 8.3.1, basado en Rolldown. La forma objeto de `output.manualChunks` ya no es compatible en Vite 8 y provocaba el error `TypeError: manualChunks is not a function`. Se migró `vite.config.js` a `build.rolldownOptions.output.codeSplitting.groups`, manteniendo chunks dedicados para Supabase y Chart.js y un grupo vendor como fallback.

La documentación actual de Vite/Rolldown recomienda `codeSplitting` y declara obsoleta la forma objeto de `manualChunks`.
